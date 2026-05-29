# Changelog

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
