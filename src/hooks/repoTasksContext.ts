import { createContext } from "react";
import type { RepoTasksState } from "./useRepoTasks";

// Keep context identity stable when task components and hooks hot-reload.
export const RepoTasksContext = createContext<RepoTasksState | null>(null);
