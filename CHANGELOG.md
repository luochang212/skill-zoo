# Changelog

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
