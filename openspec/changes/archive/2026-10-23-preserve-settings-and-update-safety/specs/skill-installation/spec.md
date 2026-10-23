## ADDED Requirements

### Requirement: Recheck modifications after update preparation

The update flow MUST recheck a usable content baseline after downloading and preparing replacement content, immediately before replacing the installed directory. A newly modified skill MUST remain unchanged unless the user explicitly authorized overwriting that skill. Batch updates MUST report it as skipped; single updates MUST request overwrite confirmation. Existing unknown-baseline behavior MUST remain unchanged.

#### Scenario: Edit while downloading
- **WHEN** a skill matches its baseline at preflight but is edited while update content is prepared
- **THEN** the replacement does not overwrite the edit and its stored baseline remains unchanged

#### Scenario: Explicit overwrite applies to one skill
- **WHEN** the user confirms overwriting a particular skill
- **THEN** its replacement proceeds even if it differs from its baseline, without authorizing overwrites of other skills

### Requirement: Keep unfinished checked updates actionable

After a selected or per-skill update completes, the update manager MUST remove only successfully updated candidates and MUST retain skipped, failed and unselected candidates without another network check. A candidate newly skipped for modifications MUST offer its per-skill overwrite confirmation action.

#### Scenario: Mixed candidate list
- **WHEN** one clean candidate updates successfully while two modified candidates remain
- **THEN** both remaining candidates still offer individual overwrite actions, including after confirming one of them

#### Scenario: Newly modified candidate is skipped
- **WHEN** a selected candidate is skipped because edits occurred after checking for updates
- **THEN** it stays in the list marked as locally modified with an explicit overwrite action
