import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import "sonner/dist/styles.css";
import "@/i18n";
import App from "./App";
import "./index.css";
import { formatApiError } from "@/lib/api/errors";
import { AppUpdaterProvider } from "@/hooks/useAppUpdater";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: (err) => toast.error(formatApiError(err)),
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppUpdaterProvider>
        <App />
      </AppUpdaterProvider>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  </React.StrictMode>,
);
