## Context
Peer research under /tmp/skill-zoo-discovery-lpqqd063 found most managers use skills.sh. The live leaderboard embeds initialSkills in Next payloads and does not provide skill descriptions. Catalog slugs are not filesystem paths.

## Goals / Non-Goals
Provide GitHub discovery through preview and explicit installation. No personalized ranking, automatic installs, generic feed framework, or new persistence protocol.

## Decisions
- Rust owns bounded HTTP requests and JSON payload decoding, with an hourly disposable cache and stale-on-error fallback.
- Use two existing upstream catalogs. Spread first-screen exposure across repositories, preserving order within each repository. Counts retain their upstream total/24h meanings; they are not stars or endorsements.
- Keep three curated repository cards initially, with the remaining repositories available on request. Community cards show name, source and one metric; full descriptions come from actual SKILL.md metadata after opening.
- Reuse repository session tasks, default-branch resolution and installation confirmation. Uniquely match actual key, then frontmatter name/basename; ambiguous or missing matches show a notice and repository choices.
- Use the house dialog for preview so Escape, focus containment and install action are available.

## Risks / Trade-offs
The upstream embedded payload is not a versioned API. Parse failures preserve the previous catalog and do not affect curated repositories. Descriptions are intentionally not fabricated or fetched for every card. Catalog popularity is not a security review.

## Verification
Parser tests cover escaped HTML payloads, malformed/domain sources and duplicates. UI tests cover metrics, progressive disclosure and source selection; resolution tests cover real nested/root paths and ambiguous matches. Validate type/lint/build, frontend/backend tests and OpenSpec.
