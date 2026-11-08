# Changelog

## [0.4.7] — 2026-11-08

### Changed
- Skill updates bind their version baseline to the downloaded archive's own commit instead of the branch's later state, recheck the remote folder hash immediately before replacing files, and keep the original directory until the metadata write succeeds — a failed update restores the original files.
- Skills installed before version tracking keep their unknown version and report a missing-baseline issue instead of being silently matched to today's remote state; an explicit update from the skill detail establishes a baseline.
- Clearing the download cache only removes completed archives: in-flight downloads, links and unknown files are preserved, and cleanup failures are reported with their paths instead of silently ignored.
- Plugin visibility switches show the chosen state immediately while saving, restore the previous value when the save fails, and keep the saved value when a later scan fails.
- Local skill cards use a slightly narrower minimum width (233px), fitting three columns at smaller window sizes.
- Dependencies refreshed across the frontend, CLI and Rust crates, including i18next 27, react-i18next 18 and rusqlite 0.41.

## [0.4.6] — 2026-11-08

### Changed
- Merging duplicate skills now verifies live ownership, content and link structure before moving anything, stages same-filesystem backups of the originals and existing cross-agent links, and commits the stores only after every save succeeds. A failed merge restores the originals, links and metadata instead of leaving the merge half-applied.
- External import registration rejects duplicate sources and colliding link names before writing anything, and a failed import restores the previous registry while preserving pre-existing links and original import timestamps.
- Archiving and restoring run through a guarded lifecycle service: restore resolves the physical source explicitly and keeps the original files untouched when it rejects unsupported records — external or plugin-owned items, and agent archives whose recorded home no longer exists.
- The CLI archive path follows the same provenance rules: only store-managed skills update the agent lock, and unsupported cases are rejected without moving files.
- Main-file and companion-file editing now share one draft implementation, so unsaved-change prompts and revert handling behave the same across the file views.
- Skill card titles use a slightly softer text color.

### Fixed
- Re-importing the same external skill through a changed parent directory no longer removes the agent links it just recreated.
- Refresh and update operations report cache-refresh failures instead of succeeding silently; background file changes wait for running refreshes and fall back to a full rebuild when an incremental update fails.
- A failed cache save no longer leaves the in-memory cache diverging from disk: incremental batch commits restore the previous snapshot.
- Skill scans agree on identity, origin and legacy lock metadata for nested skills regardless of which scan path found them.
- CLI consistency no longer reports external imports as conflicts or mismatches, and treats same-name copies as identical only when every copy has a verified matching content hash — unavailable hashes fall back to a conservative conflict.

## [0.4.5] — 2026-11-07

### Added
- The Discover page recommends popular and 24-hour trending skills from skills.sh. Community cards identify their source and metric period, sketch weekly install trends, and open a live preview that installs through the existing agent-selection flow. Saved catalog results remain browsable when the upstream request fails.

### Changed
- Cached translations are reused across providers, models and output settings. Switching models keeps previously translated content readable, and a failed retranslation preserves the last successful text instead of losing it.
- The installation dialog uses checkboxes with a select-all control instead of agent switches.
- Loading skeletons on the local and Discover pages match the real card layout, fill three rows, and hand over to content with a soft highlight; the skill preview shows a realistic skeleton and a compact install bar with a thin progress line.

### Fixed
- The skill preview keeps its install footer visible while installation status loads.

## [0.4.4] — 2026-11-07

### Added
- Repository loading continues in the background across page navigation. A header task menu tracks progress with retry and dismissal, keeps per-repository skill selections, and returns directly to the prepared skill list.
- Translated descriptions appear in the live preview as soon as the description stream completes, without waiting for the document body.
- The Markdown reader renders emphasis and strikethrough correctly around Chinese, Japanese and Korean punctuation.
- Relative links and heading anchors navigate inside the skill reader, revealing the target file in the file tree; repository README links open the matching GitHub page in the browser.

### Changed
- Settings, skill creation and the Discover page load on first navigation, reducing the JavaScript parsed at startup.
- Discovery repository details show metadata and the skill list without requesting a README, and full-page skeletons fill the default window while loading.
- The local toolbar stays on one line with agent names fading when space is tight, and agent tab widths stay stable when space allows.
- Local skill cards use a slightly narrower minimum width, fitting more columns at the default window size.

### Fixed
- skills.sh discovery retains repositories with dotted names such as `citypaul/.dotfiles` while still excluding domain-based sources.
- Interrupted repository ZIP downloads no longer leave partial temporary files behind on errors or cancellation.

## [0.4.3] — 2026-11-06

### Added
- Translation progress appears as a subtle overlay below the document toolbar, keeping the original readable while waiting for output. Icon-only stop and retry actions sit beside the translation button.

### Changed
- Model setup uses one sidebar configuration page with inline provider renaming, a deletion menu and automatic saving. First setup and adding a service share a standalone provider picker; the editor no longer shows a persistent unsaved-changes message.
- Provider presets are OpenAI, DeepSeek, Volcengine and custom. Existing connections to other services remain available.

### Fixed
- Recently used skills follow the Agent selected in Usage Habits. The tray offers a direct usage link, and usage reads share cached scans, retain that Agent's previous data on failure and support retry without mixing results after a switch.
- Compatible gateways returning unsigned thinking blocks no longer fail connection tests when the response structure and completion state are valid.
- Volcengine Coding Plan GLM-5.3-Flash translations over OpenAI Chat Completions explicitly use light reasoning instead of the service default. Known fixed-thinking models show thinking as on with a disabled switch, rather than appearing off.
- Translation failures show concise localized reasons, including quota exhaustion, request limits, authentication failures and timeouts. Background task notifications retain their skill context without inserting document banners or exposing upstream errors.
- Model configuration lookup waits for input-method composition and ignores whitespace-only model ID changes, preserving matched and manually entered limits.
- The Local page's content scrollbar aligns with the right edge.

## [0.4.2] — 2026-11-05

### Changed
- Manually started translations continue when navigating away. Returning to the same document and model configuration restores the session's progress, result, and original/translation selection without another request.
- Translation reconstructs frontmatter through YAML parsing and serialization, preserving name and other field values while translating description. Translated YAML formatting may change; original Skill files remain untouched.

### Fixed
- Final translation events are no longer discarded when the Tauri command returns before streamed events arrive. Automatic repair keeps the current translation visible and its progress toast remains until the task settles.
- Incomplete, duplicate, or out-of-order description markers no longer panic during streaming previews.
- Code fences respect blockquote depth, and frontmatter with a UTF-8 BOM or leading whitespace remains protected. Model prefaces before frontmatter are rejected instead of cached as successful translations with missing metadata tables.
- Document-protection fixes invalidate older translation caches; translations can be regenerated manually.

## [0.4.1] — 2026-11-05

### Added
- Skill usage statistics now include ZCode and DeepSeek Harness, with Codex selected by default. Exported usage screenshots include a GitHub repository signature.
- Model editing offers a thinking switch for supported endpoint/model combinations, with thinking disabled by default for translation and a warning that enabling it slows translation down.

### Changed
- Existing model provider edits save automatically, and model metadata resolution handles gateway and manufacturer fallbacks.

### Fixed
- Translation accepts legitimate inline marker reordering and repairs damaged regions using intact marker groups, avoiding duplicate markers when a targeted repair is spliced into the document.
- LLM requests follow each protocol’s endpoint conventions and classify stream failures consistently.
- Usage collectors handle Codex format changes. Screenshot footers stay on one line, while repository branding appears only in exported screenshots.
- Model ID editing places the caret at the end, and skill editor caret sizing is corrected.
- Editing a model ID no longer discards the stored thinking choice when the ID returns to the saved value.

## [0.4.0] — 2026-11-04

