# Changelog

## [0.1.7] — 2026-05-17

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
