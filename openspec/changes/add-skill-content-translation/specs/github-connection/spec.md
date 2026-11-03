## REMOVED Requirements

### Requirement: Saved credential is never redisplayed
**Reason**: Fixed stand-in masks cause length jumps and prevent viewing an owned credential.
**Migration**: No storage migration; replace the UI mask with a dedicated credential read and native password masking.

## ADDED Requirements

### Requirement: Saved credential can be viewed and edited

The dialog SHALL load the real saved token through a dedicated Rust IPC command when opened. The generic settings read SHALL continue to omit credential keys. The input SHALL default to password masking using the real value, with an eye button to show or hide it. Fixed-length stand-in masks SHALL NOT be used. Reading, toggling visibility, and editing SHALL NOT save credentials. The unchanged value SHALL leave saving unavailable. Loading or failed token reads SHALL disable editing and saving.

#### Scenario: View a saved token
- **WHEN** the dialog opens with a saved token and the user toggles the eye button
- **THEN** the real token is shown or hidden without modifying or saving it

#### Scenario: Clear a saved token
- **WHEN** the user empties the field using text editing or the clear icon and explicitly saves
- **THEN** the token and expiry are removed together without verification and runtime authentication returns to anonymous mode

#### Scenario: Cancel editing
- **WHEN** the user edits or clears the token and closes the dialog without saving
- **THEN** the saved credential remains unchanged and reopening shows the saved value hidden

#### Scenario: Save replacement
- **WHEN** a changed nonempty token is verified and saved
- **THEN** the real saved value remains in the password input and the status shows the verified quota and expiry

## MODIFIED Requirements

### Requirement: Token replacement and startup

The desktop SHALL maintain one saved GitHub credential. Saving a verified replacement SHALL update token and expiry atomically. Explicitly saving an empty field SHALL remove both and restore anonymous runtime authentication; closing without saving SHALL preserve them. A saved token SHALL authenticate requests at startup until its recorded expiry, without being presented as freshly verified merely because it exists on disk.

#### Scenario: New token replaces the old
- **WHEN** a new token is verified and saved while a previous credential exists
- **THEN** the new token and its expiry replace the previous ones in a single write

#### Scenario: No new token entered
- **WHEN** the credential dialog is submitted while a token is saved and the token field is unchanged
- **THEN** the saved token and its expiry remain unchanged

#### Scenario: Restart with configured token
- **WHEN** the desktop starts with a saved token
- **THEN** GitHub API reads use it and the settings section distinguishes configured from freshly verified status

#### Scenario: Failed credential save
- **WHEN** persisting a token and its expiry fails
- **THEN** persisted settings and runtime authentication both remain unchanged

