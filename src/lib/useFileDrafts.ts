import { useCallback, useRef, useState } from "react";

type SaveCheckpoint = { session: number; path: string; content: string | undefined };

export function useFileDrafts() {
  const [drafts, setDrafts] = useState(() => new Map<string, string>());
  const current = useRef(drafts);
  const session = useRef(0);

  const reset = useCallback(() => {
    session.current += 1;
    current.current = new Map();
    setDrafts(current.current);
  }, []);

  const change = useCallback((path: string, content: string, baseline?: string, saving = false) => {
    const next = new Map(current.current);
    if (content === baseline && !saving) next.delete(path);
    else next.set(path, content);
    current.current = next;
    setDrafts(next);
  }, []);

  const has = useCallback((path: string) => current.current.has(path), []);
  const checkpoint = useCallback(
    (path: string): SaveCheckpoint => ({
      session: session.current,
      path,
      content: current.current.get(path),
    }),
    [],
  );
  const acknowledge = useCallback((saved: SaveCheckpoint) => {
    if (saved.session !== session.current || current.current.get(saved.path) !== saved.content)
      return;
    const next = new Map(current.current);
    next.delete(saved.path);
    current.current = next;
    setDrafts(next);
  }, []);

  return { drafts, reset, change, has, checkpoint, acknowledge };
}
