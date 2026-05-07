import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";

/**
 * Create a QueryClient configured for testing:
 * - retries disabled (fail fast)
 * - gcTime Infinity (prevent garbage collection during test —
 *   gcTime 0 causes data loss when a query has no active observers,
 *   which breaks optimistic update tests)
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * Create a wrapper that provides QueryClientProvider for hook tests.
 * Each call creates a fresh QueryClient to avoid cross-test pollution.
 */
export function createQueryWrapper() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, queryClient };
}

/**
 * Render a hook with QueryClientProvider.
 * Convenience wrapper around renderHook + createQueryWrapper.
 */
export function renderHookWithQuery<TResult>(hook: () => TResult) {
  const { wrapper, queryClient } = createQueryWrapper();
  return {
    ...renderHook(hook, { wrapper }),
    queryClient,
  };
}
