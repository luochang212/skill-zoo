//! Small connection layer; translations do not own provider credentials.
use crate::persistence::llm_providers::{Model, Protocol, Provider};
use futures::StreamExt;
use genai::adapter::AdapterKind;
use genai::chat::{ChatMessage, ChatOptions, ChatRequest, ChatStreamEvent, StopReason};
use genai::resolver::{AuthData, Endpoint};
use genai::{Client, ModelIden, ServiceTarget};
use std::time::Duration;

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
            | genai::Error::WebModelCall {
                webc_error: genai::webc::Error::ResponseFailedNotJson { .. }
                    | genai::webc::Error::ResponseFailedInvalidJson { .. },
                ..
            }
    ) {
        return "providerResponse".into();
    }
    let mut status = error.status();
    if let genai::Error::WebStream { error: inner, .. } = &error {
        if inner.is::<genai::webc::StreamTimeout>() {
            return "timeout".into();
        }
        if let Some(error) = inner.downcast_ref::<genai::Error>() {
            status = error.status();
        }
    }
    match status.map(|s| s.as_u16()) {
        Some(401 | 403) => "authentication",
        Some(429) => "rateLimit",
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
    let url = url::Url::parse(&provider.base_url)
        .map_err(|_| "baseUrl")?
        .join(suffix)
        .map_err(|_| "baseUrl")?
        .to_string();
    let mut headers: Vec<(String, String)> = Vec::new();
    if provider.protocol == Protocol::AnthropicMessages {
        headers.push(("anthropic-version".into(), "2023-06-01".into()));
        if !provider.api_key.is_empty() {
            headers.push(("x-api-key".into(), provider.api_key.clone()));
        }
    } else if !provider.api_key.is_empty() {
        headers.push((
            "authorization".into(),
            format!("Bearer {}", provider.api_key),
        ));
    }
    // A concrete target prevents model inference and environment credential fallbacks.
    // RequestOverride also permits genuinely anonymous local endpoints.
    Ok(ServiceTarget {
        model: ModelIden::new(adapter(provider.protocol), model_id.to_owned()),
        endpoint: Endpoint::from_owned(provider.base_url.clone()),
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
        let options = ChatOptions::default()
            .with_max_tokens(budget)
            .with_capture_raw_body(true);
        let response = client
            .exec_chat(
                target(provider, model_id)?,
                ChatRequest::new(vec![ChatMessage::user("hi")]),
                Some(&options),
            )
            .await
            .map_err(classify)?;
        let body = response.captured_raw_body.ok_or("providerResponse")?;
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
    async fn check(protocol: Protocol, truncated: bool) {
        let mut server = mockito::Server::new_async().await;
        let (path, body) = match protocol {
            Protocol::OpenaiChatCompletions => (
                "/v1/chat/completions",
                format!(
                    "data: {}\n\ndata: [DONE]\n\n",
                    json!({"choices":[{"delta":{"content":"译文"},"finish_reason":if truncated {"length"} else {"stop"}}]})
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
        let mut mock = server
            .mock("POST", path)
            .match_header("x-custom", mockito::Matcher::Missing);
        mock = if protocol == Protocol::AnthropicMessages {
            mock.match_header("x-api-key", "secret-key")
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
            base_url: format!("{}/v1/", server.url()),
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
            check(protocol, false).await;
            check(protocol, true).await;
        }
    }
    #[tokio::test]
    async fn anonymous_auth_and_failures_do_not_expose_server_echoes() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/chat/completions")
            .match_header("authorization", mockito::Matcher::Missing)
            .with_status(401)
            .with_body("echo secret-key secret-header")
            .create_async()
            .await;
        let provider = Provider {
            id: "local".into(),
            name: "Local".into(),
            enabled: true,
            protocol: Protocol::OpenaiChatCompletions,
            base_url: format!("{}/v1/", server.url()),
            api_key: String::new(),
            models: vec![],
        };
        let model = Model {
            id: "local".into(),
            enabled: true,
            max_output_tokens: None,
            context_window: None,
        };
        assert_eq!(
            stream(&provider, &model, "Translate", "Hello", |_| Ok(())).await,
            Err("authentication".into())
        );
        mock.assert_async().await;
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
