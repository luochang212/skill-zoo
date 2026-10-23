# Design

Context: a worth-fix evaluation (security review of the token feature, 2026-10-15) verified the gaps this change closes. Evidence is recorded here so the reasoning survives the diff.

## Verified facts (empirical)

- `~/.skill-zoo/settings.json` on a real machine is `-rw-r--r--` with `umask 0022`; the only writer is `persistence::atomic_write` (`File::create` → `0o666 & ~umask`). Home is `drwxr-x---` (owner + staff), and macOS local users are in `staff`, so another local user can read the file on a shared machine.
- Agent lifecycle transactions journal the full `settings.json` content (before/after) into `agent-lifecycle.json` (`commands/agents.rs` → `agent_transaction::commit`), so a token lands there too.
- Frontend `update_setting` callers only write `theme`, `hide_non_ssot`, and the skill-usage agent; no caller writes the credential keys. The CLI never touches `github_token` (grep across `packages/cli`).
- The renderer receives the raw token via `get_settings` (full settings map); see Accepted trade-offs.

## Decisions

1. **Scoped owner-only helper, not a global change.** `atomic_write` is shared by 13 call sites including user-owned skill files (`commands/skill.rs` `writable_path`) and `~/.agents/.skill-lock.json`. Globally forcing `0600` would silently change permissions of user content beyond the app's private directory. Instead, a new `atomic_write_private` is used only where credential content is persisted: `Settings::save` and `agent_transaction::write_snapshots` (covers journal writes and crash recovery). Files without secrets keep current behavior.
2. **Remove the stale temp file first.** POSIX `open(O_CREAT)` applies mode only at creation; a `.tmp` left by a crashed write would keep its old (loose) mode and the fix would silently fail on reuse. The helper deletes the temp file before creating it. Same-process writers are serialized by the agent lease; the cross-writer temp race is pre-existing behavior of `atomic_write` and is not widened here.
3. **Unix-gated mode, Windows unchanged.** `OpenOptionsExt::mode` is unix-only; on Windows the helper delegates to the existing write (files inherit user-profile ACLs, which already protect them).
4. **Reject exactly the two credential keys in `update_setting`.** The error names the credential save command. This turns the invariant the fallback design documents ("credential changes go through the save command") from prose into an enforced gate, and matches its "loud failure" principle: a future second write path fails loudly instead of silently bypassing the runtime slot refresh.
5. **CLI parity deferred.** The CLI's Node journal implementation writes `settings.json` back with default permissions during CLI agent operations. Permissions are not part of the local protocol shape (fixtures assert content), so this is not a protocol conflict; the exposure reopens only intermittently and the next desktop save re-heals it. Adding `{ mode: 0o600 }` to the CLI journal writer is a small follow-up, kept out of this change to respect the approved desktop-side scope.

## Threat model (why severity is low but the fix is worth it)

Attacker = another local user or malware with a different local account. No victim action is required beyond the token existing on disk (deterministic exposure); exploitation requires a multi-user machine (rare for the typical single-user Mac). Impact if read: the token is a fine-grained PAT with public-repo read and zero permissions, so the worst case is quota theft and nothing private. Not fixing leaves the exposure open permanently; the fix is cheap, which is why this is a hygiene-level fix rather than an expected-value one.

## Accepted trade-offs

- **Renderer token exposure (not fixed here).** The raw token remains readable in the renderer via `get_settings` for dialog prefill. Renderer compromise already implies broader compromise through existing IPC commands (skill file writes/deletes); CSP `connect-src` restricts egress to GitHub hosts, and a zero-permission token cannot exfiltrate via GitHub write APIs. Revisit if the token gains permissions or when migrating to the keychain, and merging `useGitHubToken`/`useGitHubTokenExpiresAt` into one credentials query is the natural vehicle then.
- **Intermittent CLI re-exposure** as described in Decision 5.

## Verification boundary

Empirical: real-file permissions, umask, journal content embedding, caller inventories (above). Structural: POSIX open-mode semantics (mode applies at creation only) and reqwest redirect header stripping were reasoned from documented library behavior, not reproduced in this repo's tests. The permission regression test uses a `mode & 0o077` mask assertion rather than an exact `0600` so CI umask variation cannot flake it.
