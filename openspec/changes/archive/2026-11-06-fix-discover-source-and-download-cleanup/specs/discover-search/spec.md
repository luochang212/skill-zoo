## Purpose

Define which skills.sh search sources can be opened as GitHub repositories.

## ADDED Requirements

### Requirement: Search results accept valid GitHub sources

The system SHALL retain skills.sh results whose source is a valid GitHub owner/repository pair, including repository names containing dots. It SHALL exclude domain-based sources and malformed pairs before local installation status classification.

#### Scenario: Dotted repository source

- **WHEN** a result source is `citypaul/.dotfiles` or `dmmulroy/.dotfiles`
- **THEN** the result is retained with its original owner and repository name

#### Scenario: Non-GitHub or malformed source

- **WHEN** a source contains a domain owner, an empty segment, extra path segments, or invalid repository characters
- **THEN** it is excluded from GitHub discovery results
