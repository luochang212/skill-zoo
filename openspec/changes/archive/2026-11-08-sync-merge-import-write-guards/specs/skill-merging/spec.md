## ADDED Requirements

### Requirement: Merge verifies live ownership and content before destructive moves

Merging duplicates into SSOT MUST verify, against the live filesystem rather than only cached records, that each participating skill's home still matches its recorded owner root and relative directory, that no source contains symbolic links, that SKILL.md is a real file, and that all sources still hash identically. A merge destination occupied by an unrelated entry MUST be rejected. Stale or spoofed ownership MUST fail the operation without moving files.

#### Scenario: A cache record points outside its recorded owner root

- **WHEN** an agent-origin entry's home no longer resides under that agent's skills root
- **THEN** the merge fails and the source directory is preserved unchanged

#### Scenario: Sources diverged since the cache was built

- **WHEN** one duplicate's live content hash differs from the others
- **THEN** the merge fails with a refresh-and-retry error and all originals are preserved

#### Scenario: The destination is already occupied

- **WHEN** the SSOT directory exists as a symlink, without SKILL.md, or owned by no participating entry
- **THEN** the merge fails and reports the occupied destination

### Requirement: Merge commits stores only after staging succeeds

Merge MUST stage original skill directories and pre-existing cross-agent links into same-filesystem backups before destructive moves, redirect staged links to the merged SSOT directory, and persist the skill cache and user metadata only after both saves succeed. The merged cache state MUST evict exactly the merged IDs, preserving external and plugin namesakes, and user flags MUST migrate to the merged identity as a union.

#### Scenario: All saves succeed

- **WHEN** merging duplicates of one name completes without errors
- **THEN** agent originals are gone, cross-agent links target the SSOT directory, the cache holds one merged entry plus preserved external/plugin entries, and merged user flags reflect the union of the merged IDs

#### Scenario: Cache or metadata persistence fails

- **WHEN** either store save fails during the merge
- **THEN** created links are removed, originals and pre-existing links are restored from staging, the prior in-memory and on-disk store state is reinstated, and the operation reports the original failure

### Requirement: Failed merge recovery discloses incompleteness

If merge recovery cannot restore a staged original because its path was recreated externally, the operation MUST keep the backup in place and report its location instead of overwriting foreign files. Committed backup cleanup failures MUST be logged without rolling back committed data. This requirement does not establish process-crash or power-loss atomicity.

#### Scenario: An external writer recreates a staged home during recovery

- **WHEN** recovery finds the original path already occupied
- **THEN** the backup directory is retained and the failure message names its location

#### Scenario: Backup cleanup fails after commit

- **WHEN** the merge has committed and a staged backup directory cannot be removed
- **THEN** the merge result stands and the cleanup failure is logged

### Requirement: Merge coordinates with other local writers and refreshes

Merge MUST acquire the shared local writer lease and serialize its work against cache rebuilds under the refresh lock, with existing update-exit protection covering the whole operation. Waiting or cancelled operations MUST NOT leave a writer lease held. Guarded entry points MUST be the only production path; unguarded signatures MAY exist solely in test builds.

#### Scenario: A cache refresh is active

- **WHEN** a merge begins while a serialized refresh is active
- **THEN** it waits before changing files and stores

#### Scenario: Link creation fails

- **WHEN** creating a post-merge link fails
- **THEN** the merge rolls back staged files, links and stores instead of logging the failure and continuing
