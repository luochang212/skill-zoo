# Second round: real recovery failures and repeated replay

Date: 2026-10-23. Base: `4daae2c` (first study now pushed to `origin/main`).
See the [ADR proposal](../../../adr/proposed/2026-10-23-evaluate-verus-on-isolated-transaction-logic-before-adopting-it.md)
and [first-study/current-model overview](README.md).

## Question and result

Does the real recovery code preserve its journal after a partially completed
replay, tolerate the same failure twice, and restore the selected snapshot after
the obstruction is removed? Does failure during lease acquisition release the
lease so recovery can be retried?

**Yes for the exercised macOS filesystem cases in both Rust and CLI.** No new
production defect was reproduced. Runtime implementation, fixtures, schemas,
build dependencies and CI remain unchanged. The experiment adds regression tests
and strengthens the isolated Verus model, without claiming production verification.

## Experiment

Both runtimes read the existing shared `agent-lifecycle-v1-pending.json` and
`agent-lifecycle-v1-committed.json` fixtures. Each snapshot covers three files:
`agents.json`, `imports.json`, and `settings.json`. Initial accessible files have
distinct partial contents and an unrelated file must remain untouched.

For each marker state and failure position (0, 1, 2 completed files), create an
empty directory at the next target file path. This causes an actual file-delete
or file-replacement error instead of a mocked return value. Run recovery twice
while blocked; each time assert:

1. Recovery returns an error and the journal bytes remain exactly unchanged.
2. The completed prefix equals the selected before/after snapshot, including
   `None`/absence where applicable.
3. The blocked directory and unreplayed suffix remain unchanged.

Remove only the test-created directory, then retry. Assert that all affected
files match the selected snapshot, the journal is gone, a further no-journal
recovery leaves the result unchanged, and the unrelated file is preserved.

This gives six scenarios per runtime, each with two failures followed by a
successful retry. Separate Rust and CLI tests exercise recovery failure during
lease acquisition and successful acquisition/recovery after removing the blocker.
Temporary homes are isolated and cleaned up; no real user settings are involved.

## Retained production-path tests

- Rust `failed_recovery_keeps_journal_and_retries_every_replay_prefix` and
  `failed_recovery_releases_lease_before_retry` in
  [`agent_transaction.rs`](../../../src-tauri/src/persistence/agent_transaction.rs).
- CLI `retains a failed recovery journal and retries every shared replay prefix`
  and `releases the CLI lease when recovery fails so recovery can be retried` in
  [`custom-agents.test.ts`](../../../packages/cli/src/protocol/custom-agents.test.ts).

Reproduce from the repository root:

```sh
cargo test --features test-helpers --manifest-path src-tauri/Cargo.toml \
  --lib persistence::agent_transaction::tests -- --nocapture
bun run cli:test
bun run cli:typecheck
```

Observed: **9 Rust transaction tests and 118 CLI tests passed**, with all six
replay-prefix cases succeeding in each runtime. CLI typechecking passed.
The preceding push also completed its full checks before these tests were added;
the 255 frontend tests and earlier full backend suite are not presented as a
fresh run for this test-only change.

## Model extension

`partial_recovery_is_idempotent` proves that repeating the same selected replay
prefix preserves the first replay's state, the unchanged suffix and the journal
retention decision, for arbitrary admissible vector lengths and content tokens.
This is a general argument corresponding to the repeated-failure observations.

The updated model verifies **7 units with 0 errors**. All five implementation
mutations fail verification. The new mutation changes the committed marker only
for the second replay and fails the idempotence assertion, demonstrating why
retaining the same journal/marker is part of the model's assumptions.
[`results.json`](results.json) contains the exact verifier, source hash, counts,
failure classes and timings. Run the existing `verify.py` command from the
overview to reproduce both the positive proof and all negative checks.

## Interpretation and next boundary

The model and both production implementations agree on these selected traces.
The tests strengthen the correspondence by exercising real IO failures and
checking actual files, journal retention and lease cleanup. They still do not
constitute a formal refinement proof from runtime code to the model.

An empty-directory obstruction is one deterministic error class; it does not
simulate process termination, torn storage, disk-full, permission races, repeated
failure at changing positions, malformed journals or power-loss ordering. The
directory blocker itself is outside the model's file-content token domain. Tests
connect the observed prefix/error/retry behavior to the model; they do not prove
that every filesystem failure has that behavior. Only macOS was exercised.

Continue keeping Verus optional. Extracting a production transition core solely
to share the small selection/replay algorithm would add a new boundary and a
storage abstraction without removing the hardest assumptions. That refactor
needs a separately justified design. No additional abstraction or wider adoption
is proposed on the evidence of this round.
