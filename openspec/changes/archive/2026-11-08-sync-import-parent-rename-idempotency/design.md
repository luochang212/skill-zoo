# Design

Pure spec sync of already-shipped behavior (commit `14bed88`). The retirement condition compares `SkillService::agent_link_name` on the old and new recorded directories (`src-tauri/src/commands/skill.rs`), so only genuine link relocation retires old links; the registry always records the new directory and preserves `importedAt`. Covered by `external_import_commit_preserves_preexisting_links_on_failure` (same-directory, parent-change, leaf-change and cache-failure cases). No code, fixture or protocol-format change.
