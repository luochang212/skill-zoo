# Design

## Context

See proposal.md for motivation. gh v2.102.0 injects metadata.github-repo/ref/tree-sha/path and optional github-pinned. Desktop updates replace directories; the companion CLI has no remote update surface. Lock ownership remains desktop-defined.

## Goals / Non-Goals

Protect actual installed SKILL.md independently of lock lookup, before remote work and replacement. Normal Skill Zoo files retain their update behavior. No B1 resolver/rekey, C1 YAML projection, installer registry, automatic gh execution or repair of lost fields.

## Decisions

- A separate services/skill_provenance.rs uses serde_yaml Value, duplicate-key rejection, tag rejection and apply_merge. The permissive display parser cannot authorize writes. Only leading independently delimited frontmatter is inspected, supporting BOM, CRLF and leading blank lines.
- Any reserved metadata key (including null/non-string values and legacy github-owner/github-sha) is Tracking. Safe ordinary metadata is Absent. Invalid, unclosed, duplicate, tagged or unreadable data is Unreadable. Root keys and body examples do not count.
- Capture original bytes, canonical directory identity and directory creation identity (plus Unix device/inode) before network work. Carry the snapshot through tree discovery and ZIP download. Revalidate before staging and immediately before rename; never refresh authorization from changed text. Staging is temporary and cleaned on rejection.
- Local read/boundary issues precede tracking, which precedes pin/baseline/source issues. Reuse checkErrorCode and existing command/batch errors. Only successful replacements advance lock entries; a wholly refused batch does not write the lock.
- Tests use thread-scoped temporary homes and a test-only HTTP endpoint substitution. Real HTTP/ZIP, command inner bodies and service paths run; barrier-controlled external writes assert preservation of the external state. CLI tests execute scan/archive/restore only.

## Risks / Trade-offs

- Reserved names written by upstream authors also block updates → document conservative detection, not proof of installer history.
- Previously stripped tracking cannot be detected → no automatic reconstruction or historical claim.
- Non-cooperating tools can write between final read and rename → this is observed-change protection, not cross-tool CAS; AgentLease only coordinates participating writers.
- Existing lock association and namespace mismatch remain → ship C2 before B1; never expand update reachability here.
- Directory replacement and lock commit are not a cross-object transaction → retain existing failure behavior for successful replacement paths, do not claim broader rollback guarantees.

## Migration Plan

No stored-state migration: lock v3, archive v1 and metadata v1 remain unchanged. Deploy read/refusal semantics and UI text together. Existing skill bytes stay untouched. Rollback removes guards but restores the old provenance-loss risk. Keep this change available for review; do not commit, push or archive it in this task.
