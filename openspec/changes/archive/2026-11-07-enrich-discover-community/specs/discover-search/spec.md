## ADDED Requirements

### Requirement: Community GitHub skill discovery
Discover SHALL offer popular and 24-hour trending skills from skills.sh through Rust IPC, alongside independent curated repositories. Cards SHALL identify source and metric period, support keyboard operation, and reveal further entries progressively while scrolling, each batch arriving through a staggered entrance. The first screen SHALL distribute exposure across repositories.

#### Scenario: External catalog unavailable
- **WHEN** a catalog request fails
- **THEN** the last successful catalog is shown as saved results, or a retry state appears if none exists
- **AND** curated repositories remain usable

#### Scenario: Safe catalog intake
- **WHEN** upstream catalog data is read
- **THEN** malformed sources, non-GitHub domains, invalid slugs and duplicates are excluded
- **AND** requests have a timeout and response-size bound

### Requirement: Recommended skills use real repository paths
Opening a community skill SHALL load its repository through existing session tasks, uniquely resolve its real skill key, and preview it. Installation SHALL use that key and the existing agent-selection confirmation. Missing or ambiguous matches SHALL leave repository browsing available without selecting an arbitrary skill.

#### Scenario: Nested skill or root skill
- **WHEN** a catalog slug matches one real nested or root skill
- **THEN** the actual SKILL.md is previewed and its real key is passed to installation
- **AND** the default branch is resolved by the existing repository flow

#### Scenario: Ambiguous match
- **WHEN** multiple repository skills match a catalog slug
- **THEN** no preview or installation is chosen automatically
- **AND** a notice invites the user to choose from the repository list
