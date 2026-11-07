//! Small connection layer; translations do not own provider credentials.
use crate::persistence::llm_providers::{Model, Protocol, Provider};
use futures::StreamExt;
use genai::adapter::AdapterKind;
use genai::chat::{ChatMessage, ChatOptions, ChatRequest, ChatStreamEvent, StopReason};
use genai::resolver::{AuthData, Endpoint};
use genai::{Client, ModelIden, ServiceTarget};
use std::time::Duration;

fn is_fixed_thinking_model(base_url: &str, protocol: Protocol, model_id: &str) -> bool {
    protocol == Protocol::OpenaiChatCompletions
        && matches!(model_id.trim(), "glm-5.3-flash" | "glm-5-3-flash-260828")
        && url::Url::parse(base_url).ok().is_some_and(|url| {
            url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.host_str() == Some("ark.cn-beijing.volces.com")
                && url.path().trim_end_matches('/') == "/api/coding/v3"
        })
}

/// Only documented endpoint/model combinations may receive thinking controls.
pub fn thinking_parameters(
    base_url: &str,
    protocol: Protocol,
    model_id: &str,
) -> Option<serde_json::Value> {
    // This fixed-thinking model defaults to max effort; translation uses light reasoning.
    if is_fixed_thinking_model(base_url, protocol, model_id) {
        return Some(serde_json::json!({"reasoning_effort":"low"}));
    }
    let url = url::Url::parse(base_url).ok()?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let host = url.host_str()?;
    let model = model_id.trim();
    let deepseek = host == "api.deepseek.com"
        && matches!(
            model,
            "deepseek-flash" | "deepseek-v4-flash" | "deepseek-v4-pro"
        );
    let qwen = (matches!(
        host,
        "dashscope.aliyuncs.com"
            | "dashscope-intl.aliyuncs.com"
            | "cn-hongkong.dashscope.aliyuncs.com"
            | "coding.dashscope.aliyuncs.com"
            | "coding-intl.dashscope.aliyuncs.com"
    ) || host.ends_with(".maas.aliyuncs.com"))
        && matches!(model, "qwen3.8-flash" | "qwen3.8-max" | "qwen3.8-max-0902");
    if deepseek || qwen {
        return Some(match (protocol, deepseek) {
            (Protocol::AnthropicMessages, _) | (Protocol::OpenaiChatCompletions, true) => {
                serde_json::json!({"thinking": {"type": "disabled"}})
            }
            (Protocol::OpenaiResponses, true) => serde_json::json!({
                "reasoning": {"effort": "none"}
            }),
            _ => serde_json::json!({"enable_thinking": false}),
        });
    }
    if host == "api.anthropic.com" && protocol == Protocol::AnthropicMessages {
        let off = match model {
            "claude-opus-4-6" | "claude-sonnet-4-6" | "claude-opus-4-7" | "claude-opus-4-8"
            | "claude-opus-5" | "claude-sonnet-5" | "claude-haiku-5-5" => "disabled",
            "claude-sonnet-5-5" => "between_tools",
            _ => return None,
        };
        return Some(serde_json::json!({
            "thinking": {"type": off}
        }));
    }
    None
}

pub fn adapter(protocol: Protocol) -> AdapterKind {
    match protocol {
        Protocol::AnthropicMessages => AdapterKind::Anthropic,
        Protocol::OpenaiChatCompletions => AdapterKind::OpenAI,
        Protocol::OpenaiResponses => AdapterKind::OpenAIResp,
    }
}

fn classify(error: genai::Error) -> String {
    // Never stringify SDK errors: they may contain server echoes and credentials.
    if matches!(
        error,
        genai::Error::ChatResponseGeneration { .. }
            | genai::Error::ChatResponse { .. }
            | genai::Error::StreamParse { .. }
            | genai::Error::NoChatResponse { .. }
            | genai::Error::InvalidJsonResponseElement { .. }
            | genai::Error::JsonValueExt(_)
            | genai::Error::SerdeJson(_)
            | genai::Error::WebModelCall {
                webc_error: genai::webc::Error::ResponseFailedNotJson { .. }
                    | genai::webc::Error::ResponseFailedInvalidJson { .. },
                ..
            }
    ) {
        return "providerResponse".into();
    }
    let status = error.status();
    if status.is_some_and(|status| status.as_u16() == 429) {
        let body = match &error {
            genai::Error::HttpError { body, .. }
            | genai::Error::WebModelCall {
                webc_error: genai::webc::Error::ResponseFailedStatus { body, .. },
                ..
            } => Some(body),
            _ => None,
        };
        let quota_exceeded = body
            .and_then(|body| serde_json::from_str::<serde_json::Value>(body).ok())
            .is_some_and(|body| {
                body.pointer("/error/code").and_then(|v| v.as_str()) == Some("AccountQuotaExceeded")
            });
        return if quota_exceeded {
            "quotaExceeded"
        } else {
            "rateLimit"
        }
        .into();
    }
    if let genai::Error::WebStream { error: inner, .. } = error {
        if inner.is::<genai::webc::StreamTimeout>() {
            return "timeout".into();
        }
        if let Ok(error) = inner.downcast::<genai::Error>() {
            return classify(*error);
        }
    }
    match status.map(|s| s.as_u16()) {
        Some(401 | 403) => "authentication",
        Some(_) => "providerResponse",
        None => "network",
    }
    .into()
}

