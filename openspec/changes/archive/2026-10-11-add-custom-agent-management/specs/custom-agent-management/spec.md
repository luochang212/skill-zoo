## Purpose

Define how users register and manage additional coding agents without a release, while preserving file ownership and giving those agents the same shared skill-management behavior across desktop and CLI.

## ADDED Requirements

### Requirement: Custom agent lifecycle

Users MUST be able to add, rename, change the Skills directory, and unregister a custom agent in Settings. Identity MUST remain stable across rename and path changes and MUST NOT be reused after removal. Built-in registrations MUST remain protected from these lifecycle edits.

#### Scenario: Rename a registered agent
- **WHEN** a user renames a custom agent
- **THEN** labels update without restart and visibility, order, metadata and links retain their identity

#### Scenario: Built-in registration is protected
- **WHEN** a lifecycle command targets a built-in agent
- **THEN** it is rejected without changing configuration or files

### Requirement: Unified management interaction

The existing agent manager MUST provide an Add Custom Agent action and custom-row editing actions in both searched and unfiltered views. Forms MUST have labeled name and Skills directory fields, native directory selection, inline validation, explicit save/cancel actions and preserved input after failure. Missing directories MUST require explicit creation consent.

#### Scenario: Add succeeds while search is active
- **WHEN** a user adds a valid custom agent while searching the manager
- **THEN** the saved row is revealed, its visibility status is shown and focus returns to that row

#### Scenario: Failed or canceled form
- **WHEN** validation or saving fails, or the user cancels
- **THEN** failures keep entered values available for correction and cancellation writes no registration or directory

#### Scenario: Missing directory
- **WHEN** the selected Skills directory does not exist
- **THEN** saving requires explicit create-directory consent and cancellation leaves it absent

### Requirement: Accessible lifecycle interaction

Lifecycle views MUST preserve keyboard focus, dialog labeling, visible focus, IME-safe submission and en/zh localization. Pending mutations MUST prevent duplicate submission and conflicting lifecycle actions; errors MUST be associated with the relevant field and announced. Closing an unsaved form MUST offer discard or continue editing.

#### Scenario: Keyboard and IME submission
- **WHEN** a user confirms an IME candidate or submits an invalid form
- **THEN** composition does not submit and invalid submission focuses the first invalid field

#### Scenario: Return from editing
- **WHEN** an editor is saved or canceled
- **THEN** the manager restores scroll/search state and focus to the edited row, or a sensible surviving control after removal

### Requirement: Directory ownership boundaries

Registration MUST reject duplicate custom names ignoring case, equivalent directory roots, ancestor/descendant overlaps with registered roots, and overlaps with SSOT, archive or application state. Directory aliases MUST be compared by resolved filesystem identity. Existing external-import sources MUST retain external ownership even when enclosed by a newly registered root.

#### Scenario: Alias or nested agent root
- **WHEN** a proposed root resolves to an existing agent root or encloses/is enclosed by it
- **THEN** registration fails before filesystem writes and identifies the conflicting registration

#### Scenario: Imported source becomes enclosed
- **WHEN** an agent is registered around an external-import source
- **THEN** that source remains an external management object, is not duplicated and cannot be deleted or archived as an agent-owned skill

### Requirement: Shared skill-management parity

Registered custom agents MUST participate in every shared management surface using the same origin-specific rules as built-ins: discovery, detail/editing, metadata, install/update, link/unlink, drag/drop, local scope, consistency/conflicts, archive/restore and directory opening. CLI agent selection and all-target operations MUST resolve the same registrations.

#### Scenario: Install and link across agent types
- **WHEN** a user installs a remote skill to a built-in and a custom agent
- **THEN** both reference one SSOT entity through links and selected-target preflight protects existing entries

#### Scenario: Local skills and conflict scope
- **WHEN** a custom agent contains an existing real skill directory
- **THEN** it remains in place, supports applicable built-in management operations, and participates in conflicts only in the same visible/selected scope as a built-in

#### Scenario: Archive and restore
- **WHEN** an eligible custom-agent skill is archived and restored
- **THEN** original location, managed links and metadata are restored under the same failure/rollback rules as built-ins

### Requirement: Safe path changes and unregistering

Path changes and unregistering MUST preserve real skill directories, external sources, foreign links and links in other agents. Remaining discovered real skills under the old root MUST stay manageable through external references. Only owned links in the departing root MAY be cleaned, with partial cleanup reported. Registration changes MUST NOT silently redirect archived skills to a new root.

#### Scenario: Unregister a local skill's home agent
- **WHEN** a custom agent with real skills and links from other agents is unregistered
- **THEN** real files and other-agent links remain intact, and the real skills remain visible as external management objects with metadata preserved

#### Scenario: Change directory
- **WHEN** a custom agent changes its Skills directory
- **THEN** the new directory is scanned without copying old files, old real skills remain externally managed, and existing archived restore destinations remain unchanged

#### Scenario: Persistence fails
- **WHEN** lifecycle persistence fails
- **THEN** registration and runtime state remain unchanged and no user file or existing link is destroyed

### Requirement: Runtime reconciliation

Successful lifecycle changes MUST refresh registered paths, preferences, skill availability and dependent views without restarting. Newly added roots MUST receive filesystem updates, departed roots MUST stop agent scanning, and shared external watch coverage MUST be retained. Concurrent installs MUST never combine old identity with a new target path.

#### Scenario: Newly added directory changes
- **WHEN** a skill file changes after successful registration
- **THEN** the application refreshes that skill without requiring restart

#### Scenario: Concurrent removal and installation
- **WHEN** a lifecycle change races with installing or linking a skill
- **THEN** operations execute against a consistent registry state or fail before writing an invalid target

### Requirement: Upgrade reconciliation of shipped agents

Desktop and CLI MUST preserve custom identities and ownership when built-in support is added. Disjoint same-name entries MUST coexist. Built-in roots overlapping custom roots MUST be excluded from scans and write targets, with an explanation in management. Reconciliation MUST NOT rewrite registry bytes or infer usage adapters from labels.

#### Scenario: Official support follows custom registration
- **WHEN** a newly shipped built-in overlaps an existing custom Skills directory
- **THEN** the custom ID remains the sole active target for that root, startup succeeds, preferences and registry bytes remain unchanged, and management explains why the built-in is not enabled

#### Scenario: Aliased or missing overlapping root
- **WHEN** a built-in root equals, contains or is contained by a custom root through an alias or a missing leaf
- **THEN** desktop and CLI compare existing ancestor filesystem identities and suppress the overlapping built-in

#### Scenario: Same name without overlapping directories
- **WHEN** a shipped built-in and a custom registration have equal labels but disjoint roots
- **THEN** both remain independently usable with unchanged identities and path/origin distinctions

#### Scenario: Custom overlap is removed
- **WHEN** the custom registration is removed or changes to a disjoint directory
- **THEN** the built-in becomes available, the visibility cap is respected, and retained skills remain external management objects with their original IDs, metadata and archive destinations even under the built-in root

### Requirement: Truthful tool-specific capabilities

All agents MUST have access to shared management and global Common Commands. Usage tracking MUST be exposed only where the tool's log format has an implemented adapter; unsupported tools MUST NOT offer usage tracking or fabricate zero usage. Existing supported collectors MUST retain their behavior.

#### Scenario: Agent has no usage adapter
- **WHEN** a custom agent's capabilities are viewed
- **THEN** management is available, Common Commands remains available, and usage tracking is unavailable

#### Scenario: Existing supported agent
- **WHEN** custom registration support is enabled
- **THEN** Claude Code, Codex and OpenCode statistics continue to use their existing collectors
