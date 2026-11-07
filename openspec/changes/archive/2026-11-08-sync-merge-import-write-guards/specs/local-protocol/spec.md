## ADDED Requirements

### Requirement: External import registration rejects ambiguous selections before writing

Importing external sources MUST reject, before any write, the same physical source selected more than once (by canonical path) and selections whose flat agent link names collide. A source whose SKILL.md is not a real file MUST be rejected. Existing version-rejection and ownership-preservation rules are unchanged.

#### Scenario: One source selected under two directories

- **WHEN** an import batch contains the same canonical source path twice
- **THEN** the operation fails before creating links or writing the registry

#### Scenario: Two selections need the same link name

- **WHEN** two selections in one batch map to the same flat agent link name
- **THEN** the operation fails before creating links or writing the registry

### Requirement: External import rollback is owned by the registry snapshot

When source scanning, link creation or the batched cache commit fails, the import MUST undo its newly created links, restore the full external-imports registry from the pre-operation snapshot, and leave pre-existing links and pre-existing import IDs and timestamps untouched. Incomplete recovery MUST be disclosed. Post-commit cleanup of retired links and watcher registration remain best-effort. This requirement does not establish process-crash or power-loss atomicity.

#### Scenario: The batched cache commit fails

- **WHEN** persisting the skills cache fails after links were created and the registry was written
- **THEN** the new links are removed, the registry is restored to its prior content, the cache stays empty of the batch, and the failure is reported

#### Scenario: A pre-existing link for the same directory

- **WHEN** an agent directory already contains a link for the imported directory and the import later fails
- **THEN** that pre-existing link survives and the registry keeps the original import timestamp