### Added
- Skill content translation. Settings → AI configures reusable model services (OpenAI, Anthropic, DeepSeek, Moonshot, ZCode, or a custom endpoint over one of three protocols), and the skill document toolbar translates Markdown files into nine supported languages. Translations stream into the reading view, are cached per document/configuration pair, and a "Prefer translations" switch shows an existing cached translation automatically when a document is opened. Each model row offers a connection test that sends one minimal request with the current draft credentials and reports latency or a safe failure reason; a "去配置" entry routes an empty model list into configuration without leaving the dialog.
- Damaged translations are now repaired instead of discarded. Intact protection markers anchor the damaged regions, only the affected source fragments are re-translated in one targeted request, and the spliced result is re-validated as a whole before caching. A visible toast announces the repair round; fragments larger than 4 KB are subdivided at paragraph boundaries so the re-translation stays focused. Protection markers themselves were shortened from a 64-character source hash to a short deterministic suffix, which already lets long, code-heavy documents pass the fidelity check far more often.
- GitHub tokens and model API keys are now viewable and editable in place. The dialogs load the real saved value through dedicated commands, present it in a password field with an eye toggle, and emptying the field and saving removes the credential; unchanged values keep saving disabled, and loading failures keep editing disabled.
- Skill creation is a single document-style page: name, description and body flow in one continuous writing area with auto-growing fields, uniform page width and no per-field boxes; multiline descriptions serialize into valid frontmatter, and creation keeps the existing validation and IPC. The Imports category gains a matching primary "Manage imports" entry that reuses the existing import dialog.

### Changed
- The app icon adopts the macOS 824-icon grid and fills in the missing icns sizes.
- Text inputs, search fields and settings dropdowns keep a static border on focus instead of tinting or ringing it.

### Fixed
- Translation shows a spinner in the content area until the first translated section arrives, instead of flashing the skill's "no content" empty state.
- With "Prefer translations" enabled, opening a document no longer flashes the original before swapping to the cached translation: the cache lookup holds the loading state and a hit renders the translation as the first frame.
- Credential inputs become focusable and editable once their asynchronous load completes, instead of staying disabled behind a race with the dialog's autofocus.

## [0.3.61] — 2026-11-02

### Added
- Settings → Advanced has a "Hide to menu bar when closed" switch, off by default. With it on, closing the main window hides it instead of quitting, so the tray's Common Commands and Recently Used keep working, and the window returns from the tray's "Open main window" or the macOS Dock icon. Real exits still ask for confirmation when a batch or selected update is running, and turning the switch off restores quit-on-close. The copy says hiding rather than minimizing, because a hidden window leaves no taskbar or Dock entry.

### Fixed
- The Chinese UI no longer translates the repos group's "Unassigned" row. That row sits among GitHub repository identifiers, which are never localized, so a translated word broke the column it belongs to. The English value stays in `zh.json` as an explicit key, so a translation audit can tell a deliberate value from an omission.

## [0.3.60] — 2026-10-31

### Added
- Skill Companion's common commands can now be transferred between devices through the clipboard. Export writes a versioned JSON envelope without local ids; import validates the envelope, skips whitespace-normalized duplicates (within the import and against the saved list), and appends new entries with fresh ids. Export is disabled for an empty list.

### Changed
- Removing a local import now asks for confirmation and states that only its managed agent links and registry entry are deleted; the original folder is untouched.

### Fixed
- Removing a skill whose cached home no longer contains `SKILL.md` no longer recursively deletes that path. A stale cache entry can therefore not destroy unrelated data that replaced the skill directory.

## [0.3.59] — 2026-10-25

