## ADDED Requirements

### Requirement: Preserve the non-SSOT visibility preference across upgrades

The local view MUST preserve the user's effective non-SSOT visibility choice when upgrading from the legacy hide preference. The current show preference MUST take precedence when present; otherwise the legacy hide preference MUST be inverted. With neither preference recorded, non-SSOT skills MUST remain shown. Reading settings MUST NOT rewrite the stored preferences. See docs/local-protocol.md for the settings contract.

#### Scenario: Existing hide preference
- **WHEN** only the legacy hide preference is enabled
- **THEN** non-SSOT skills remain hidden after upgrading

#### Scenario: Current preference overrides legacy preference
- **WHEN** both preferences exist
- **THEN** the current show preference determines visibility without rewriting either preference

#### Scenario: New user
- **WHEN** neither preference exists
- **THEN** non-SSOT skills are shown by default
