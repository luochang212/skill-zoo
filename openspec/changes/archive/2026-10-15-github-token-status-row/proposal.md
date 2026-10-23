# Proposal

## Why

The redesigned GitHub connection row (commit 2623992) derives its subtitle from stored and freshly verified state (anonymous quota, configured, verified quota, expired) and turns amber once the recorded expiry is within seven days or has passed. The github-connection spec never recorded this behavior, so the living spec and the shipped UI disagree about what the row promises.

## What Changes

- Record the status-row derivation and the seven-day warning threshold as a github-connection requirement, wording behavior-level so copy stays in i18n.
- No code, copy or test changes.

## Capabilities

### Modified Capabilities

- `github-connection`: the connection row's state-driven status line and expiry warning are now specified behavior.

## Impact

OpenSpec artifacts only (one ADDED requirement in the main spec). No Rust, frontend, i18n, CLI or protocol-fixture changes.
