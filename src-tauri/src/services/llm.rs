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
    let target = ServiceTarget {
        model: ModelIden::new(adapter(provider.protocol), model.id.clone()),
        endpoint: Endpoint::from_owned(provider.base_url.clone()),
        auth: AuthData::RequestOverride {
            url,
            headers: headers.into(),
        },
    };
    let mut options = ChatOptions::default()
        .with_stream_header_timeout(Duration::from_secs(30))
        .with_stream_read_timeout(Duration::from_secs(30));
    if let Some(max) = model.max_output_tokens {
        options = options.with_max_tokens(max);
    }
    let request = ChatRequest::new(vec![ChatMessage::system(system), ChatMessage::user(input)]);
    let response = client
        .exec_chat_stream(target, request, Some(&options))
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
