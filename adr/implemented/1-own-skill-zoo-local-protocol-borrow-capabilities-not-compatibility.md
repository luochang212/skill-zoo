---
status: implemented
date: 2026-10-20
raised-by: human
decided-by: human
created: 2026-10-20
commit: 18dcf84
description: Read before changing the local protocol (paths, metadata, locks, fixtures) or adding compatibility behavior for external skill managers.
paths: [docs/local-protocol.md, src-tauri/src/services/lock.rs, packages/cli/src/protocol, src-tauri/src/persistence/metadata.rs]
---

# ADR: 1 Own Skill Zoo's local protocol; borrow capabilities, not compatibility

## Problem

The 0.3.56 work treated "learn from `npx skills` / `gh skill`" as a protocol-compatibility mandate. It added shared-lock preservation/refusal, physical key resolution, metadata identity migration, gh provenance refusal, and a read-retry/ADR around external writers. Those mechanisms exist to coexist with schemas we do not own. They cost our users migration and refusal friction, and they let another tool's model constrain our design.

Skill Zoo's storage path overlaps with other tools, but overlap is not a contract. Simultaneous use of multiple skill managers is not a supported use case. The product should borrow capabilities, not chase compatibility.

## Decision

- Skill Zoo owns its local protocol: the lock, desktop metadata, archive/import formats, and CLI behavior are defined by us, documented in `docs/local-protocol.md`, and covered by our fixtures.
- We do not promise interoperability with `npx skill`, `gh skill`, or any other manager. Their readers/writers are not a supported surface; their schemas do not drive our design.
- We borrow ideas and capabilities when they improve our product, implemented under our semantics. Upstream code is reference, not a compatibility target.
- We do not degrade our users' experience for compatibility. A compatibility measure is considered only when it prevents a hygiene failure (data corruption/loss, unsafe write) or a real architecture problem, and only after an explicit UX/maintenance trade-off; otherwise we do the right thing for our own users.
- If compatibility falls out cheaply and incidentally, we may keep it, but it must not become a requirement, a test matrix, a migration, or a reason to add branches.
- Defensive hygiene remains: preserve unknown fields and refuse future schema versions so we do not corrupt data we do not understand. That is hygiene, not an interop promise; it does not require reading foreign semantics.
- Review existing compatibility-only mechanisms under this policy. Remove or narrow those that do not earn their UX/maintenance cost; do not add new ones without a new ADR that records the UX trade-off.

This supersedes the compatibility-first policy recorded on `next/curated` as ADR 1. That branch and `next/verified-baselines` are reference-only.

## Alternatives considered

- **Continue compatibility-first (the 0.3.56 direction).** Rejected: external schemas become our problem; migrations and refusals land on users who never mix tools.
- **Chase each upstream tool/version.** Rejected: unbounded coupling; every upstream change becomes our branch.
- **Move authoritative state to a private sidecar to escape the shared file.** Rejected: it adds a parallel lifecycle across install/update/delete/archive/restore on both runtimes; owning our protocol does not require a sidecar.
- **Read nothing from existing files and start over.** Rejected: users have existing data; we migrate/import it as our own protocol where needed, but we do not promise external interop.
- **Keep compatibility as a product goal but hide the cost.** Rejected: the cost is real (migration, refusals, ambiguity) and belongs in the decision record.

## Consequences

Bought:

- Product decisions are ours; external tools no longer set our roadmap or schema branches.
- Less compatibility surface and fewer migration/refusal paths to maintain.
- UX can be optimized for our users, including when another manager is installed.

Cost:

- Users who mix managers may see divergence or need to choose one; external tools may not read our files. This is documented as unsupported, not worked around.
- Some existing compatibility-only code and tests will be removed or narrowed; the reference branches keep the history.

Follow-ups:

- Audit the 0.3.56 compatibility work and remove what does not serve an own-protocol product (physical key resolution, gh provenance refusal, read-retry for external writers, compatibility docs/fixtures).
- Keep `docs/local-protocol.md` and its fixtures as our contract.
- Any future compatibility exception gets a new ADR with an explicit UX/maintenance rationale.