### Fixed
- Scans no longer delete dangling symlinks the app did not create. Only links whose target lies inside the SSOT store or a known agent home directory are cleaned up; foreign dangling links (to dotfiles repos, unmounted volumes, or other tools' targets) are left in place, since scan-time deletion of a user link is irreversible. A directory planted as a symlink at the SSOT location is now reported as unattributable instead of panicking mid-command.
- Tray navigation now closes an open skill detail first, with the unsaved-draft confirmation when drafts exist, so the requested view is no longer hidden behind the detail overlay. Discarding the drafts applies the pending navigation.
- User-facing feedback strings are now localized in both languages: the render-error boundary, the shared dialog close button, the single-skill update toast, GitHub token failure feedback, and the native exit dialog labels (which read from the i18n files and are pinned by a test).
- The CLI now persists protocol state the way the desktop does: state writes flush to disk before the atomic rename, lifecycle recovery journals are written 0600 because they can restore bytes holding the GitHub token, empty state files read as absent, a literal `null` state file fails with a clean error, and archive IDs use the desktop's 16-character digest so the same skill archives to the same ID under either runtime.
- External imports dedupe by canonical path, so re-importing a registered folder through a symlinked parent reuses the original import and its import date instead of creating a duplicate.
- The CLI's web UI queues concurrent API calls through one lease instead of letting them reject each other, and its static handler rejects only exact `..` escape segments rather than any name starting with two dots.
- The CLI's cache content hash now matches the desktop byte-for-byte on each platform: paths sort component-wise in code-point order, and a tree deeper than 20 levels voids the whole hash instead of producing a partial digest. Both runtimes assert against a pinned fixture vector in `fixtures/local-protocol/`.

## [0.3.58] — 2026-10-23

### Added
- Skills installed by coding-agent plugins now appear as read-only entries in a dedicated Plugins category on the Local page, labeled with the source path they were found at. That includes Claude Code's marketplace clones and plugin caches. Discovery uses one generic rule for every registered agent rather than a vendor layout: a bounded walk of the agent's home directory that skips junk directories and other skill roots, keeping the newest copy when a name repeats. Plugin skills are excluded from same-name conflict, duplicate and install-preflight checks, and the backend refuses edit, save, link, archive, removal and update writes on them. (#8)
- A "Show plugin skills" switch under Settings → Skill maintenance controls that walk. It is off by default, and switching it off retracts every plugin entry immediately.
- Updates now protect local edits: `skillFolderHash` stores a real content baseline. That baseline is a SHA-256 over the installed folder's regular files, ordered by relative path, skipping symlinks and `.DS_Store`/`Thumbs.db`. A skill that no longer matches its baseline is marked "Modified locally"; a single update asks before overwriting it, and a batch update skips it and lists it in the completion summary so it can be updated on its own. Locks with no usable baseline keep updating without a warning and gain a baseline on the next successful write. This includes locks holding the legacy 40-character commit SHA.

### Changed
- The non-SSOT visibility preference is now "Show non-SSOT skills" instead of "Hide non-SSOT skills", and lives with plugin discovery under a "Skill maintenance" group. Existing users keep their effective choice: the legacy key is read as a fallback and is never rewritten or migrated.
- The Local sidebar's "My Skills" category is now "Mine" ("我的" in Chinese), alongside the new Plugins category.
- Recommended repositories replace `addyosmani/agent-skills` with `hugohe3/ppt-master`.
- Desktop dependencies were refreshed to their latest stable releases, and the Rust minimum version is now 1.90.

### Fixed
- An edit saved while an update was downloading is no longer overwritten: drift is checked again immediately before the content is replaced, and unfinished updates stay available instead of showing as complete.
- A `.DS_Store` or `Thumbs.db` written by a file browser no longer marks an installed skill as locally modified.
- A lock whose `skillFolderHash` holds a legacy commit SHA or any other non-conforming value is treated as an unknown baseline rather than as local drift.
- Clicking the update manager's force control no longer leaks the click into the overwrite flag.
- Plugin skills no longer offer edit, save or link controls, no longer appear twice when one name exists in several plugin trees, no longer occupy a slot in the link matrix, and disappear at once when discovery is switched off.

## [0.3.57] — 2026-10-22

### Changed
- The public landing page is now an independently built Astro site: static English at `/skill-zoo/`, Chinese at `/skill-zoo/zh/`, with the existing `?lang=zh|en` links, screenshots and release downloads preserved. GitHub Actions builds and deploys it independently of the desktop and CLI builds.
- The recommended-repositories list replaces `taste-skill` with `anatomy` (interactive isometric SVG illustrations).
- The website's Real-time FS Sync card now uses a dedicated hand-drawn sync-loop icon instead of the shared refresh glyph.

### Fixed
- Saving a verified GitHub token now refreshes active repository metadata, README and repository-search reads, and marks inactive ones stale for their next use. Valid disk caches remain reusable, failed saves leave queries untouched, and saving never starts an install or update write.
- GitHub API read failures now distinguish invalid credentials, anonymous or authenticated quota exhaustion, permission failures, missing repositories and transport errors, with actionable English/Chinese guidance and the quota retry time. Errors without a dedicated code keep their backend detail, and token setup guidance is no longer shown for authenticated quota exhaustion.
- A README recovered from a cached ZIP is persisted as stale instead of gaining a fresh seven-day cache lifetime, so saving a token retries GitHub while the fallback content remains available offline.
- Adding a common command now scrolls its editor into view and focuses it, so a long list no longer hides the new textarea below the fold.
- A metadata refresh can no longer overwrite a star or archive change written while it was reading disk, and batch deletion now applies and saves its metadata changes in one locked step.
- A late save no longer clears a newer draft: save confirmation and auxiliary drafts are bound to the editing session and skill identity, and undoing back to the saved text clears the draft.
- Merging duplicate skills refuses sources that contain symbolic links or junctions instead of silently dropping the links, and removes a destination it created when the merge fails.
- Reinstalling or updating an existing skill preserves lock fields the desktop does not recognize, so values written by newer producers survive an older writer.

## [0.3.56] — 2026-10-21

### Changed
- User metadata is keyed by installation directory instead of provenance, so stars and "my skills" survive a skill's source changing; legacy `repo:` keys are migrated on first load.
- The recommended-repositories list replaces `agentbay-ai/agentbay-skills` with `HKUSTDial/Supervisor-Skills` (research workflow from idea evaluation to rebuttal).
- The branch map now matches the repository: `main` is the development line, and the 0.3.56 compatibility branches are reference-only.

### Fixed
- Importing an external skill no longer overwrites an existing directory or a link pointing elsewhere: every target is preflighted and partial links roll back, `doctor fix` replaces only paths verified as symlinks, and collision errors now say how to proceed.
- Merging duplicate skills verifies every source and the destination before deleting any original, migrates user marks in one write, and rolls back a partial destination it created; skills containing symlinked files are rejected with a clear reason instead of leaving an "already occupied" directory behind.
- Desktop metadata writers reload disk state under the shared lease, so a mark committed by the CLI during a session is no longer overwritten by an older snapshot; cache refreshes reload metadata before rendering.
- Saving a skill confirms only the submitted revision: text typed while the save is in flight stays an unsaved draft. Auxiliary file drafts are kept per file and gate switching, closing and archiving.
- A late app-update check can no longer regress a finished download; the collapsed file sidebar is `inert` and returns focus to its toggle.
- Lock read-modify-write preserves unknown optional fields, so data written by newer producers survives older writers.
- The website's download links fall back to the releases list when no version is known instead of fabricating a `v0.0.0` asset URL.

## [0.3.55] — 2026-10-18

### Changed
- The GitHub API access token dialog is replace-only: a saved token is never redisplayed, only replaced, and it is verified live without the secret crossing the app's Tauri bridge.
- GitHub credentials are now written owner-only (0600) and filtered out of general settings reads and updates, so the token is no longer reachable through the settings surface. A blank legacy token is never sent to GitHub.
- The token lives under a section titled "Advanced features", placed below Skill Companion, with a connection icon.

### Fixed
- A saved GitHub token no longer leaks into general settings payloads; the app exposes only the saved and verification state until the user replaces it.

## [0.3.54] — 2026-10-15

### Added
- GitHub API access tokens can now be configured in Settings → GitHub Connection. A fine-grained public-repo token (no permissions required) is verified against GitHub's rate-limit endpoint before saving and raises the API quota from the anonymous 60 requests/hour to 5,000, so checking updates across many repositories no longer stops at the anonymous limit. Rate-limited update items now open the token dialog directly from the update manager, and the connection row shows the token's expiry, turning amber within seven days of expiring. (#7)
- Skill updates now continue in the background after the update manager is closed with X, Escape or an outside click, and a completion summary appears when they finish. While updates are running, closing the window or quitting from the tray asks for confirmation first; restarting for an app update and macOS Cmd+Q/Dock quit remain unguarded, a platform limitation of the current window library.

### Changed
- The GitHub connection row now derives its status line from live state instead of showing a static description. The status reflects anonymous quota, a configured token, freshly verified quota, or an expired token.

### Fixed
- An expired saved token no longer breaks GitHub reads with misleading "Repository or branch could not be found" failures: requests fall back to the anonymous quota until the token is replaced, matching what the connection row already said. Tokens without a recorded expiry are still sent, so revoked credentials keep failing loudly. Token and expiry now persist in a single write, so a failed save leaves the previous credentials untouched.
- Writing now returns a friendly "try again when it finishes" message in both languages instead of a raw internal error whenever another operation holds the local lease, for example removing a skill while updates run.

## [0.3.53] — 2026-10-14

### Added
- Skill info and audit popovers now animate in with a 140ms fade and a 3px rise, and install and save actions get press feedback. The desktop respects the OS "reduce motion" preference and observes it live: the banner carousel stops autoplaying and animated surfaces render their final state the moment the preference flips on mid-session, while shared Radix menus, dialogs and tooltips degrade via `motion-reduce:animate-none`.

### Fixed
- SKILL.md files saved with a leading UTF-8 BOM now parse correctly. Such BOMs are common in files written by Windows editors. The BOM is stripped before frontmatter extraction instead of silently breaking it, so a skill's name and description no longer disappear for such files.
- Downloaded repository archives are now scale-validated before extraction on every path that unpacks them: a decompressed-to-compressed ratio above 4x (with a 1 GiB floor so legitimate media-heavy archives still pass) or more than 100,000 entries is rejected as a decompression bomb. The Discover page previously extracted with only the download-size check, leaving the bomb vector reachable from there; it now applies the same guards as the install pipeline.

## [0.3.52] — 2026-10-13

### Fixed
- Opening a directory from the app on macOS now brings forward only the Finder window showing that directory and selects it in its parent, instead of activating Finder and pulling every open Finder window to the front. This covers a skill folder, an agent's skills directory, and the ZIP cache. Directories opened from the skill file tree take the same path, so all directory opening behaves consistently.

## [0.3.51] — 2026-10-11

### Added
- Custom coding agents can be registered, renamed, repointed and removed from Settings → Manage Coding Agents. Registrations live in a desktop-owned registry (`~/.skill-zoo/agents.json`, schema version 1) with stable UUID identities, and flow through the same install, link, archive and usage paths as the shipped built-ins. Lifecycle changes commit atomically through a recoverable journal, and a cross-process lease keeps the desktop app and the CLI from racing on local state.
- The add form derives the agent name from the chosen directory (last path segment, skipping a conventional `skills` leaf); a name edited by hand is never overwritten by later directory changes. In the manager list, the custom agent's label is itself the edit control, so built-in and custom rows keep the same layout.
- Registration checks real directory identity and overlap with existing agent roots, the SSOT store and Skill Zoo storage before saving; missing directories require explicit creation consent, and failed saves retain the draft with a field-level error.

### Changed
- Compatibility for existing users: with no `agents.json` present, behavior is unchanged (built-ins only). A shipped built-in whose directory collides with a custom registration is suppressed while the custom one stays active; equal names at disjoint directories coexist. Dormant visibility preferences survive and respect the 7-agent cap on reactivation. This introduces the versioned local protocol file `agents.json`; the CLI conforms to the desktop-owned schema.
- If `agents.json` is unreadable (corrupt, hand-edited, or written by a newer version), the app now starts with built-in agents and logs the parse error instead of failing to launch; saves refuse to overwrite the broken file and later registry changes surface the parse error.

### Fixed
- Unreadable subdirectories no longer block agent removal or path changes; they are skipped, matching the skill scanner's behavior.
- The local mutation lease sets `SO_REUSEADDR` on its loopback listener, so a fast release-and-reacquire (app restart, or the CLI following the desktop) no longer fails while the kernel keeps the closed port in a linger state. An actively held lease still fails the bind, preserving cross-process exclusivity.
- Badge row images in rendered markdown prose align correctly.

## [0.3.50] — 2026-10-09

### Fixed
- Coding agents can be toggled off again when the saved preference already exceeds the 7-agent visibility cap, for example 9 visible agents saved before the cap was introduced. The cap now only rejects updates that would grow past it, so over-cap states can be reduced one toggle at a time instead of failing every save with "Coding Agent 设置保存失败". (#10)

## [0.3.49] — 2026-10-02

### Changed
- Linux packages are built on Ubuntu 22.04 for compatibility with older glibc versions.

### Fixed
- Linux AppImages now make the bundled launcher executable for all users, fixing a startup `Permission denied` error.

## [0.3.48] — 2026-09-23

### Changed
- macOS 13.3 is now the minimum supported version, enforced as `bundle.macOS.minimumSystemVersion`. This matches the browser floor the toolchain already targets because macOS's WKWebView engine is tied to the OS version. That floor is Vite 8's default `safari16.4` build target and Tailwind v4's Safari 16.4 baseline. Systems below 13.3 can no longer launch the app.
- The frontend, CLI and Vite-config TypeScript projects now enable `noUncheckedIndexedAccess` and `verbatimModuleSyntax`, so unchecked index access and ambiguous type/value imports fail at compile time instead of at runtime. No user-visible behavior change.

### Fixed
- Hiding a coding agent no longer fails when its skill links cannot be removed. The visibility preference is now persisted first and is the only hard failure; link cleanup is best-effort. Any app-owned links that were moved are restored, and a concise notice reports that some skill links could not be cleaned up. (#10)
- Hiding an agent no longer removes skill links the app does not own. Cleanup is scoped to links pointing at the SSOT store or a known skill home, so links an agent manages itself (for example OpenClaw's `~/.openclaw/skills`) are left in place.

## [0.3.47] — 2026-09-18

### Changed
- The recommended-repositories list replaces `alirezarezvani/claude-skills` with `GoogleChrome/modern-web-guidance` (modern web platform guidance for coding agents).
- Frontend toolchain refresh: TypeScript 7, Vitest 5, jsdom 30, `@testing-library/jest-dom` 7, plus in-range bumps for React, Vite, Tailwind CSS, Radix UI and the rest. Every declared dependency now sits on its latest stable release.
- Rust dependencies brought up to date: serde, futures, thiserror, notify 8, rusqlite 0.40 and base64 0.23. `dirs` stays on 6.x because tauri itself requires `dirs ^6`.
- `rust-version` in `src-tauri/Cargo.toml` corrected from 1.85.0 to 1.88.0, the floor the dependency graph actually requires.

### Fixed
- The skill-detail file-tree sidebar animates again. Its transition targeted `transform` while Tailwind v4 compiles the slide to the `translate` property, and the width container snapped to zero in the same frame so collapsing was invisible.
- The collapsed Repos section no longer leaves invisible rows focusable or hides entries past an arbitrary height cap; collapsed entries are removed from the document and the toggle reports `aria-expanded`.
- Follow-the-system theme now applies on every view, not only while Settings is open, and no longer reverts an explicit light/dark choice.
- The theme switch no longer shows the previous palette during its view transition.
- The Enter key that confirms a Chinese IME candidate no longer navigates away from the repo search.
- Input fields keep a visible keyboard focus indicator that meets the 3:1 contrast floor; row and select-all checkboxes gained accessible names.

## [0.3.46] — 2026-08-18

### Added
- ZCode (the `zcode` desktop client and its bundled CLI) is registered as a supported agent. Skills live at `~/.zcode/skills/` as `SKILL.md` folders in the same format as Claude Code, so registration alone wires it into discovery, install, symlinks, the watcher, and all frontend surfaces. It is hidden by default, and usage tracking is deferred until ZCode's session-log format is known. ZCode also reads the shared `~/.agents/skills` store natively, so SSOT-installed skills are available to it without extra links.
- The CLI agent registry (`packages/cli/src/protocol/agents.ts`) mirrors the new ZCode entry.

## [0.3.45] — 2026-08-14

### Fixed
- SSOT and agent-directory scans now skip the app's own temporary and backup directories (`.name.install.*`, `.name.update.*`, `.name.backup.*`), so a crashed or failed install/update no longer leaves a hidden "ghost skill" behind. Dot-prefixed namespaces such as `.system` remain real skills and are still discovered.
- Installing or updating a skill from a repository no longer follows directory symlinks, and file symlinks are resolved relative to the link's own directory rather than the process working directory, with a recursion-depth cap. A skill archive can no longer pull arbitrary host files into the skill store.
- Concurrent downloads of the same repository now write to unique temporary files, so two simultaneous downloads can no longer truncate each other and corrupt the cached zip.
- Archiving or restoring a skill no longer freezes the whole app when the cache or metadata save fails because the store lock is released before rollback re-acquires it.
- File-content and image-content queries are now scoped by skill id, so two skills with the same-named file no longer share a cache entry (and saving one no longer wipes the other's); updating all skills now invalidates content caches immediately.

## [0.3.44] — 2026-08-13

### Added
- DeepSeek Harness (the `dsh` CLI) is registered as a supported agent. Skills live at `~/.dsh/skills/` as `SKILL.md` folders in the same format as Claude Code, so registration alone wires it into discovery, install, symlinks, the watcher, and all frontend surfaces. It is hidden by default, and usage tracking is deferred until DeepSeek Harness's session-log format is known. DeepSeek Harness also reads the shared `~/.agents/skills` store natively, so SSOT-installed skills are available to it without extra links.
- The CLI agent registry (`packages/cli/src/protocol/agents.ts`) mirrors the new DeepSeek Harness entry.

### Changed
- The recommended-repositories list replaces `multica-ai/andrej-karpathy-skills` with `Fission-AI/OpenSpec` (spec-driven development for AI coding assistants).

## [0.3.43] — 2026-08-04

### Added
- Moonshot's Kimi Code (the `kimi-code` CLI) is registered as a supported agent. Skills live at `~/.kimi-code/skills/` as `SKILL.md` folders in the same format as Claude Code, so registration alone wires it into discovery, install, symlinks, the watcher, and all frontend surfaces. It is hidden by default, and usage tracking is deferred until Kimi Code's session-log format is known.
- The CLI agent registry (`packages/cli/src/protocol/agents.ts`) now mirrors the desktop list, adding Grok Build, Pi, and Kimi Code.

## [0.3.42] — 2026-08-04

### Added
- Pi (the `pi` coding agent) is registered as a supported agent. Skills live at `~/.pi/agent/skills/` as `SKILL.md` folders in the same format as Claude Code, so registration alone wires it into discovery, install, symlinks, the watcher, and all frontend surfaces. It is hidden by default, and usage tracking is deferred until Pi's session-log format is known.

## [0.3.41] — 2026-07-31

### Added
- xAI's Grok Build (the `grok` CLI) is registered as a supported agent. Skills live at `~/.grok/skills/` as `SKILL.md` folders in the same format as Claude Code, so registration alone wires it into discovery, install, symlinks, the watcher, and all frontend surfaces. It is hidden by default, and usage tracking is deferred until Grok's session-log format is known.

### Changed
- The usage collector now streams session logs line-by-line instead of reading each file fully into memory, bounding peak memory to one line plus accumulated events, which matters for heavy users with multi-tens-of-megabyte JSONL logs. As part of this, an invalid-UTF-8 line is now skipped rather than causing the whole file to be dropped.
- The tray companion menu now always shows the "Add new item" action (previously it appeared only when the companion list was empty), placed above the disabled copy hint. "Add common command" is relabeled to "Add new item" (EN/ZH) to match the broader use.

## [0.3.40] — 2026-07-17

### Fixed
- Symlinked directories inside a fetched repository are now skipped during skill discovery, so a skill reachable through more than one path (for example an `.agents/skills` symlink pointing back at the repo's own `skills` directory) is no longer listed twice.

## [0.3.39] — 2026-07-17

### Fixed
- Repositories with a valid root `SKILL.md` (containing both `name` and `description` frontmatter) are now consistently treated as single-skill sources. Nested skills in such repos are no longer surfaced, and the install directory is normalized to a filesystem-safe name derived from the skill frontmatter.
- Invalid UTF-8 in root `SKILL.md` metadata no longer causes inconsistent behavior. It is now handled uniformly across preview, discovery, and install paths.
- Install and update selectors now correctly match root skills by lock path, including legacy installations made before root-skill normalization.

## [0.3.38] — 2026-07-15

### Fixed
- Skill state changes are now failure-atomic for linking, unlinking, installing, and removing skills. If a step fails partway, the operation rolls back instead of leaving partially-applied state.
- Removing an external import now persists the import-record removal before cleaning up agent links, so a failed link cleanup can no longer leave a dangling import entry.
- Dropping a skill onto an agent it is already linked to no longer fires a redundant notification.

### Changed
- Removed dead code and hardened skill operations across the skill and settings services.

## [0.3.37] — 2026-07-13

### Fixed
- Radix scroll areas no longer show both native and custom scrollbars on Windows, while preserving the existing macOS behavior.

## [0.3.36] — 2026-07-13

### Changed
- Skill drag-and-drop is re-enabled on Windows, where it had been disabled since 0.3.34 due to unreliable drag preview and link behavior in packaged builds.

### Fixed
- The drag-link success toast now appears in packaged/release builds. The Sonner toaster stylesheet was not loaded, so the toast rendered invisibly.

## [0.3.35] — 2026-07-12

### Fixed
- Skill drag-and-drop feedback is restored in packaged macOS builds, where the Tauri WebView was not reliably applying dnd-kit's runtime-injected drag-preview stylesheet.

## [0.3.34] — 2026-07-12

### Fixed
- Skill drag and drop is now disabled on Windows, where the drag preview and link flow were unreliable in packaged builds.

## [0.3.33] — 2026-07-12

### Fixed
- Skill drag link toast now clears any stale drag feedback layer state before showing, preventing the toast from being skipped when a previous drag interaction left lingering state.

## [0.3.32] — 2026-07-12

### Fixed
- Skill drag link success toast now waits for the agent link confirmation before appearing, preventing the toast from being suppressed when the linked state resolves after the drag animation completes.

## [0.3.31] — 2026-07-12

### Fixed
- Skill drag link success toast now waits for drag feedback to resolve before appearing, preventing a race where the toast could show before the card position settled.

## [0.3.30] — 2026-07-12

### Changed
- Skill drag-and-drop overlay extracted to a dedicated `SkillDndLayer` component, decoupled from the installed skills layout.

### Fixed
- Skill drag link success toast now appears after drag source cleanup, eliminating a visual flicker between the toast and the re-rendered card.

## [0.3.29] — 2026-07-12

### Changed
- Release automation now validates version metadata and required platform artifacts before publishing, and updates Homebrew only after the GitHub Release exists.

### Fixed
- Skill drag previews in packaged Windows and macOS apps now follow the pointer without showing an original-card-sized overlay mask.

## [0.3.28] — 2026-07-12

### Fixed
- Skill drag previews now follow the pointer in packaged Windows and macOS apps instead of remaining in the top-left corner.

## [0.3.27] — 2026-07-11

### Fixed
- Startup theme color flash on app launch.
- Skill drag preview misalignment on Windows.

## [0.3.26] — 2026-07-11

### Changed
- Skill file access centralized through `ManagedSkill`, so file paths are now relative to the skill root with path-traversal prevention, replacing absolute-path-based commands with safer `skillId` + `relativePath` alternatives.

### Fixed
- Startup theme flicker on app launch.
- Infinite re-renders caused by unstable default values in hooks.
- Wrench icon color now consistent with other icons in Skill Maintenance settings.

## [0.3.25] — 2026-07-10

### Added
- Batch unlink action for agent skills that removes multiple skill symlinks from an agent directory at once.
- Guide tray users to common commands when the tray menu is opened.

### Changed
- Consistency target navigation now provides better visual feedback when jumping to issues.
- Agent drag indicators simplified for a cleaner drag-and-drop experience.

### Fixed
- Automatic app update checks are now throttled to avoid excessive network requests.
- Skill cards now fill the full row height in grid view for uniform appearance.

## [0.3.24] — 2026-07-10

### Added
- Drag-and-drop for local skills: drag a skill card to the Star sidebar item to star it, or to an agent tab to create a symlink.

### Fixed
- Install preflight now scopes conflict checks to only the agent directories selected in the install dialog, not all visible agents.

## [0.3.23] — 2026-07-09

### Changed
- Local views and install conflict checks now use a narrower visible scope: only SSOT skills and skills whose home agent is currently visible in Settings. Hidden-agent skills and external imports no longer create conflicts users cannot resolve on the Local page.
- Install preflight only checks visible agent directories, not every known agent directory.
- Discover page and skills.sh search classify conflicts against visible local skills only.
- Archived skills are shown without agent visibility filtering.
- Consistency checks (duplicates, name mismatches) now exclude hidden-agent entity skills and external imports.
- Settings update shortcut label changed from "Update" to "New Version".

### Fixed
- External imports no longer trigger false conflict detection in discover and repository views.
- Repo skills with different source paths but identical install directories now correctly show as conflicts rather than falsely matching as installed.

## [0.3.22] — 2026-07-09

### Added
- External imports are now protected from destructive operations. Delete and overwrite actions treat them as read-only references, preventing accidental data loss.
- Target highlight animation when navigating to consistency issues from skill card badges.

### Fixed
- Skill install dialog controls are now locked while installation is pending, preventing double-clicks from queuing duplicate installs.
- External import symlinks no longer incorrectly target the SSOT store.
- External import links in the SSOT store are properly excluded from duplicate detection.
- Repo skills cache is now invalidated on rescan, ensuring the UI reflects the latest filesystem state after manual refresh.
- SkillHero linked agents now filter by the user's configured visible agent order.
- Consistency check issue counts and sidebar counts are now limited to visible skills only, matching the filtered card view.

## [0.3.21] — 2026-07-09

### Added
- Settings update shortcut that adds a compact update button to the settings header. It appears only when an update is available and scrolls to the update section in one click.
- Update availability caching across app restarts in localStorage, so the shortcut reappears immediately without waiting for a network check.
- Skill usage source breakdown showing which agents contributed to usage statistics.
- Official website link in the system tray menu.

### Changed
- App update flow now has a distinct "available" state. Updates are shown before downloading, giving users visibility into the target version.
- App updater downloads survive section unmount, so navigating away from settings no longer cancels an in-progress download.
- Filter installed skill cards by visible coding agents for consistency with the rest of the app.
- README fallback: when a repo's default branch lacks a README, the app now tries the cached branch zip.
- Improved Chinese error wording and widened docs navigation width.

### Fixed
- Tray menu title truncation now uses Unicode display width, correctly handling CJK characters.
- Skill usage screenshot now captures the inner content wrapper instead of the outer scroll area.
- Test: cast screenshot target through `unknown` to satisfy TypeScript type checks.

## [0.3.20] — 2026-07-08

### Added
- OpenCode skill usage tracking with extensible agent registry. The `skill_usage` collector now uses a registry pattern, so adding a new agent requires only one collector function and one registry entry.
- OpenCode slash-command skill invocations detected from injected SKILL.md text in user messages.
- Codex `$skill-name` prefix invocations detected alongside legacy `exec_command` SKILL.md reads.
- Pre-push git hook to run full CI checks (typecheck, tests, clippy, build) locally before pushing.

### Changed
- Skill usage whitelist broadened to all installed skills regardless of agent association. Previously skills had to be explicitly installed for the selected agent to appear.
- Agent selector in the usage habits dialog now dynamically derived from agent configs instead of hardcoded types.
- MAX_DOWNLOAD_BYTES raised from 500 MB to 5 GB.

## [0.3.19] — 2026-07-08

### Added
- Click inconsistency badges on skill cards to jump directly to the ConsistencyPanel tab with auto-scroll to the target skill.
- Persist the last selected agent in the skill usage dialog across sessions.
- Codex skill usage statistics in the usage habits dialog.

### Changed
- LF line endings enforced across all platforms via `.editorconfig`, `rustfmt.toml`, and `.gitattributes`.
- Upgraded rand crate from 0.8 to 0.10, regex from 1.10 to 1.12, and JavaScript dependencies to latest stable with tray settings menu.
- Project guide consolidated into AGENTS.md as the single entry point.
- Top navigation bar width tightened for better balance across screen sizes.
- Landing page improved with better i18n accessibility and wide-screen layout.
- Added Chinese mirror registry setup documentation.
- Removed CodeMirror 6 from README tech stack.

### Fixed
- Path separators normalized to forward slashes across all platforms for cross-platform consistency (CLI, homePath, display paths, archive tests).
- Windows verbatim path prefix (`\\?\`) stripped from external import display paths.
- HomePath dedup added to cache upsert; silent symlink failures now logged.
- Race condition when loading file tree directory children resolved.
- Skeleton grid increased from 8 to 12 cards for better first-screen coverage on large displays.
- Three bugs from code review: filteredIssuesMap navigation fields, upsert stale-dedup, and verbatim UNC prefix handling.
- CI guard no longer triggered by `rsplit('/')` in comments.
- Replaced `sort_by` with `sort_by_key` to satisfy clippy lint.
- Portable build missing `custom-protocol` feature, causing `ERR_CONNECTION_REFUSED` on startup.

## [0.3.18] — 2026-07-06

### Fixed
- White flash on startup in dark mode by setting the theme before the first paint.

## [0.3.17] — 2026-07-06

### Changed
- Import filter moved between star and my skills in the sidebar for better grouping.

### Fixed
- Lock file read-modify-write operations now use a process-wide mutex to prevent lost updates from concurrent writes.

## [0.3.16] — 2026-07-05

### Added
- Archive support for external imports: archived external import content is read from the source path.
- Import filter in the sidebar below the starred section.
- Import count displayed on the manage tab in the local imports dialog.
- Hint when batch-deleting imported skills in the remove dialog.

### Changed
- Removed the manual rescan skills button from settings.

### Fixed
- Remove dialog no longer shows scary warnings for external imports when deleting only imports.
- External import hints merged into the description text for clearer messaging.
- Resolved contradictory warning display in mixed batch delete scenarios.
- External import symlinks now properly recognized during filesystem scan.
- External imports handled correctly in duplicate group detection.
- Nested if collapsed to satisfy clippy lints.
- Improved font stack for Windows rendering on the docs page.

## [0.3.15] — 2026-07-05

### Added
- External imports: import skills from any local directory as symlinks, with live refresh when source directories change.
- Local imports dialog split into Import and Manage tabs, with manual refresh, clean stale links, select-all, origin labels, and full-path hover tooltips.
- CLI external imports management: `imports`, `imports scan`, `imports add`, `imports remove`, `imports clean` commands, and `--origin external` filter on `list`.
- Supported coding agent showcase section on the landing page.
- Pre-commit hook running format and lint checks.

### Changed
- Windsurf icon updated to the official favicon.
- Landing page reflects 18 supported coding agents.
- i18n label refinements.

### Fixed
- Import layout now uses independent scroll areas per region, preventing overflow.
- Backend error messages are surfaced in the UI instead of a generic fallback.
- Pre-existing symlinks are preserved when an import operation is rolled back.
- Toast feedback added when cleaning stale links.
- Main window now appears after the startup theme is applied, avoiding a flash of unstyled content.
- Only unrecognized errors surfaced in the UI; existing matching errors are no longer overridden.
- Empty candidate panel now shows a placeholder hint instead of being hidden.
- CLI protocol fixture tests compatible with bun test runner.

## [0.3.14] — 2026-07-04

### Changed
- Updated tray template icon.
- Refined skill companion usage labels.
- Polished local skills loading skeleton animation.

### Fixed
- Nested repo skills with duplicate leaf names can now be disambiguated by selecting the full path.
- Skill update button state no longer leaks across skill cards.

## [0.3.13] — 2026-07-04

### Added
- Support for 7 new coding agents, bringing the total to 18. The new agents are Windsurf, CodeBuddy, Qwen Code, Qoder, Kilo, Antigravity, and Qoder CN.
- Skill usage dialog can be saved as a screenshot; usage UI refreshed.
- Skill detail update flow with clearer feedback and agent display.

### Changed
- Docs landing page: rebuilt the product overview as a full-bleed layout, raised the coding-agent count to 18, and improved large-screen scaling.
- Skill update path rewritten with check-then-update semantics and structured errors.
- Minor i18n wording fixes.

### Fixed
- Skill usage screenshot now captures the full scrollable content.
- Aligned skill usage ranking columns and refined the dialog layout.
- Removing a skill now uses an archive-compatible lock key lookup.
- Corrected the calendar-day window in the skill usage period report.
- Removed the SimSun font fallback on Windows in the product page.

### Performance
- Removed unnecessary GPU compositor layers.

## [0.3.12] — 2026-07-03

### Added
- Tray skill companion shortcuts that let users right-click the tray to copy frequently used commands.
- Tray recent skills that automatically surface the last 5 skills used in Claude Code.
- Skill usage habits dialog with daily chart and skill ranking.
- Agent badges are now clickable to open the configure dialog.

### Changed
- Docs landing page: refined layout, typography, and product overview positioning.

### Fixed
- Tray recent skills now copies the skill name without a leading slash prefix.
- Unified badge styles for conflict, mismatch, and duplicate warnings.
- Race conditions in skill companion settings when saving, deleting, or reordering items.

## [0.3.11] — 2026-07-01

### Changed
- GitHub repos now follow the actual default branch instead of assuming `main`. The lock file stores an explicit branch only when specified; missing means "follow default."
- Network errors are now classified with specific diagnostics: DNS lookup failures, connection refused (firewall/proxy), TLS/certificate errors (corporate HTTPS inspection), and timeouts each get distinct error messages instead of a generic "Check your internet connection."
- SSH-style repo URLs (`git@github.com:owner/repo`) are now recognized in the search bar alongside HTTPS URLs and `owner/repo` shorthand.
- Repo info panel metadata errors now show a specific error message with a Retry button, replacing the previous silent gray text.

## [0.3.10] — 2026-06-29

### Added
- Update Manager dialog with per-skill selection, check diagnostics, and update history tab.
- Update history persistence that records each update operation with success/failure tracking.

### Changed
- GitHub URL parsing extracted to a shared module, used consistently across the backend.
- File read errors migrated from plain strings to structured codes for better error handling.
- Product page: enlarged carousel and buttons, refined CTA layout and mobile responsiveness.

### Fixed
- Update check diagnostics now surface per-skill error reasons instead of silently skipping.
- Fresh installs now record an update baseline so update detection works immediately.
- Footer background now matches the CTA gradient; duplicate footer block removed.
- Navigation padding unified; hero font-size scales properly on mobile.
- Edge cases in update history and stale persistence files hardened against data loss.

## [0.3.9] — 2026-06-26

### Fixed
- Bad request error display now surfaces the correct error message.
- Skill update workflow improved with precise path resolution and more robust error handling.

## [0.3.8] — 2026-06-24

### Added
- Linux AppImage and `.deb` build targets in CI pipeline.

### Changed
- Structured error handling unified from backend to frontend.
- CLI bumped to v0.3.1.
- Installation instructions simplified; Linux download instructions added.

### Fixed
- CLI: warn on contested agent links instead of over-repairing them.

## [0.3.7] — 2026-06-22

### Changed
- User-facing "Agent" renamed to "Coding Agent" (中文: "编程工具") across UI, README, and landing page.
- AgentPaths settings section icon changed from amber to indigo.
- Development guide moved from README to `docs/development.md`.
- Removed unused `home-page.webp`.
- CLI package released v0.3.0.
- Discovery page: replaced large repos (hermes-agent, gemini-cli, nuwa-skill) with addyosmani/agent-skills, multica-ai/andrej-karpathy-skills, and alirezarezvani/claude-skills.

## [0.3.6] — 2026-06-21

### Added
- Drag-to-reorder agents in settings page.

### Changed
- Manager dialog closes with standard X button for consistency.
- Manage-agents button made more discoverable.
- Agent row spacing unified in manager dialog.

## [0.3.5] — 2026-06-21

### Added
- WorkBuddy and Qoder CN agent support (default hidden).

### Changed
- Agent manager dialog unified into single drag-to-reorder view with inline visibility toggles.
- Visible agents capped at 7, enforced in both frontend and backend.
- Skill create page: file-tree sidebar hidden, agent selection removed.

### Fixed
- Skill cache app metadata now refreshed after symlink mutations, keeping agent availability in sync.

## [0.3.4] — 2026-06-19

### Changed
- GitHub Actions artifact workflows upgraded to the Node.js 24-compatible v6 actions.

### Fixed
- Large skill detail pages no longer freeze the UI by copying full content into the hidden editor while in overview mode.
- Markdown previews avoid redundant rendering while unrelated detail state changes.
- Dark mode prose body text now matches the foreground color for better readability.

## [0.3.3] — 2026-06-19

### Added
- Skill info popover. Hover the `…` button in the detail header to see repository, source, install/update dates.

### Changed
- Detail page header collapsed from three rows to two. Agent tags moved to the title row and the security audit icon moved into the action button group.
- Security audit supports icon-only display mode with color-coded aggregate status.
- Repository link replaced with inline info popover for cleaner header layout.

### Fixed
- Archive and lock files refuse to write format versions above the supported ceiling.
- Filesystem-derived queries refresh correctly after cache rescan.
- Agent skill link semantics aligned between UI and backend.

## [0.3.2] — 2026-06-12

### Changed
- Discoverable skill install state is now authoritative. Server-side classification (available, installed, conflict) replaces the client-side `installed` boolean.
- Duplicate skill merge requires all entries to have verified matching content hashes.
- `useRepoReadme` hook waits for the repository branch before fetching.
- Repo category matching and sidebar keys are now case-insensitive.
- CLI update path reports per-skill errors instead of silently skipping failed repos.
- Sidebar filter no longer toggles off when clicking the same category.

### Fixed
- Update button no longer shows success indicator before the mutation resolves.
- Clearing download cache no longer leaves the button stuck in loading state on error.
- Cache cleanup only counts bytes for files actually removed.
- App restart failure now surfaces a toast instead of silently failing.
- Updater error message corrected from install to download phase.
- Agent visibility switch disabled during pending mutation to prevent double-clicks.
- Cache rebuild filesystem scan offloaded to blocking thread pool.

## [0.3.1] — 2026-06-05

### Added
- Image preview in the skill file tree supports png, jpg, gif, webp, bmp, svg, avif, ico.
- Image icon and teal color treatment for image files in sidebar.

### Changed
- Skills cache (`skills-cache.json`) entries now include an optional `apps` map with derived agent availability, avoiding filesystem I/O on every read.
- Startup loads persisted skill cache immediately, reconciles with filesystem in background.
- File watcher uses incremental skill rescan for content changes, reducing I/O on external modifications.
- Skill data refreshed through file watcher without requiring a forced rebuild.
- `SkillCache` struct refactored with private fields and HashMap index for O(1) ID lookup.

### Fixed
- CLI test fixture paths now resolve correctly under Vite/Vitest.

## [0.3.0] — 2026-06-05

### Added
- Skill Zoo npm CLI (`npx skill-zoo`) that provides install, scan, status, and archive management from the terminal.
- Lightweight Skill Zoo Web UI (WUI) that provides a browser-based skill management dashboard.
- CLI diagnostics and inspect commands for troubleshooting installed skills.
- CLI doctor command with fix mode and cross-agent consistency checks.
- Pull-to-refresh with resilient caching for repository panel.
- Sidebar skill counts now reflect toolbar search query and agent filter.
- Local protocol documentation and cross-platform test fixtures.

### Changed
- Default app theme now follows system preference instead of forcing dark.
- Archive/restore plan moved from detail pane to modal dialog.
- Security audit repositioned into SkillHero as a compact popover.
- WUI markdown rendering moved to server-side for cleaner client code.
- Repository panel layout and markdown heading styles refined.
- Improved local skill detail navigation performance.
- Split app-release and npm-release into separate agent skills.
- Removed unused vendor chunk splitting config.

### Fixed
- Archive directory watcher now invalidates archived query cache on rescan.
- Pull-to-refresh parameters tuned; prose `<code>` visibility restored in markdown.

## [0.2.9] — 2026-06-03

### Added
- Draggable agent ordering that lets users reorder agents by drag-and-drop.
- Skill archive management UI with archive persistence.

### Changed
- Refined archived skill UI and visual treatment.
- Improved update flow and path validation.
- Split vendor chunks for smaller production bundles.
- Removed unused `@radix-ui/react-select`, `@radix-ui/react-tabs`, and 5 dead files.

### Fixed
- Skill card hover clipping and name font weight.

## [0.2.8] — 2026-06-02

### Fixed
- Hide repo panel when filtered results are empty; auto-navigate back on skill deletion.
- Refined skeleton screens to match real component layouts.

## [0.2.7] — 2026-06-01

### Added
- Repo info side panel with GitHub metadata cache and README preview.
- Responsive 1-2-3-4 column grid layout with auto-hide scrollbar.

### Changed
- Replaced native scrollbars with Radix ScrollArea.
- Toned down consistency badge saturation in dark mode.

### Security
- Added rehype-sanitize after rehype-raw to strip dangerous HTML from README content.

### Fixed
- SafeImg reset failed on src change; README cache now distinguishes 404 from network error.

## [0.2.6] — 2026-05-31

### Added
- Consistency badge visibility toggle with settings dropdown.

### Changed
- Refined dark theme, sidebar UI, scrollbar styling and typography.
- Updated documentation and bumped ZIP download limit to 500MB.
- Applied semantic scrollbar colors for better theme integration.

### Fixed
- Resolved lint errors and formatting issues.

## [0.2.5] — 2026-05-30

### Changed
- Unified directory skip list (`SKIP_DIRS`) across all scanners to match upstream `npx skills` CLI.
- Updated recommended repositories list.
- Improved Chinese wording ("管理器" → "管理工具").

### Fixed
- Resolved relative symlinks and Windows junctions correctly in agent detection and skill linking.
- Distinguished GitHub rate-limit errors from not-found errors in update checks; rate-limit now stops further requests while not-found continues.
- Fixed scrollbar styling not applying in WebKit browsers by moving rules out of `@layer base`.
- Fixed card grid bottom padding to prevent last card from being clipped.
- Removed unnecessary `AnimatePresence` wait mode for smoother view transitions.

## [0.2.4] — 2026-05-27

### Added
- Batch delete skills from the installed skills view.
- Branch field on repository banners.

### Changed
- Improved landing page mobile experience and navigation theme.
- Refactored download and progress system in repository details.
- Fine-grained text selection replaced global context menu blocking.
- Install dialog simplified; sidebar auto-expands on navigation.
- Replaced ComposioHQ banner with mattpocock.

### Fixed
- Download limit raised to 500MB; size errors no longer retry; fixed code block rendering.
- User files protected from being overwritten during skill linking.
- Fixed select-all keyboard shortcut collision.

## [0.2.3] — 2026-05-25

### Changed
- Release flow streamlined to a single commit; CI now auto-merges the Homebrew cask PR with no manual post-release steps.

### Fixed
- Download status label now appears before the website button in the settings bar.

## [0.2.2] — 2026-05-25

### Changed
- Release skill now includes Cargo.lock regeneration and cargo test in prerequisites.
- `.claude` directory added to `.gitignore`.

### Fixed
- version.json is now updated by the release skill instead of CI, avoiding tag-push conflicts.
- cargo fmt path corrected in release skill documentation.

## [0.2.1] — 2026-05-25

### Added
- OpenCode agent support.
- Unsaved changes dialog when switching skills in the editor.
- Official site button in the About section.

### Changed
- Consistency panel hints now have bold labels ("Same name, same content:", "Same name, different content:", "Name mismatch:").
- Update detection only reinstalls when a confirmed SHA difference exists, avoiding unnecessary downloads.
- Repository tree fetches are deduplicated by grouping skills per repo, reducing GitHub API calls.

### Fixed
- Atomic write temp files now preserve the original extension, preventing potential conflicts.

## [0.2.0] — 2026-05-24

### Added
- Download button and install modal for skill marketplace.
- Persistent file sidebar with editable skill files in the skill editor.

### Changed
- Top navigation bar replaces previous header layout.
- All-dark theme: consistent dark palette across every surface.
- Skill update detection uses folder-level SHA via Git Trees API.
- Visual polish: color tweaks, nav refinements, IPC flow animation.

## [0.1.13] — 2026-05-21

### Added
- Apple code signing and notarization for macOS releases.

### Changed
- README updated to reflect signed and notarized macOS app; removed unsigned app workaround.

## [0.1.12] — 2026-05-21

### Changed
- Update section UI refactored into standalone components (`StatusLabel`, `UpdateButton`), error states replaced with toast notifications.
- "Download & Install" button text shortened to "Update Now".

## [0.1.11] — 2026-05-21

### Added
- GitHub button in About section, always visible alongside update check for installer builds.

### Changed
- No-update result shows a toast notification instead of replacing the button with static text.
- Windows installer now the recommended download over portable version in README and release notes.

### Fixed
- Add `app` bundle target so macOS builds generate `.app.tar.gz` updater artifacts.
- Strip `.git` suffix from repo names when parsing GitHub URLs (e.g. `anthropics/skills.git`).

## [0.1.10] — 2026-05-21

### Added
- Skill update checking that compares installed skills against the latest GitHub commits with rate-limit handling.
- Streaming repo ZIP downloads with progress events and 50 MB size limit.
- Download cache management (clear cache, view size, open cache directory) in Settings.
- Software self-update via `tauri-plugin-updater` for macOS DMG and Windows NSIS installer.
- `AppUpdateSection` in Settings, which provides an auto-update flow for installers and a GitHub Releases link for portable builds.

### Changed
- Codex visible by default in agent settings.
- Skill update and update-all now refresh commit SHA after completion.
- Windows portable rebuilds with `--features portable` to skip updater plugin registration.
- CI generates and uploads `latest.json` updater manifest to GitHub Releases.

## [0.1.9] — 2026-05-18

### Fixed
- Add `color-scheme` CSS property so native scrollbars render dark in dark mode instead of white.

## [0.1.8] — 2026-05-18

### Changed
- Update release skill to reflect universal macOS DMG.

### Fixed
- Update optimistic cache types to match RepoSkillsResult.

### Changed
- Merge two macOS DMGs (Intel + Apple Silicon) into one universal binary.
- Soften dark theme colors by raising background/card/border lightness and adding a subtle warm tint.
- Replace repo skills truncation boolean with actual total count, raise cap from 500 to 800.

## [0.1.6] — 2026-05-17

### Changed
- Replace app logo with new design across native icons (PNG/ICO/ICNS) and Settings About panel, with rounded corners matching the previous icon's 23% radius ratio.
- Rewrite docs landing page as bilingual product overview with auto i18n.

### Fixed
- Use openUrl to open external links in system browser.

## [0.1.5] — 2026-05-09

### Added
- Security audit panel from skills.sh, displayed on skill detail pages.
- Batch merge all duplicates button in consistency panel.
- Filesystem watcher that auto-refreshes UI on skill changes.
- Atomic write for cache file persistence to prevent corruption.

### Changed
- Batch merge uses mutateAsync instead of manual promise wrapping.
- Code formatted with cargo fmt and oxfmt across the project.
- Lint config, README, and release checklist updated.

### Fixed
- Open skill folder now uses physical path (homePath) with directory fallback.
- Dialog zoom animation replaced with pure fade for reliability.

## [0.1.4] — 2026-05-08

### Added
- oxlint/oxfmt tooling for lint and format, with CI gates.

### Changed
- Switch from serde_yml to official serde_yaml.
- Harden CI workflow against supply chain and injection risks.
- README improvements: Trust & Security, Contributing, lint/format/test commands.

### Fixed
- RELEASE_BODY.md validation in CI before reading.
- Windows portable resources copied to exe directory instead of resources/ subfolder.

## [0.1.3] — 2026-05-05

### Added
- GitHub Releases button to about section.

### Changed
- Atomic skill install via tmp+rename, sanitize branch names for safe paths.
- Idiomatic Rust cleanups in skill.rs.

### Fixed
- Race condition in BannerCarousel.
- Lock ordering in get_installed_skills.
- Sorting not applied to grid view in InstalledSkills.

## [0.1.2] — 2026-05-04

### Added
- Skill content preview before install.
- Landing page i18n with English and Simplified Chinese support, auto-detected.
- CI release notes auto-fetch depth fix.

### Changed
- Dark mode palette switched from warm brown to neutral gray.
- README and landing page polished.

### Fixed
- ConsistencyPanel bugs.
- Landing page Windows tooltip display.

## [0.1.1] — 2026-05-03

### Added
- Landing page: glassmorphism styling, mobile responsive rewrite, copy button for brew install commands.
- macOS quarantine warning tooltip on download section.
- CI: portable Windows zip artifact, auto-generated release notes, renamed artifacts.
- Developer release guide under `docs/dev`.
- Release skill for agent-guided version publishing.

### Changed
- README and landing page restructured with Homebrew-first install approach.
- README tagline wording and image placement updated.

### Fixed
- CI: `--notes-file` usage to prevent shell from interpreting markdown as commands.
- CI: `git describe` failure in shallow clones, builds now limited to tags.

## [0.1.0] — 2026-05-02

### Initial Release

The first public release of Skill Zoo ships a local desktop GUI for managing AI Agent Skills. Homebrew publishing pipeline included from the start.
