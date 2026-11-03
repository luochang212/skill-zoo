import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  translationApi,
  type ProviderUpdate,
  type TranslationPreferences,
} from "@/lib/api/translation";

export const PROVIDERS_KEY = ["llmProviders"] as const;
export const TRANSLATION_PREFERENCES_KEY = ["translationPreferences"] as const;
export function useSkillProviders(enabled = true) {
  return useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: translationApi.providers,
    retry: false,
    enabled,
  });
}
export function useTranslationPreferences(enabled = true) {
  return useQuery({
    queryKey: TRANSLATION_PREFERENCES_KEY,
    queryFn: translationApi.preferences,
    retry: false,
    enabled,
  });
}
export function useSaveTranslationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (preferences: TranslationPreferences) => {
      await translationApi.savePreferences(preferences);
      return preferences;
    },
    onSuccess: (preferences) => qc.setQueryData(TRANSLATION_PREFERENCES_KEY, preferences),
  });
}
export function useSaveSkillProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: ProviderUpdate) => translationApi.saveProvider(provider),
    onSuccess: (providers) => qc.setQueryData(PROVIDERS_KEY, providers),
  });
}
export function useDeleteSkillProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: translationApi.deleteProvider,
    onSuccess: () => qc.invalidateQueries({ queryKey: PROVIDERS_KEY }),
  });
}
