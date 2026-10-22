# Tasks

## 1. Backend: plugin source discovery

- [x] 1.1 Parse `~/.claude/plugins/installed_plugins.json` (version 2 shape) tolerantly: missing/unreadable file yields no manifest sources, unknown shapes are skipped without failing the scan.
- [x] 1.2 Implement discovery over the two source kinds — manifest `installPath` entries and `marketplaces/*/skills/` clones — recognizing only `skills/<name>/SKILL.md`, and produce scan entries with a distinct plugin origin carrying plugin + marketplace provenance.
- [x] 1.3 Wire discovery into the existing cache-rebuild pipeline, gated on claude-code visibility, and add backend unit tests with fixture plugin trees: installed plugin with skills, marketplace clone, stale cache version ignored, unreadable manifest degrades, collision names stay separate.

## 2. Backend: read-only enforcement

- [x] 2.1 Add a plugin-path guard to the write commands (save, link, archive, remove, merge, update) that refuses plugin-owned targets with an error naming the owning plugin; add refusal tests for each command family.
- [x] 2.2 Exclude plugin skills from duplicate/consistency checks and install preflight scope, per the local-skill-scope delta; add scope tests.

## 3. Frontend: read-only local entries

- [x] 3.1 Render plugin skills on the Local page with provenance labels (plugin, marketplace) and read-only affordances; hide install/link/archive/delete/update actions; add EN/ZH strings.
- [x] 3.2 Open plugin skills in the editor's read-only mode from the Local page and the file tree.
- [x] 3.3 Frontend tests: provenance rendering, hidden actions, read-only editor state, and visibility toggling with the claude-code agent.

## 4. Verification

- [x] 4.1 Run `cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml` and `bun run test`; run `bun run lint` and `bun run format`.
- [x] 4.2 Verify against a real `~/.claude/plugins` installation: installed-plugin and marketplace skills appear with provenance, stale cache versions do not, and a plugin update is reflected after the next rebuild.
- [x] 4.3 Sync affected main specs (`plugin-skill-visibility` new, `local-skill-scope` modified) and pass `openspec validate --all --strict` before archive.