fn target(provider: &Provider, model_id: &str) -> Result<ServiceTarget, String> {
    let suffix = match provider.protocol {
        Protocol::AnthropicMessages => "messages",
        Protocol::OpenaiChatCompletions => "chat/completions",
        Protocol::OpenaiResponses => "responses",
    };
    let mut base_url = url::Url::parse(&provider.base_url).map_err(|_| "baseUrl")?;
    if provider.protocol == Protocol::AnthropicMessages {
        let path = base_url.path().trim_end_matches('/');
        // Anthropic-compatible gateways expose Messages below their v1 API root.
        let path = if path.to_ascii_lowercase().ends_with("/v1") {
            format!("{path}/")
        } else {
            format!("{path}/v1/")
        };
        base_url.set_path(&path);
    }
    let url = base_url.join(suffix).map_err(|_| "baseUrl")?.to_string();
    let mut headers: Vec<(String, String)> = Vec::new();
    if provider.protocol == Protocol::AnthropicMessages {
        headers.push(("anthropic-version".into(), "2023-06-01".into()));
        if !provider.api_key.is_empty() {
            headers.push(("x-api-key".into(), provider.api_key.clone()));
        }
    }
    if !provider.api_key.is_empty() {
        headers.push((
            "authorization".into(),
            format!("Bearer {}", provider.api_key),
        ));
    }
    // A concrete target prevents model inference and environment credential fallbacks.
    // RequestOverride also permits genuinely anonymous local endpoints.
    Ok(ServiceTarget {
        model: ModelIden::new(adapter(provider.protocol), model_id.to_owned()),
        endpoint: Endpoint::from_owned(base_url.to_string()),
        auth: AuthData::RequestOverride {
            url,
            headers: headers.into(),
        },
    })
}

/// Explicit, read-only inference probe; never include source documents or server echoes.
pub async fn test_connection(provider: &Provider, model_id: &str) -> Result<u64, String> {
    let started = std::time::Instant::now();
    tokio::time::timeout(Duration::from_secs(15), async {
        let client = Client::builder()
            .with_reqwest(crate::config::http_client().clone())
            .build()
            .map_err(|_| "network")?;
        // Responses enforces a minimum budget of 16; the other protocols accept 1.
        let budget = if provider.protocol == Protocol::OpenaiResponses {
            16
        } else {
            1
        };
        let mut options = ChatOptions::default()
            .with_max_tokens(budget)
            .with_capture_raw_body(true);
        if let Some(parameters) =
            thinking_parameters(&provider.base_url, provider.protocol, model_id)
        {
            options = options.with_extra_body(parameters);
        }
        let body = match client
            .exec_chat(
                target(provider, model_id)?,
                ChatRequest::new(vec![ChatMessage::user("hi")]),
                Some(&options),
            )
            .await
        {
            Ok(response) => response.captured_raw_body.ok_or("providerResponse")?,
            // Connectivity needs the envelope, not SDK decoding of optional content
            // (compatible gateways may return thinking without an Anthropic signature).
            Err(genai::Error::ChatResponseGeneration { response_body, .. }) => *response_body,
            Err(error) => return Err(classify(error)),
        };
        // A one-token budget can legitimately produce no text, especially with reasoning.
        // Require a protocol response and a valid terminal state, not nonempty prose.
        let valid = match provider.protocol {
            Protocol::OpenaiChatCompletions => {
                body.pointer("/choices/0/message")
                    .is_some_and(|v| v.is_object())
                    && matches!(
                        body.pointer("/choices/0/finish_reason")
                            .and_then(|v| v.as_str()),
                        Some("stop" | "length")
                    )
            }
            Protocol::AnthropicMessages => {
                body.get("content").is_some_and(|v| v.is_array())
                    && matches!(
                        body.get("stop_reason").and_then(|v| v.as_str()),
                        Some("end_turn" | "max_tokens")
                    )
            }
            Protocol::OpenaiResponses => {
                body.get("output").is_some_and(|v| v.is_array())
                    && (body.get("status").and_then(|v| v.as_str()) == Some("completed")
                        || (body.get("status").and_then(|v| v.as_str()) == Some("incomplete")
                            && body
                                .pointer("/incomplete_details/reason")
                                .and_then(|v| v.as_str())
                                == Some("max_output_tokens")))
            }
        };
        if !valid {
            return Err("providerResponse".into());
        }
        Ok(started.elapsed().as_millis() as u64)
    })
    .await
    .map_err(|_| "timeout".to_owned())?
}

