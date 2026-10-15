---
status: implemented
date: 2026-10-16
raised-by: human
decided-by: human
created: 2026-10-16
commit: e3b6a0a
tags: [compatibility, architecture, local-protocol]
paths: [src-tauri/src/services/lock.rs, src-tauri/src/persistence/metadata.rs, src-tauri/src/services/skill_provenance.rs, packages/cli/src/protocol/, docs/local-protocol.md, fixtures/local-protocol/]
---

# ADR: 1 Keep shared-surface compatibility by preserving or refusing, never interpreting

## Problem

`~/.agents/.skill-lock.json` v3 and desktop-owned metadata are co-written by Skill Zoo and external tools (`npx skills` / vercel-labs/skills, `gh skill`). Each external tool has its own schema, key conventions, and rewrite semantics. Committing to compatibility with all of them can grow without bound: every new upstream field or version becomes another branch to maintain, and every attempt to *interpret* foreign data couples us to semantics we do not own.

The recent compatibility work measured out unevenly. Removing the update-check baseline self-heal (E1) was a net deletion. Stabilizing user metadata identity (A1), refusing updates that strip gh provenance (C2), and resolving installations by physical directory and original lock key (B1) added roughly 3.9k lines of production code plus ~1.7k of tests. The expensive parts were migration and cross-tool semantics, not preservation.

## Decision

For shared surfaces we separate three things and pay only for the first two:

- **Preserve** unknown entry-level and top-level fields verbatim (`#[serde(flatten)]`); never interpret or rewrite them.
- **Refuse** to write lock/archive/metadata versions above what we support, preserving the original bytes; never attempt to interpret a future schema.
- **Interpret only fields we consume** (baseline carrier read order, gh provenance keys, metadata identity), specified in `docs/local-protocol.md`, pinned to an audited upstream version, and covered by shared fixtures.

Adopted as policy:

1. Prefer a general mechanism (preserve/refuse) over per-field or per-version branches; add a key or version branch only when we actually consume it.
2. Freeze per-tool coupling (reserved provenance keys, `pinnedRef`) at the audited upstream version; add a watch trigger that deletes a defense when upstream changes, instead of pre-adding defenses.
3. Backward migrations are one-time and get a retirement window; migration branches must be deletable, not permanent.
4. Keep identity and association logic in one resolver per surface; call sites must not carry their own fallbacks.
5. Do not build speculative compatibility (for example provenance reconstruction) without demonstrated need.
6. Treat compatibility as a cost paid by all users for mixed-tool users; re-evaluate its scope when the user base changes.

## Alternatives considered

- **Chase each upstream field or version with dedicated branches.** Rejected: O(n) growth in code and tests, unbounded by design — the exact bloat failure mode.
- **Own the shared file unilaterally and stop preserving foreign fields.** Rejected: the lock is a shared interop surface; we cannot unilaterally change its contract, and dropping fields would silently destroy other tools' data.
- **Move our state to a private sidecar ledger.** Rejected for the baseline carrier earlier in the same work: it removes shared-file coupling by introducing a parallel lifecycle across install/update/delete/archive/restore on both runtimes — more complexity, not less.
- **Accept the incompatible states as data loss.** Rejected: the losses are silent (baselines stripped, user flags detached, gh provenance wiped) and self-disguising as "no update available".

## Consequences

Bought:

- Unknown fields written by other tools survive our rewrites; a file written by a newer version cannot be corrupted by an older writer.
- Complexity stays bounded and centralized in a few modules instead of scattered ad-hoc fallbacks.
- Silent corruption is replaced by explicit states: needs re-confirmation, gh provenance protected, lock ambiguous, lock missing.

Cost:

- Migration code (metadata v0 to v1) and conservative refusal paths persist; they are maintenance surface and add user-facing friction ("why can't I update this skill?").
- Coupling remains for the fields we do interpret; it needs watch triggers and deletion when upstream changes.
- Ambiguity and mixed batches now refuse instead of "working by luck"; single-tool users pay for insurance they may not need.

Follow-ups:

- Give the metadata v0 migration a retirement window so its branch can eventually be deleted.
- Keep watch triggers current and retire defenses whose upstream condition is gone.
- Enforce "all consumers use the shared resolver" with a conformance test so B1's fix cannot be bypassed.
