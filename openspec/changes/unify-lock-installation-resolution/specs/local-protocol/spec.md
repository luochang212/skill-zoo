## ADDED Requirements

### Requirement: Physical installation and original lock key association

Desktop and CLI MUST resolve complete real installation inventory before selecting a shared lock entry, following docs/local-protocol.md and shared fixtures. All candidates and reverse ownership MUST be checked before deciding Resolved, Missing or Ambiguous. External imports MUST NOT own entries, uncorroborated agents MUST NOT inherit SSOT entries, and visibility MUST NOT change ownership.

#### Scenario: Flat installation with namespace lock key
- **WHEN** a flat demo has matching GitHub repo and source directory evidence for author/demo
- **THEN** scans associate its original entry while keeping demo as its physical installation directory and preserving lock bytes

#### Scenario: Competing associations
- **WHEN** multiple keys match, a shared entry matches independent real directories, or valid evidence contradicts a traditional key
- **THEN** scanning preserves the file object without invented provenance and mutations reject ambiguity before changing files or stores

### Requirement: Exact-key lifecycle and physical update targets

All consumers MUST use installation directory for file replacement, refresh and Check/checked identity, and original lock key for baseline writes and lock removal. Updates MUST re-resolve current inventory and compare the original complete entry snapshot before replacement and baseline commit. Missing associations MUST refuse remote update and MUST NOT guess a key during local deletion/archive/editing. C2 tracking protection MUST remain enforced.

#### Scenario: Historical leaf update
- **WHEN** .system/demo resolves to the unique historical demo key and a remote update succeeds
- **THEN** only .system/demo is replaced and only demo receives the dual baseline, with no new directory or key

#### Scenario: Association changes during download
- **WHEN** a lock key, entry, competing candidate, physical identity or SKILL.md changes after preparation
- **THEN** replacement is refused with updateStateChanged and the external state is preserved

#### Scenario: Check physical identity
- **WHEN** a physical installation resolves to a differently named lock key or has no unique association
- **THEN** Check reports the physical directory, uses lockMissing/lockAmbiguous issues when applicable, excludes dangling lock entries, and never writes the lock

### Requirement: Snapshot restore preserves exact original keys

Archive MUST save the resolved original lockKey and complete lockEntry. Restore MUST check original key conflicts and other candidate ownership before moving files, MUST NOT normalize or rekey original lockKey, and MUST allow an already equal entry without rewriting it. Failure rollback MUST restore only the keys actually changed by the operation to their before values.

#### Scenario: Conflicting restore key
- **WHEN** the archived original key has a different current entry
- **THEN** restore fails before moving the archived directory or changing stores

#### Scenario: Equal entry and later failure
- **WHEN** the original key already contains an equal entry and restore later fails
- **THEN** rollback preserves that existing entry and returns files to the archive
