# app-lifecycle Specification

## Purpose

Desktop process lifecycle guarantees. The app runs as a single instance — a second launch focuses the existing window instead of forking a second process that would race the cross-process skill-store writes — so local-protocol state keeps one writer at a time.

## Requirements

### Requirement: Single instance launch

The app SHALL run as a single instance: when a second launch is attempted while an instance is already running, the existing instance's main window SHALL be brought to front and the second process SHALL exit without showing its own window.

#### Scenario: Second launch while app is running
- **WHEN** the user launches the app while an instance is already running
- **THEN** the existing instance's main window is shown, unminimized and focused, and the second process exits

#### Scenario: First launch with no existing instance
- **WHEN** the app is launched with no existing instance
- **THEN** the app starts normally and creates its main window
