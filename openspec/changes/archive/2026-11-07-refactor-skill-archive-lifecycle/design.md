# Design

## Boundary

The archive service owns batch orchestration. Private per-item operations require a write context that acquires the cross-process lease before the refresh mutex (matching existing install/update lock order), and retains the update-exit guard through completion. No Tauri AppHandle/State is required to test it. IPC commands only delegate, with unchanged wire DTOs.

## Identity and snapshots

An archiveable target distinguishes SSOT from an agent-owned real directory and retains its resolved home. External/plugin sources are rejected before mutation. Only an SSOT target snapshots/removes its installation lock record. Restore scans the recorded concrete home using its recorded owner, instead of searching globally by name; registered retained imports still take ownership priority.

An operation snapshot owns cache, metadata, manifest and lock state. Both flows use the same store recovery method, with state locks released before recovery and incomplete recovery reported. Filesystem moves and link reversals remain explicit per operation; there is no generic transaction executor. Already committed files are not given new crash/power-loss guarantees.

## Protocol and side effects

No fields or versions change. Under the user's explicit authorization to drop unnecessary historical compatibility, only owned SSOT/agent records can be restored; external/plugin/unknown records and agent records lacking their original home are refused without moving/deleting files. Old agent lock snapshots are ignored. Cheap deterministic SSOT-home and metadata-ID migration remain supported. Both shared scenario fixtures pin these boundaries in Rust and CLI. Preserve metadata OR-merge, nested flat links and valid original destinations; do not change copy/link cleanup policies.

The optional background SHA baseline writer must acquire the same local lease and compare the checked lock entry before writing. This closes a writer that would otherwise invalidate the lifecycle snapshot's exclusion assumption. Its network checks and best-effort retry behavior stay unchanged. Snapshot restoration uses the existing lock-file writer mutex too.

## Verification

Characterize roundtrips, same-name ownership, legacy identities and real cache/metadata/link/lock failures using temporary homes. Test mutex waiting and lease release on cancellation. Keep the old path deleted after migration, run whole Rust/CLI/frontend suites and lint/type/format/OpenSpec/ADR gates. Measure whether coordination and rollback decisions now have one owner; line count alone is not an acceptance criterion.
