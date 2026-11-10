import { createContext } from "react";
import type { RepoTasksState } from "./useRepoTasks";

export const RepoTasksContext = createContext<RepoTasksState | null>(null);
