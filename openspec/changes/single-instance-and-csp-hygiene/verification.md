# Verification

## Evidence from the worth-fix evaluation (pre-implementation)

- **Double launch, before the fix**: `open -n /Applications/skill-zoo.app` with the dev instance running produced two concurrent GUI processes (dev `target/debug/skill-zoo` pid 13802 + release 0.4.8 pid 20882), each with its own window and tray. `~/.skill-zoo/skills-cache.json` was rewritten by the second instance and remained valid JSON (68 entries), confirming the self-heal path; the risk window (cross-process `SkillLock` read-modify-write losing fields, same-name `atomic_write` temp tearing) is structural: `services/lock.rs` uses a process-wide mutex only, and `persistence/mod.rs` shares one temp-sibling name across processes.
- **Navigation attack surface already closed**: every markdown link is intercepted with `preventDefault` + `opener` (`MarkdownContent.tsx`); wry's macOS UIDelegate returns `None` for `createWebViewWith` when no new-window handler is set, so `window.open` is a no-op; no `window.location` assignments; script injection requires breaking CSP `script-src 'self'` + rehype-sanitize first.
- **Stale CSP domains**: no `fetch`/axios/XHR usage of the four GitHub domains anywhere in `src/`; `connect-src` does not govern `<img>` loading, so remote README images via `img-src https:` are unaffected.
- **Dead fallback**: `AboutSection.tsx` used `window.open` as a fallback that wry denies by default.

## Post-implementation checks

- Rust: `cargo build`, `cargo clippy --features test-helpers -- -D warnings`, and `cargo test --features test-helpers` all pass (plugin resolves to `tauri-plugin-single-instance v2.5.5`).
- Frontend: typecheck, oxlint (0 warnings/0 errors), oxfmt check, and the full vitest suite pass — 54 files / 494 tests, including the new `AboutSection.test.tsx` (opener success opens without toasting; opener failure shows exactly one error and never calls `window.open`).
- OpenSpec: `npx openspec validate --all --strict` — 20 passed, 0 failed, including the new `app-lifecycle` capability delta.
- **Live single-instance check, after the fix**: with the rebuilt dev instance running (pid 24134, restarted 12:18:57), launching a second `target/debug/skill-zoo` process exited on its own within seconds; only the first instance remained. (Before the fix the same check left two processes running.)
- Not verified programmatically: window focus/unminimize on forwarding is asserted only by the callback running without error in the first instance (process-level behavior; manual visual check confirmed the window came to front).
- `adrkit validate` and the pre-push hook were not run: `adrkit` is not installed on this machine and no `adr/` records were touched. `adr/implemented/` contains no record covering CSP, launch behavior, or single-instance semantics (verified by listing and grep).
