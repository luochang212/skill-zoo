# Design

## Context

See proposal.md for motivation. Metadata is authoritative user data; cache is disposable. SSOT directory is available independently of provenance. Imports may retain historical repo IDs and must not lose ownership.

## Goals / Non-Goals

Goals: durable slot flags across provenance churn, cache deletion and restart; matching desktop/CLI migration and lifecycle semantics.
Non-goals: persistent skill UUIDs, moving flags with offline directory renames, source/lock repair, A2 aliases, and changing cache IDs.

## Decisions

- SSOT keys are `ssot:<relative directory>` with complete nested paths. Reject empty, absolute, backslash, colon, dot and parent components rather than guess a leaf or allow escapes. Other origins keep their IDs.
- Metadata v1 contains version and entries. Preserve unknown top-level fields. Reject unknown entry fields to avoid silently consuming information migration cannot interpret. Future versions remain unwritable.
- Migration uses actual SSOT SKILL.md paths and parseable historical repo IDs, never cache. Exclude imports' retained IDs. Equal candidates can move together; target disagreement or contradictory candidates leaves all original records intact. No OR. Missing skills remain intact.
- v0 migration re-reads under the shared lease and atomically commits only metadata. v1 does not retry migration. Concurrent CLI readers share a single in-flight migration, preventing duplicate temporary-file writes during WUI parallel scans. Unbound records are diagnostic data, never fallback aliases. Explicit CLI resolution selects a destination or discards one record.
- Current cache IDs remain provenance-derived; CLI accepts exactly two nonempty source segments, matching Rust.
- Archive v1 retains historical originalSkillId and flag snapshot. Restore writes flags using origin/directory destination identity. Explicit duplicate merge retains its preexisting OR product behavior.

## Risks / Trade-offs

- Slot replacement inherits flags → document this intentional semantic.
- Offline moves cannot carry flags automatically → explicit manual assignment.
- Old writers ignore version guards → upgrade both surfaces together; downgrade only with offline backup restoration.
- Unparseable historical data cannot be safely attributed → preserve and report, explicit assignment/discard.
- Shared lease only coordinates cooperating clients → do not claim protection from arbitrary external metadata edits.

## Migration Plan

Upgrade desktop and CLI together. Read v0, acquire shared lease, re-read, migrate proven candidates, atomic v1 save. Preserve failed writes and ambiguous entries. Keep offline backups for downgrade; never use backups as runtime sources. Verify with shared fixtures and production scan/archive/restore flows.

## Verification

Full Rust suite: 277 passed, 2 preexisting ignored; frontend: 208 passed; CLI: 115 passed. Both typechecks, lint, cargo fmt and strict OpenSpec validation passed. Shared fixtures exercise conflicting candidates, target disagreements, retained imports, nested directories, missing skills, opaque top-level fields and future-version refusal. Production scans exercise valid/malformed/missing provenance without cache evidence. Rust tests invoke the actual CLI for both archive/restore directions; both runtimes restore archive-v1-full.json using the current slot key. Explicit merge OR and CLI assignment/discard are covered separately from automatic migration.
