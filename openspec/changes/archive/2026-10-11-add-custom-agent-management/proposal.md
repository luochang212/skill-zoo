# Proposal

## Why

Issue #9 requests user-defined agents: each new tool currently requires registry changes and a release. The previous experiment's repeated list construction is an implementation cost, not evidence that dynamic registration inherently causes unacceptable performance; the current data-driven frontend and incremental watcher make a bounded implementation practical.

## What Changes

- Add, rename, change the Skills directory, and unregister custom agents through the existing Settings agent manager, with explicit directory validation and file-preserving lifecycle behavior.
- Give custom agents the same public management features as built-ins: visibility/order/search, local discovery, installation, linking/unlinking, drag/drop, skill editing, metadata, conflict checks, updates, consistency checks, archive/restore, directory opening, and CLI operations wherever those operations apply to the skill's origin.
- Resolve built-in and custom agents through one registry snapshot per operation; update watcher roots and derived UI/cache state without restart.
- Define a desktop-owned, versioned custom-agent registry readable by the CLI; publish its document, fixtures, and Rust/CLI contract tests together.
- Preserve external-import ownership when adding an agent around an imported source. Preserve remaining local skills as external management objects when unregistering an agent.
- Display tool-specific capabilities honestly. Common Commands remains available globally; usage tracking follows supported log adapters without offering unsupported statistics or pretending arbitrary tools produce compatible logs.
- Reconcile future shipped support without migrating custom identities: allow disjoint same-name entries and suppress overlapping built-in defaults with an explanation on desktop and CLI.
- Include interaction acceptance, cross-agent parity tests, concurrent lifecycle boundaries, and reproducible performance comparison before delivery.

## Capabilities

### New Capabilities

- `custom-agent-management`: Agent registration lifecycle, frontend interaction, management parity, directory boundaries, and runtime reconciliation.

### Modified Capabilities

- `local-protocol`: Desktop-owned custom-agent registry and cross-surface compatibility.
- `agent-visibility`: Apply existing visibility/order rules to custom agents and define initial visibility under the cap.

Existing `desktop-ui`, `local-skill-scope`, `skill-installation`, and `skill-archiving` contracts remain in force; this change extends their applicability to registered custom agents without weakening their requirements.

## Impact

- Rust: `config.rs`, `store.rs`, settings/skill commands, skill/CLI/archive/watcher services, registry persistence, usage capability reporting.
- Frontend: AgentManagerDialog, AgentPathsSettings, typed APIs/types, agent/config/preferences hooks, all agent consumers, and en/zh strings. Reuse current Dialog/Input/Button patterns and Safari 16.4 floor.
- CLI: agent validation, paths, scans, installs/imports, diagnostics, archive/restore and all-target resolution; registration authoring remains in desktop Settings.
- Protocol: `docs/local-protocol.md`, `fixtures/local-protocol/`, Rust tests and `packages/cli/tests/protocol-fixtures.test.ts`. No changes to existing lock/archive schemas unless required by an explicitly documented compatibility decision.
- Evidence: issue https://github.com/luochang212/skill-zoo/issues/9; old experiment `c5442a2`; inspected current code, not performance benchmarks. Performance claims require implementation-time measurements.
- Scope assumption: parity means shared management behavior plus truthful tool-specific capability reporting. Arbitrary new usage-log parser development is outside this change; existing agent statistics must not regress.
