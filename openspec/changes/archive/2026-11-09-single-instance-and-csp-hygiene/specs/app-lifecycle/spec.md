## ADDED Requirements

### Requirement: Single instance launch

The app SHALL run as a single instance: when a second launch is attempted while an instance is already running, the existing instance's main window SHALL be brought to front and the second process SHALL exit without showing its own window.

#### Scenario: Second launch while app is running
- **WHEN** the user launches the app while an instance is already running
- **THEN** the existing instance's main window is shown, unminimized and focused, and the second process exits

#### Scenario: First launch with no existing instance
- **WHEN** the app is launched with no existing instance
- **THEN** the app starts normally and creates its main window
