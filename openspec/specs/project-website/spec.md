# project-website Specification

## Purpose

Define the public Skill Zoo website's bilingual static presentation, release download behavior and publication boundary.

## Requirements

### Requirement: Static bilingual presentation
The website SHALL produce complete English and Chinese HTML with language-specific titles, descriptions, canonical/alternate links and a sitemap. Both pages SHALL preserve the established section order, styling and screenshots. Website dependencies and build outputs SHALL remain independent of the desktop and CLI builds.

#### Scenario: Read a localized page without JavaScript
- **WHEN** a visitor opens the English root or Chinese /zh/ route with JavaScript disabled
- **THEN** the corresponding localized product copy and screenshot assets are present in the HTML

#### Scenario: Follow an existing language link
- **WHEN** a visitor opens an existing ?lang=zh or ?lang=en URL with JavaScript enabled
- **THEN** the website selects the matching static language route while preserving the anchor and unrelated query parameters

#### Scenario: Select the root language
- **WHEN** a visitor opens the root with JavaScript enabled and no language query
- **THEN** a valid saved language preference, or otherwise the browser language, selects the initial language
- **AND** automatic detection does not use the system timezone
- **AND** directly opening /zh/ retains Chinese unless an explicit language query overrides it

### Requirement: Release-aware downloads
The website SHALL retain the install modal and platform download selection. It SHALL obtain the released version from the public version.json under the deployment base, including on nested language routes. It SHALL offer macOS DMG, Windows installer and portable ZIP, Linux x86_64/ARM64 AppImage and Debian package links using release asset names.

#### Scenario: Download for the visitor's platform
- **WHEN** the version manifest supplies a released version and the visitor clicks download
- **THEN** the website opens the localized install modal and starts the matching platform download

#### Scenario: Version information is unavailable
- **WHEN** the manifest request fails or supplies no version
- **THEN** the modal's manual link points to the releases list and no fabricated versioned asset is automatically downloaded

#### Scenario: Browse another platform
- **WHEN** the visitor switches an install-modal platform tab
- **THEN** its filename, manual download, installation steps and alternative package links update consistently without automatically downloading another package

### Requirement: Build and publication pipeline
Pull requests affecting the website SHALL build and validate it without publishing. Main-branch website updates SHALL build an artifact for GitHub Pages Actions deployment. Release automation SHALL update the released-version manifest in the website source, and that path SHALL trigger the website workflow.

#### Scenario: Publish a new released version
- **WHEN** release automation pushes a new released-version manifest to main
- **THEN** the website workflow includes that manifest in its generated artifact

#### Scenario: Review a website change
- **WHEN** a pull request changes website sources or deployment workflow
- **THEN** the workflow checks the built site's bilingual routes and download behavior without running a deployment
