## ADDED Requirements

### Requirement: Plugin skills stay outside conflict and duplicate scope

Discovered plugin skills MUST NOT participate in same-name duplicate checks, install-candidate conflict checks or install preflight, in addition to the existing exclusions for hidden-agent skills and external imports. Installing a skill whose name matches a plugin skill MUST NOT be blocked or flagged by that plugin skill. Plugin skills remain visible as read-only entries on the Local page.

#### Scenario: Install colliding with a plugin skill name

- **WHEN** an install candidate or preflight target shares a name with a discovered plugin skill
- **THEN** the plugin skill produces neither a duplicate warning nor a conflict marking, and the install proceeds under the normal skill-installation scope rules

#### Scenario: Duplicate check ignores plugin skills

- **WHEN** the local duplicate/consistency check runs while a plugin skill shares a name with an installed skill
- **THEN** the plugin skill is not reported as a duplicate of the installed skill
