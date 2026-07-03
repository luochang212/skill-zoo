export interface AgentConfig {
  id: string;
  label: string;
  skillsSubdir: string;
}

export const AGENTS: AgentConfig[] = [
  { id: "claude-code", label: "Claude Code", skillsSubdir: ".claude" },
  { id: "codex", label: "Codex", skillsSubdir: ".codex" },
  { id: "gemini", label: "Gemini", skillsSubdir: ".gemini" },
  { id: "opencode", label: "OpenCode", skillsSubdir: ".opencode" },
  { id: "cursor", label: "Cursor", skillsSubdir: ".cursor" },
  { id: "trae", label: "Trae", skillsSubdir: ".trae" },
  { id: "trae-cn", label: "Trae CN", skillsSubdir: ".trae-cn" },
  { id: "hermes", label: "Hermes", skillsSubdir: ".hermes" },
  { id: "openclaw", label: "OpenClaw", skillsSubdir: ".openclaw" },
  { id: "workbuddy", label: "WorkBuddy", skillsSubdir: ".workbuddy" },
  { id: "qoder-cn", label: "Qoder CN", skillsSubdir: ".qoder-cn" },
  { id: "qoderworkcn", label: "QoderWork CN", skillsSubdir: ".qoderworkcn" },
];

export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__"]);
