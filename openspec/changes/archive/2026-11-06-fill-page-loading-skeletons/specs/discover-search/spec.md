## MODIFIED Requirements

### Requirement: Repository reading remains usable during skill loading

Repository metadata and navigation SHALL remain usable while the skill list loads. Discovery repository details SHALL NOT display or request a README. Installation SHALL continue to require the user's skill and agent choices.

#### Scenario: Read while loading

- **WHEN** skill discovery is still pending
- **THEN** the user can inspect repository metadata and leave while discovery continues, without a README section or README request from the discovery detail
