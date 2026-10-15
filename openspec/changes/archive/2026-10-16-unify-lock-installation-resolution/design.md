# Design

## Context

B1 follows E1 (read-only Check), A1 (directory-based flags) and C2 (provenance protection). The shared lock is externally writable and no persisted association ledger can be authoritative.

## Goals / Non-Goals

Use one runtime association per surface. Preserve physical positions, exact original map keys, unknown fields, pins and baselines. Do not implement C1, reconstruct provenance, move files, rekey shared locks, migrate old archives or add a journal.

## Decisions

Rust lock.rs owns pure association types/logic; skill.rs collects all real SSOT and agent installations, excluding external registrations. CLI lock-resolution.ts owns matching behavior. Ignore symlink aliases and app staging/backup directories, retain .system. Inventory is independent of visibility. SSOT exact/leaf candidates require uniqueness; namespace and agent candidates require matching GitHub repo plus normalized source directory evidence. Exact keys do not override competing candidates. Reverse ownership prevents sharedEntry. Valid contradictory evidence is Ambiguous.

Keep original skillPath untouched; derive a safe directory view by removing only a complete final SKILL.md component. Lock keys are never normalized. KnownSkillUpdate separates install_directory and lock_key. Before replacement, re-read inventory and lock, compare association and complete entry snapshot, and apply C2 byte/identity revalidation. Lock mutation closures perform only memory comparisons/writes.

Check prepares physical inventory targets and projects pure resolution/remote results into physical skillName statuses. Missing and ambiguous targets produce issues and dangling lock records do not become targets. Archive captures exact association before side effects; restore checks the original key plus proposed target association before moving. Equal entries require no write; rollback restores only changed keys.

## Risks / Tradeoffs

No format changes: explicit read/refusal compatibility revision, paired desktop/CLI upgrade, no storage migration. Uncorroborated namespace suffixes remain unbound. C2 continues refusing tracked remote updates. Non-cooperating external writers can race final validation/rename or directory replacement/lock commit; this is not an atomic cross-tool transaction. Re-enumeration fails closed when inventory is incomplete.

## Validation

Shared real directory scenarios and ambiguity matrix, actual scan/lifecycle/update paths, Check-to-checked identity, archive conflict and rollback injection, network barrier mutation tests, and all requested repository gates. Record concrete results in /tmp/codex-b1-report.md.
