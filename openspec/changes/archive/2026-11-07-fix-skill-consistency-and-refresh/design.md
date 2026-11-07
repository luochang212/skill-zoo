# Design

## Context

The filesystem owns skill content; the cache is derived. Rust already has a rollback-capable batch commit helper and a serialized installed-skill refresh. CLI consistency has its own implementation, while the desktop behavior is authoritative (ADR 1).

## Decisions

- Filter external imports once at the CLI consistency entry and require all hashes. Preserve CLI's all-agent scanning and its documented independence from desktop display preferences.
- Keep directory resolution in scan_single_skill, then delegate record construction to scan_skill_root. Preserve rejection of symlink-only SSOT homes and real-agent identity.
- Reuse batch commit for incremental cache writes. Put watcher scanning and commit under the same refresh mutex as full rebuilds. Updates refresh only successfully updated SSOT directories, using the existing installed-skill refresh path; refresh errors reach the caller and update history.
- Delete only unreachable external branches inside archive_skill_inner. Restore may read historical manifests, so its external handling stays.
- Do not split command/service files or introduce a framework. File size and mixed responsibilities alone do not demonstrate enough benefit for a broad refactor.

## Risks and verification boundaries

Cache failures cause stale derived state, not demonstrated loss of source files. Tests use isolated temporary homes and actual filesystem failures. Scheduling tests hold the real refresh mutex; no real desktop window or live GitHub update is required. Command wiring is checked structurally where a Tauri State/AppHandle is unavailable. Full hardware/platform and crash/power-loss guarantees are outside this repair.
