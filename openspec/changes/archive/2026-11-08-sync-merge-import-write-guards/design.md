# Design

## Boundary

Merge and external import follow the write-boundary pattern established by the archive lifecycle: production entry points acquire the update-exit guard, the cross-process lease and the refresh mutex in that order, and per-item writes are reachable only through private functions (unguarded signatures survive only in `test`/`test-helpers` builds). IPC commands delegate with unchanged wire DTOs. No new dependency, transaction executor or crash-atomicity promise is introduced; ADR 1, 3 and 4 remain valid.

## Merge

Merge verification happens against live files before any destructive move: recorded owner roots (SSOT vs agent home), canonical containment, absence of symbolic links in sources, real-file SKILL.md, identical live content hashes, and an unoccupied destination. Originals and pre-existing cross-agent links are staged into same-filesystem `.<name>.backup.` temp directories (already excluded by scans) so rollback is a rename; staged links are re-created targeting SSOT and tracked as created links, which makes link rollback uniform. The cache commit evicts exactly the merged IDs — external and plugin namesakes survive — and metadata migrates as a union of user flags under the merged ID. Cache and metadata saves must both succeed before staging backups are discarded; otherwise files, links and stores roll back and incomplete recovery reports the retained backup location. Link-creation failure now rolls back the whole merge instead of logging and continuing; this is the one deliberate user-visible behavior change and is covered by the new capability spec.

## External import

Import pre-write validation rejects duplicate canonical sources, colliding flat link names and non-file SKILL.md before touching disk. Rollback ownership moves from per-entry bookkeeping (new IDs plus updated-entry clones) to the full pre-operation registry snapshot, which is strictly more general and deletes two bookkeeping mechanisms. Source scans and the batched cache commit (`upsert_cache_entries`, one persistence round) now abort the operation on failure — previously cache errors were ignored — while pre-existing links and original import timestamps are preserved. Retirement of renamed links and watcher registration stay best-effort post-commit.

## Repository discovery

Browsing and installation now share one traversal (`SkillService::repo_skill_roots`), replacing `CliService`'s second recursive scan. Observable semantics are unchanged: depth 20, skip dirs, symlink skipping, valid-root termination and nested-skill continuation, with boundary tests added. No spec delta is required; local install scanning intentionally remains separate.

## Verification

Real temporary-home tests cover: merge persistence failures (blocked `skills-cache.json.tmp`) preserving originals, links, flags and on-disk metadata; external-writer recreation during recovery retaining backups; refresh-waiting and lease release on cancellation; nested-link conflicts; spoofed ownership rejection; import duplicate selection, cache-commit failure, pre-existing link survival and import-timestamp preservation. Full Rust suite (406 passed), gate clippy, fmt, OpenSpec strict and ADR validation pass. Frontend and TypeScript CLI are unaffected by these rounds and pass under their own runners (`bun run test`, `bun run cli:test`).
