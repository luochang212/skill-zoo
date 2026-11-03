import { Channel, invoke } from "@tauri-apps/api/core";

export type LlmProtocol = "anthropic-messages" | "openai-chat-completions" | "openai-responses";
export interface LlmModel {
  id: string;
  enabled: boolean;
  maxOutputTokens: number | null;
  contextWindow?: number | null;
}
export interface LlmProvider {
  id: string;
  name: string;
  enabled: boolean;
  protocol: LlmProtocol;
  baseUrl: string;
  hasApiKey: boolean;
  models: LlmModel[];
}
export interface ProviderUpdate {
  id: string | null;
  name: string;
  enabled: boolean;
  protocol: LlmProtocol;
  baseUrl: string;
  apiKey: string | null;
  models: LlmModel[];
}
export interface TranslationPreferences {
  targetLanguage: string | null;
  providerId: string | null;
  modelId: string | null;
  preferCachedTranslations?: boolean;
}
export interface TranslationRequest {
  taskId: string;
  skillId: string;
  path: string;
  source: string;
  providerId: string;
  modelId: string;
  targetLanguage: string;
  force: boolean;
}
export type TranslationEvent =
  | { type: "preview" | "completed"; taskId: string; text: string }
  | { type: "failed"; taskId: string; code: string };

export const translationApi = {
  providerApiKey: (id: string) => invoke<string>("get_llm_provider_api_key", { id }),
  cached: (request: Omit<TranslationRequest, "taskId" | "force">) =>
    invoke<string | null>("read_cached_translation", { request }),
  testConnection: (request: { provider: ProviderUpdate; modelId: string }) =>
    invoke<number>("test_llm_connection", request),
  resolveModel: (baseUrl: string, modelId: string) =>
    invoke<{ contextWindow: number | null; maxOutputTokens: number | null } | null>(
      "resolve_model_configuration",
      { baseUrl, modelId },
    ),
  providers: () => invoke<LlmProvider[]>("list_llm_providers"),
  saveProvider: (provider: ProviderUpdate) =>
    invoke<LlmProvider[]>("upsert_llm_provider", { provider }),
  deleteProvider: (id: string) => invoke<void>("delete_llm_provider", { id }),
  recoverProviders: () => invoke<void>("recover_llm_providers"),
  preferences: () => invoke<TranslationPreferences>("get_translation_preferences"),
  savePreferences: (preferences: TranslationPreferences) =>
    invoke<void>("save_translation_preferences", { preferences }),
  clearCache: () => invoke<void>("clear_translation_cache"),
  start: (taskId: string) => invoke<void>("start_translation_task", { taskId }),
  cancel: (taskId: string) => invoke<void>("cancel_translation", { taskId }),
  translate: (request: TranslationRequest, onEvent: (event: TranslationEvent) => void) => {
    const channel = new Channel<TranslationEvent>();
    // Tauri Channel exposes onmessage; it is not a DOM EventTarget.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    channel.onmessage = onEvent;
    return invoke<void>("translate_skill", { request, channel });
  },
};