pub async fn stream(
    provider: &Provider,
    model: &Model,
    system: &str,
    input: &str,
    mut preview: impl FnMut(&str) -> Result<(), String>,
) -> Result<String, String> {
    let client = Client::builder()
        .with_reqwest(crate::config::http_client().clone())
        .build()
        .map_err(|_| "network")?;
    let mut options = ChatOptions::default()
        .with_stream_header_timeout(Duration::from_secs(30))
        .with_stream_read_timeout(Duration::from_secs(30));
    if let Some(max) = model.max_output_tokens {
        options = options.with_max_tokens(max);
    }
    if let Some(parameters) = thinking_parameters(&provider.base_url, provider.protocol, &model.id)
    {
        options = options.with_extra_body(parameters);
    }
    let request = ChatRequest::new(vec![ChatMessage::system(system), ChatMessage::user(input)]);
    let response = client
        .exec_chat_stream(target(provider, &model.id)?, request, Some(&options))
        .await
        .map_err(classify)?;
    let mut events = response.stream;
    let mut text = String::new();
    while let Some(event) = tokio::time::timeout(Duration::from_secs(30), events.next())
        .await
        .map_err(|_| "timeout")?
    {
        match event.map_err(classify)? {
            ChatStreamEvent::Chunk(chunk) => {
                text.push_str(&chunk.content);
                if text.len() > 256 * 1024 {
                    return Err("outputLimit".into());
                }
                preview(&text)?;
            }
            ChatStreamEvent::End(end) => {
                return match end.captured_stop_reason {
                    Some(StopReason::Completed(_)) if !text.trim().is_empty() => Ok(text),
                    Some(StopReason::MaxTokens(_)) => Err("truncated".into()),
                    _ => Err("incomplete".into()),
                };
            }
            _ => {}
        }
    }
    Err("incomplete".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn coding_fixed_thinking_parameters_reach_the_wire() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/api/coding/v3/chat/completions")
            .match_body(mockito::Matcher::PartialJson(
                json!({"model":"glm-5.3-flash",
                "stream":true,"max_tokens":131072,"reasoning_effort":"low"}),
            ))
            .with_header("content-type", "text/event-stream")
            .with_body(format!(
                "data: {}\n\ndata: [DONE]\n\n",
                json!({"choices":[{"delta":{"content":"translated"},"finish_reason":"stop"}]})
            ))
            .expect(1)
            .create_async()
            .await;
        let provider = probe_provider(
            format!("{}/api/coding/v3/", server.url()),
            Protocol::OpenaiChatCompletions,
        );
        let options = ChatOptions::default()
            .with_max_tokens(131072)
            .with_extra_body(
                thinking_parameters(
                    "https://ark.cn-beijing.volces.com/api/coding/v3/",
                    Protocol::OpenaiChatCompletions,
                    "glm-5.3-flash",
                )
                .unwrap(),
            );
        let client = Client::builder()
            .with_reqwest(crate::config::http_client().clone())
            .build()
            .unwrap();
        let mut events = client
            .exec_chat_stream(
                target(&provider, "glm-5.3-flash").unwrap(),
                ChatRequest::new(vec![
                    ChatMessage::system("Translate"),
                    ChatMessage::user("Hello"),
                ]),
                Some(&options),
            )
            .await
            .unwrap()
            .stream;
        let mut text = String::new();
        while let Some(event) = events.next().await {
            if let ChatStreamEvent::Chunk(chunk) = event.unwrap() {
                text.push_str(&chunk.content);
            }
        }
        assert_eq!(text, "translated");
        mock.assert_async().await;
    }

    #[test]
    fn translation_thinking_policy_matches_endpoint_model_and_protocol() {
        for model in ["glm-5.3-flash", "glm-5-3-flash-260828"] {
            assert_eq!(
                thinking_parameters(
                    "https://ark.cn-beijing.volces.com/api/coding/v3/",
                    Protocol::OpenaiChatCompletions,
                    model
                ),
                Some(json!({"reasoning_effort":"low"}))
            );
        }
        for protocol in [Protocol::AnthropicMessages, Protocol::OpenaiChatCompletions] {
            assert_eq!(
                thinking_parameters("https://api.deepseek.com/v1", protocol, "deepseek-flash"),
                Some(json!({"thinking":{"type":"disabled"}}))
            );
        }
        assert_eq!(
            thinking_parameters(
                "https://api.deepseek.com",
                Protocol::OpenaiResponses,
                "deepseek-flash"
            ),
            Some(json!({"reasoning":{"effort":"none"}}))
        );
        for protocol in [Protocol::OpenaiChatCompletions, Protocol::OpenaiResponses] {
            assert_eq!(
                thinking_parameters(
                    "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    protocol,
                    "qwen3.8-flash"
                ),
                Some(json!({"enable_thinking":false}))
            );
        }
        assert_eq!(
            thinking_parameters(
                "https://workspace.cn-beijing.maas.aliyuncs.com/apps/anthropic",
                Protocol::AnthropicMessages,
                "qwen3.8-max"
            ),
            Some(json!({"thinking":{"type":"disabled"}}))
        );
        for (model, mode) in [
            ("claude-sonnet-4-6", "disabled"),
            ("claude-sonnet-5-5", "between_tools"),
        ] {
            assert_eq!(
                thinking_parameters(
                    "https://api.anthropic.com",
                    Protocol::AnthropicMessages,
                    model
                ),
                Some(json!({"thinking":{"type":mode}}))
            );
        }
    }

    #[test]
    fn unverified_endpoints_models_and_protocols_get_no_extra_parameters() {
        for (url, protocol, model) in [
            (
                "https://proxy.test",
                Protocol::AnthropicMessages,
                "deepseek-flash",
            ),
            (
                "https://api.deepseek.com.evil.test",
                Protocol::AnthropicMessages,
                "deepseek-flash",
            ),
            (
                "https://api.deepseek.com",
                Protocol::AnthropicMessages,
                "my-deepseek-flash",
            ),
            (
                "https://api.anthropic.com",
                Protocol::AnthropicMessages,
                "claude-opus-5-5",
            ),
            (
                "https://dashscope.aliyuncs.com",
                Protocol::AnthropicMessages,
                "unregistered-model",
            ),
            ("not a URL", Protocol::AnthropicMessages, "deepseek-flash"),
            (
                "https://ark.cn-beijing.volces.com.evil.test/api/coding/v3/",
                Protocol::OpenaiChatCompletions,
                "glm-5.3-flash",
            ),
            (
                "https://ark.cn-beijing.volces.com/api/plan/v3/",
                Protocol::OpenaiChatCompletions,
                "glm-5.3-flash",
            ),
            (
                "https://ark.cn-beijing.volces.com/api/coding/v3/",
                Protocol::OpenaiResponses,
                "glm-5.3-flash",
            ),
            (
                "https://ark.cn-beijing.volces.com/api/coding/v3/",
                Protocol::OpenaiChatCompletions,
                "custom-glm-5.3-flash",
            ),
            (
                "https://key@ark.cn-beijing.volces.com/api/coding/v3/",
                Protocol::OpenaiChatCompletions,
                "glm-5.3-flash",
            ),
        ] {
            assert_eq!(thinking_parameters(url, protocol, model), None);
        }
    }

    #[tokio::test]
    async fn sdk_preserves_explicit_thinking_controls_in_messages_requests() {
        let mut server = mockito::Server::new_async().await;
        let mock = server.mock("POST", "/v1/messages")
            .match_body(mockito::Matcher::PartialJson(json!({
                "model":"deepseek-flash", "thinking":{"type":"disabled"}
            })))
            .with_header("content-type", "application/json")
            .with_body(json!({"id":"m1","type":"message","role":"assistant","model":"deepseek-flash","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}).to_string())
            .create_async().await;
        let provider = probe_provider(server.url(), Protocol::AnthropicMessages);
        let parameters = thinking_parameters(
            "https://api.deepseek.com/anthropic",
            provider.protocol,
            "deepseek-flash",
        )
        .unwrap();
        let options = ChatOptions::default()
            .with_max_tokens(1)
            .with_extra_body(parameters);
        let client = Client::builder()
            .with_reqwest(crate::config::http_client().clone())
            .build()
            .unwrap();
        client
            .exec_chat(
                target(&provider, "deepseek-flash").unwrap(),
                ChatRequest::new(vec![ChatMessage::user("hi")]),
                Some(&options),
            )
            .await
            .unwrap();
        mock.assert_async().await;
    }

    fn probe_provider(base_url: String, protocol: Protocol) -> Provider {
        Provider {
            id: "test".into(),
            name: "Test".into(),
            enabled: true,
            protocol,
            base_url,
            api_key: "secret-key".into(),
            models: vec![],
        }
    }

    #[tokio::test]
    async fn connection_probe_uses_minimal_budget_and_accepts_empty_budget_limited_responses() {
        for protocol in [
            Protocol::OpenaiChatCompletions,
            Protocol::AnthropicMessages,
            Protocol::OpenaiResponses,
        ] {
            let mut server = mockito::Server::new_async().await;
            let (path, budget_key, budget, body) = match protocol {
                Protocol::OpenaiChatCompletions => (
                    "chat/completions",
                    "max_tokens",
                    1,
                    json!({"model":"gpt-test", "choices":[{"message":{"role":"assistant","content":null},"finish_reason":"length"}]}),
                ),
                Protocol::AnthropicMessages => (
                    "messages",
                    "max_tokens",
                    1,
                    json!({"id":"m1", "type":"message", "role":"assistant", "model":"gpt-test", "content":[], "stop_reason":"max_tokens", "usage":{"input_tokens":1,"output_tokens":1}}),
                ),
                Protocol::OpenaiResponses => (
                    "responses",
                    "max_output_tokens",
                    16,
                    json!({"id":"r1", "model":"gpt-test", "status":"incomplete", "output":[], "incomplete_details":{"reason":"max_output_tokens"}}),
                ),
            };
            let mut expected = json!({"model":"gpt-test", "stream":false});
            expected[budget_key] = json!(budget);
            let mut mock = server
                .mock("POST", format!("/v1/{path}").as_str())
                .match_body(mockito::Matcher::PartialJson(expected));
            mock = if protocol == Protocol::AnthropicMessages {
                mock.match_header("x-api-key", "secret-key")
                    .match_header("authorization", "Bearer secret-key")
                    .match_header("anthropic-version", "2023-06-01")
            } else {
                mock.match_header("authorization", "Bearer secret-key")
            };
            let mock = mock
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(body.to_string())
                .expect(1)
                .create_async()
                .await;
            let provider = probe_provider(format!("{}/v1/", server.url()), protocol);
            assert!(
                test_connection(&provider, "gpt-test").await.is_ok(),
                "{protocol:?}"
            );
            mock.assert_async().await;
        }
    }

    #[tokio::test]
    async fn anthropic_probe_normalizes_gateway_roots_without_changing_config() {
        for (root, path) in [
            ("/", "/v1/messages"),
            ("/anthropic/", "/anthropic/v1/messages"),
            ("/anthropic/v1/", "/anthropic/v1/messages"),
            ("/anthropic/v1///", "/anthropic/v1/messages"),
            ("/anthropic/V1/", "/anthropic/V1/messages"),
        ] {
            for key in ["secret-key", ""] {
                let mut server = mockito::Server::new_async().await;
                let mut mock = server
                    .mock("POST", path)
                    .match_header("anthropic-version", "2023-06-01");
                mock = if key.is_empty() {
                    mock.match_header("x-api-key", mockito::Matcher::Missing)
                        .match_header("authorization", mockito::Matcher::Missing)
                } else {
                    mock.match_header("x-api-key", key)
                        .match_header("authorization", format!("Bearer {key}").as_str())
                };
                let mock = mock
                    .with_status(200)
                    .with_header("content-type", "application/json")
                    .with_body(json!({"id":"m1","type":"message","role":"assistant","model":"test","content":[],"stop_reason":"max_tokens","usage":{"input_tokens":1,"output_tokens":1}}).to_string())
                    .expect(1)
                    .create_async()
                    .await;
                let base_url = format!("{}{root}", server.url());
                let mut provider = probe_provider(base_url.clone(), Protocol::AnthropicMessages);
                provider.api_key = key.into();
                assert!(
                    test_connection(&provider, "test").await.is_ok(),
                    "root {root}, anonymous {}",
                    key.is_empty()
                );
                assert_eq!(provider.base_url, base_url);
                mock.assert_async().await;
            }
        }
    }

    #[tokio::test]
    async fn openai_probes_preserve_custom_roots_and_accept_compact_responses() {
        for protocol in [Protocol::OpenaiChatCompletions, Protocol::OpenaiResponses] {
            let mut server = mockito::Server::new_async().await;
            let (suffix, expected, body) = if protocol == Protocol::OpenaiChatCompletions {
                (
                    "chat/completions",
                    json!({"model":"gpt-5-alias","stream":false,"max_completion_tokens":1}),
                    json!({"model":"gpt-5-alias","choices":[{"message":{"role":"assistant","content":null,"reasoning_content":"thinking"},"finish_reason":"length"}]}),
                )
            } else {
                (
                    "responses",
                    json!({"model":"gpt-5-alias","stream":false,"max_output_tokens":16,"store":false}),
                    // Compatible backends can omit message.id and text.annotations.
                    json!({"id":"r1","model":"gpt-5-alias","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}]}),
                )
            };
            let mock = server
                .mock("POST", format!("/api/custom/v4/{suffix}").as_str())
                .match_header("authorization", "Bearer secret-key")
                .match_header("x-api-key", mockito::Matcher::Missing)
                .match_body(mockito::Matcher::PartialJson(expected))
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(body.to_string())
                .expect(1)
                .create_async()
                .await;
            let provider = probe_provider(format!("{}/api/custom/v4/", server.url()), protocol);
            assert!(
                test_connection(&provider, "gpt-5-alias").await.is_ok(),
                "{protocol:?}"
            );
            mock.assert_async().await;
        }
    }

    #[tokio::test]
    async fn anthropic_probe_accepts_unsigned_thinking_but_requires_a_successful_envelope() {
        for (status, content, stop_reason, succeeds) in [
            (
                200,
                json!([{"type":"thinking","thinking":"..."}]),
                Some("max_tokens"),
                true,
            ),
            (
                200,
                json!([{"type":"thinking","thinking":"...","signature":null}]),
                Some("end_turn"),
                true,
            ),
            (
                400,
                json!([{"type":"thinking","thinking":"..."}]),
                Some("max_tokens"),
                false,
            ),
            (
                200,
                json!([{"type":"thinking","thinking":"..."}]),
                None,
                false,
            ),
            (
                200,
                json!([{"type":"thinking","thinking":"..."}]),
                Some("refusal"),
                false,
            ),
            (
                200,
                json!({"type":"thinking","thinking":"..."}),
                Some("max_tokens"),
                false,
            ),
        ] {
            let mut server = mockito::Server::new_async().await;
            let mock = server
                .mock("POST", "/api/coding/v1/messages")
                .with_status(status)
                .with_header("content-type", "application/json")
                .with_body(
                    json!({"id":"m1", "type":"message", "role":"assistant",
                    "model":"glm-5.3-flash", "content":content, "stop_reason":stop_reason,
                    "usage":{"input_tokens":1,"output_tokens":1}})
                    .to_string(),
                )
                .expect(1)
                .create_async()
                .await;
            let provider = probe_provider(
                format!("{}/api/coding/", server.url()),
                Protocol::AnthropicMessages,
            );
            let result = test_connection(&provider, "glm-5.3-flash").await;
            assert_eq!(
                result.is_ok(),
                succeeds,
                "status {status}, stop_reason {stop_reason:?}: {result:?}"
            );
            if !succeeds {
                assert_eq!(result, Err("providerResponse".into()));
            }
            mock.assert_async().await;
        }
    }

    #[tokio::test]
    async fn connection_probe_rejects_invalid_responses_and_redacts_errors_without_retry() {
        for (status, body, expected) in [
            (401, "echo secret-key", "authentication"),
            (403, "echo secret-key", "authentication"),
            (429, "echo secret-key", "rateLimit"),
            (500, "echo secret-key", "providerResponse"),
            (200, "echo secret-key", "providerResponse"),
            (200, r#"{"model":"test", "choices":[]}"#, "providerResponse"),
            (
                200,
                r#"{"model":"test", "choices":[{"message":{},"finish_reason":"content_filter"}]}"#,
                "providerResponse",
            ),
        ] {
            let mut server = mockito::Server::new_async().await;
            let mock = server
                .mock("POST", "/v1/chat/completions")
                .with_status(status)
                .with_header("content-type", "application/json")
                .with_body(body)
                .expect(1)
                .create_async()
                .await;
            let provider = probe_provider(
                format!("{}/v1/", server.url()),
                Protocol::OpenaiChatCompletions,
            );
            assert_eq!(
                test_connection(&provider, "test").await,
                Err(expected.into()),
                "status {status}, body {body}"
            );
            mock.assert_async().await;
        }
    }

    #[tokio::test]
    async fn connection_probe_has_a_total_deadline() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/chat/completions")
            .with_status(200)
            .with_chunked_body(|writer| {
                writer.write_all(b"{")?;
                std::thread::sleep(Duration::from_secs(16));
                Ok(())
            })
            .create_async()
            .await;
        let provider = probe_provider(
            format!("{}/v1/", server.url()),
            Protocol::OpenaiChatCompletions,
        );
        assert_eq!(
            test_connection(&provider, "test").await,
            Err("timeout".into())
        );
        mock.assert_async().await;
    }

    fn frame(event: &str, value: serde_json::Value) -> String {
        format!("event: {event}\ndata: {value}\n\n")
    }
    async fn check(protocol: Protocol, truncated: bool, root: &str) {
        let mut server = mockito::Server::new_async().await;
        let (path, body) = match protocol {
            Protocol::OpenaiChatCompletions => (
                "/v1/chat/completions",
                format!(
                    "data: {}\n\ndata: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                    json!({"choices":[{"delta":{"reasoning_content":"private reasoning"},"finish_reason":null}]}),
                    json!({"choices":[{"delta":{"content":"译文"},"finish_reason":if truncated {"length"} else {"stop"}}]}),
                    json!({"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}})
                ),
            ),
            Protocol::AnthropicMessages => (
                "/v1/messages",
                format!(
                    "{}{}{}{}",
                    frame(
                        "content_block_start",
                        json!({"index":0,"content_block":{"type":"text","text":""}})
                    ),
                    frame(
                        "content_block_delta",
                        json!({"index":0,"delta":{"type":"text_delta","text":"译文"}})
                    ),
                    frame(
                        "message_delta",
                        json!({"delta":{"stop_reason":if truncated {"max_tokens"} else {"end_turn"}},"usage":{"output_tokens":2}})
                    ),
                    frame("message_stop", json!({}))
                ),
            ),
            Protocol::OpenaiResponses => (
                "/v1/responses",
                format!(
                    "{}{}",
                    frame(
                        "response.output_text.delta",
                        json!({"type":"response.output_text.delta","delta":"译文"})
                    ),
                    frame(
                        if truncated {
                            "response.incomplete"
                        } else {
                            "response.completed"
                        },
                        json!({"type":if truncated {"response.incomplete"} else {"response.completed"},"response":{"id":"r1","model":"gpt-test","status":if truncated {"incomplete"} else {"completed"},"output":[]}})
                    )
                ),
            ),
        };
        let wire_root = if protocol == Protocol::AnthropicMessages && root == "/api/custom/v4" {
            "/api/custom/v4/v1"
        } else {
            root
        };
        let path = format!("{wire_root}{}", path.strip_prefix("/v1").unwrap());
        let mut mock = server
            .mock("POST", path.as_str())
            .match_body(mockito::Matcher::PartialJson(
                if protocol == Protocol::OpenaiResponses {
                    json!({"model":"gpt-test","stream":true,"max_output_tokens":100,"store":false})
                } else {
                    json!({"model":"gpt-test","stream":true,"max_tokens":100})
                },
            ))
            .match_header("x-custom", mockito::Matcher::Missing);
        mock = if protocol == Protocol::AnthropicMessages {
            mock.match_header("x-api-key", "secret-key")
                .match_header("authorization", "Bearer secret-key")
                .match_header("anthropic-version", "2023-06-01")
        } else {
            mock.match_header("authorization", "Bearer secret-key")
        };
        let mock = mock
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(body)
            .create_async()
            .await;
        let provider = Provider {
            id: "test".into(),
            name: "Test".into(),
            enabled: true,
            protocol,
            base_url: format!("{}{root}/", server.url()),
            api_key: "secret-key".into(),
            models: vec![],
        };
        // Deliberately mismatched model name: protocol must win over inference.
        let model = Model {
            id: "gpt-test".into(),
            enabled: true,
            max_output_tokens: Some(100),
            context_window: None,
        };
        let result = stream(&provider, &model, "Translate", "Hello", |_| Ok(())).await;
        if truncated {
            assert_eq!(result, Err("truncated".into()));
        } else {
            assert_eq!(result, Ok("译文".into()));
        }
        mock.assert_async().await;
    }
    #[tokio::test]
    async fn three_protocols_use_explicit_routes_and_detect_truncation() {
        for protocol in [
            Protocol::OpenaiChatCompletions,
            Protocol::AnthropicMessages,
            Protocol::OpenaiResponses,
        ] {
            for root in ["/v1", "/api/custom/v4"] {
                check(protocol, false, root).await;
                check(protocol, true, root).await;
            }
        }
    }
    #[tokio::test]
    async fn quota_errors_are_distinct_from_rate_limits_for_probes_and_streams() {
        for (status, body, expected) in [
            (429, json!({"error":{"code":"AccountQuotaExceeded","message":"echo secret-key private-input"}}).to_string(), "quotaExceeded"),
            (429, json!({"error":{"code":"RateLimitExceeded","message":"quota word alone is not evidence"}}).to_string(), "rateLimit"),
            (429, "unknown response echo secret-key".into(), "rateLimit"),
            (401, json!({"error":{"code":"AccountQuotaExceeded"}}).to_string(), "authentication"),
        ] {
            let mut server = mockito::Server::new_async().await;
            let mock = server.mock("POST", "/v1/messages")
                .with_status(status).with_header("content-type","application/json")
                .with_body(body).expect(2).create_async().await;
            let provider = probe_provider(format!("{}/v1/",server.url()),Protocol::AnthropicMessages);
            let model = Model {id:"glm-5.3-flash".into(),enabled:true,
                max_output_tokens:Some(131072),context_window:None};
            assert_eq!(test_connection(&provider,&model.id).await,Err(expected.into()));
            assert_eq!(stream(&provider,&model,"Translate","private-input",|_|Ok(())).await,Err(expected.into()));
            mock.assert_async().await;
        }
    }

    #[tokio::test]
    async fn anonymous_auth_and_failures_do_not_expose_server_echoes() {
        for (protocol, suffix) in [
            (Protocol::OpenaiChatCompletions, "chat/completions"),
            (Protocol::AnthropicMessages, "messages"),
            (Protocol::OpenaiResponses, "responses"),
        ] {
            for (status, expected) in [
                (401, "authentication"),
                (403, "authentication"),
                (429, "rateLimit"),
                (500, "providerResponse"),
            ] {
                let mut server = mockito::Server::new_async().await;
                let mock = server
                    .mock("POST", format!("/v1/{suffix}").as_str())
                    .match_header("authorization", mockito::Matcher::Missing)
                    .match_header("x-api-key", mockito::Matcher::Missing)
                    .with_status(status)
                    .with_body("echo secret-key secret-header")
                    .expect(2)
                    .create_async()
                    .await;
                let mut provider = probe_provider(format!("{}/v1/", server.url()), protocol);
                provider.api_key.clear();
                let model = Model {
                    id: "local".into(),
                    enabled: true,
                    max_output_tokens: None,
                    context_window: None,
                };
                assert_eq!(
                    test_connection(&provider, "local").await,
                    Err(expected.into())
                );
                assert_eq!(
                    stream(&provider, &model, "Translate", "Hello", |_| Ok(())).await,
                    Err(expected.into()),
                    "{protocol:?}, status {status}"
                );
                mock.assert_async().await;
            }
        }
    }
    #[tokio::test]
    async fn provider_stream_errors_are_safe_response_errors_without_retry() {
        let echo = "echo secret-key private-input";
        for (protocol, path, body) in [
            (
                Protocol::OpenaiChatCompletions,
                "chat/completions",
                format!("data: {}\n\n", json!({"error":{"message":echo}})),
            ),
            (
                Protocol::AnthropicMessages,
                "messages",
                frame(
                    "error",
                    json!({"type":"error","error":{"type":"overloaded_error","message":echo}}),
                ),
            ),
            (
                Protocol::OpenaiResponses,
                "responses",
                frame(
                    "response.failed",
                    json!({"type":"response.failed","response":{"id":"r1","model":"test","status":"failed","error":{"message":echo},"output":[]}}),
                ),
            ),
            (
                Protocol::OpenaiChatCompletions,
                "chat/completions",
                format!("data: {echo}\n\n"),
            ),
            (
                Protocol::AnthropicMessages,
                "messages",
                format!("event: content_block_start\ndata: {echo}\n\n"),
            ),
        ] {
            let mut server = mockito::Server::new_async().await;
            let mock = server
                .mock("POST", format!("/v1/{path}").as_str())
                .with_status(200)
                .with_header("content-type", "text/event-stream")
                .with_body(body)
                .expect(1)
                .create_async()
                .await;
            let provider = probe_provider(format!("{}/v1/", server.url()), protocol);
            let model = Model {
                id: "test".into(),
                enabled: true,
                max_output_tokens: Some(100),
                context_window: None,
            };
            assert_eq!(
                stream(&provider, &model, "Translate", "private-input", |_| Ok(())).await,
                Err("providerResponse".into()),
                "{protocol:?}"
            );
            mock.assert_async().await;
        }
    }

    #[tokio::test]
    async fn missing_finish_reason_is_not_a_success() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/chat/completions")
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body(
                "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\ndata: [DONE]\n\n",
            )
            .create_async()
            .await;
        let provider = Provider {
            id: "test".into(),
            name: "Test".into(),
            enabled: true,
            protocol: Protocol::OpenaiChatCompletions,
            base_url: format!("{}/v1/", server.url()),
            api_key: String::new(),
            models: vec![],
        };
        let model = Model {
            id: "test".into(),
            enabled: true,
            max_output_tokens: None,
            context_window: None,
        };
        assert_eq!(
            stream(&provider, &model, "Translate", "Hello", |_| Ok(())).await,
            Err("incomplete".into())
        );
        mock.assert_async().await;
    }
}
