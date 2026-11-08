## ADDED Requirements

### Requirement: Plugin discovery switches give immediate feedback

The plugin discovery switch SHALL display the requested state immediately after activation and remain disabled until saving and refreshing finish. Saving failure SHALL restore the confirmed prior state; refresh failure after successful saving SHALL preserve the newly saved state. Failures SHALL display an error. A failed settings reread SHALL NOT discard the last confirmed saved value.

#### Scenario: Immediate feedback while saving
- **WHEN** the user enables or disables plugin discovery and saving is pending
- **THEN** the switch immediately displays the requested value and is disabled

#### Scenario: Saving fails
- **WHEN** the preference cannot be saved
- **THEN** the switch returns to the confirmed prior value, becomes interactive again and displays an error without starting a skill refresh

#### Scenario: Scanning fails after saving
- **WHEN** saving succeeds but refreshing skills fails, including when rereading settings also fails
- **THEN** the switch retains the saved value, becomes interactive again and displays an error
