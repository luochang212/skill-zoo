## ADDED Requirements

### Requirement: Full-page skeletons cover the available loading region

At the default 1100 × 700 window size, existing full-page list and grid loading skeletons SHALL extend through the available content region with normal row/card proportions. Excess placeholders SHALL be clipped instead of creating fake scrollable content. Header, navigation, compact cards and modal placeholders SHALL retain their natural scope. Loaded content layouts SHALL remain unchanged.

#### Scenario: Repository and recommendation loading

- **WHEN** discovery repository skills or recommended repositories are loading at the default window size
- **THEN** placeholder rows or cards reach the bottom of the available loading region without stretching individual placeholders

#### Scenario: Local skill loading

- **WHEN** the local grid, list or consistency page is loading at the default window size
- **THEN** its main skeleton content fills the available region and does not scroll through dummy content
