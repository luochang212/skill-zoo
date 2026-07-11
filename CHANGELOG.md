# Changelog

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
- Skill file access centralized through `ManagedSkill` — file paths are now relative to the skill root with path-traversal prevention, replacing absolute-path-based commands with safer `skillId` + `relativePath` alternatives.

### Fixed
- Startup theme flicker on app launch.
- Infinite re-renders caused by unstable default values in hooks.
- Wrench icon color now consistent with other icons in Skill Maintenance settings.

## [0.3.25] — 2026-07-10

### Added
- Batch unlink action for agent skills — remove multiple skill symlinks from an agent directory at once.
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
- External imports are now protected from destructive operations — delete and overwrite actions treat them as read-only references, preventing accidental data loss.
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
- Settings update shortcut — a compact update button in the settings header that appears only when an update is available, with one-click scroll to the update section.
- Update availability caching across app restarts in localStorage, so the shortcut reappears immediately without waiting for a network check.
- Skill usage source breakdown showing which agents contributed to usage statistics.
- Official website link in the system tray menu.

### Changed
- App update flow now has a distinct "available" state — updates are shown before downloading, giving users visibility into the target version.
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
- OpenCode skill usage tracking with extensible agent registry. The `skill_usage` collector now uses a registry pattern — adding a new agent requires only one collector function and one registry entry.
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
- 7 new coding agents — Windsurf, CodeBuddy, Qwen Code, Qoder, Kilo, Antigravity, and Qoder CN (total now 18).
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
- Tray skill companion shortcuts — right-click tray to copy frequently used commands.
- Tray recent skills — automatically surfaces the last 5 skills used in Claude Code.
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
- Update history persistence — records each update operation with success/failure tracking.

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
- Skill info popover — hover `…` button in detail header to see repository, source, install/update dates.

### Changed
- Detail page header collapsed from three rows to two — agent tags moved to title row, security audit icon moved into action button group.
- Security audit supports icon-only display mode with color-coded aggregate status.
- Repository link replaced with inline info popover for cleaner header layout.

### Fixed
- Archive and lock files refuse to write format versions above the supported ceiling.
- Filesystem-derived queries refresh correctly after cache rescan.
- Agent skill link semantics aligned between UI and backend.

## [0.3.2] — 2026-06-12

### Changed
- Discoverable skill install state is now authoritative — server-side classification (available, installed, conflict) replaces the client-side `installed` boolean.
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
- Image preview in skill file tree — supports png, jpg, gif, webp, bmp, svg, avif, ico.
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
- Skill Zoo npm CLI (`npx skill-zoo`) — install, scan, status, and archive management from terminal.
- Lightweight Skill Zoo Web UI (WUI) — browser-based skill management dashboard.
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
- Draggable agent ordering — reorder agents by drag-and-drop.
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
- Skill update checking — check installed skills against latest GitHub commits with rate-limit handling.
- Streaming repo ZIP downloads with progress events and 50 MB size limit.
- Download cache management (clear cache, view size, open cache directory) in Settings.
- Software self-update via `tauri-plugin-updater` for macOS DMG and Windows NSIS installer.
- `AppUpdateSection` in Settings — auto-update flow for installers, GitHub Releases link for portable builds.

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
- Soften dark theme colors — raise background/card/border lightness and add a subtle warm tint.
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

First public release of Skill Zoo — a local desktop GUI for managing AI Agent Skills. Homebrew publishing pipeline included from the start.
