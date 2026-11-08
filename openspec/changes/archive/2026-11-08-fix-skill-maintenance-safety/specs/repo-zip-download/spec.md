## ADDED Requirements

### Requirement: Download cache maintenance preserves active work

Download cache size and clearing SHALL include only completed regular ZIP files in the application's repository ZIP cache. They SHALL exclude temporary downloads, symbolic links and unrelated files. Clearing SHALL surface removal failures other than files concurrently disappearing, and the maintenance UI SHALL re-read size after a clearing attempt.

#### Scenario: Clear while downloading
- **WHEN** a download has an open temporary file and the user clears the download cache
- **THEN** the temporary file remains available for the download to publish and is excluded from the displayed clearable size

#### Scenario: Unrelated files and links
- **WHEN** the cache directory contains unrelated files or symbolic links
- **THEN** maintenance leaves them untouched and excludes them from its size

#### Scenario: Background downloads change the size
- **WHEN** clearing finishes while another task has published an archive
- **THEN** the displayed size is read again rather than calculated from an earlier size
