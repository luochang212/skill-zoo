---
status: implemented
date: 2026-10-23
raised-by: human
decided-by: human
created: 2026-10-23
commit: 52b4213
description: Read before touching agent transaction verification or considering Verus as part of the production build.
paths:
  - src-tauri/src/persistence/agent_transaction.rs
  - src-tauri/src/services/cli.rs
  - docs/local-protocol.md
  - docs/research/verus-transaction/**
---

# ADR: 3 Keep Verus optional and outside production builds

## Problem

Skill Zoo's journal recovery protects user files across partially completed
operations. Verus can prove Rust logic against explicit specifications, but our
critical workflows also depend on filesystem operations, external writers and a
separate TypeScript CLI. A proof of a detached model cannot establish correctness
of those implementations or their storage assumptions.

Two bounded studies demonstrated abstract replay properties and produced useful
production-path failure/retry tests. They found no new production defect. Wider
integration would require a maintained correspondence to runtime code and a
trusted storage boundary before claiming stronger user-facing guarantees.

## Decision

- Keep the small models, reproducible runner and evidence under
  `docs/research/verus-transaction/` as an optional research artifact.
- Keep the real Rust/CLI recovery failure, retry and lease-release tests in their
  normal test suites. These directly exercise production behavior.
- Do not vendor Verus binaries, its source distribution or Rust toolchains. Use
  an independently installed verifier when reproducing the research.
- Add no Verus production dependency, default build step, required CI gate or
  project-wide Rust toolchain override.
- Do not refactor the small production selection/replay logic solely to make it
  Verus-compatible. Revisit adoption when a sufficiently complex, stable shared
  core justifies proof and maintenance costs; specify and review the trusted IO
  boundary before treating a proof as a production guarantee.

This boundary was confirmed by the user after reviewing both studies. ADR
[1](1-own-skill-zoo-local-protocol-borrow-capabilities-not-compatibility.md)
continues to own local protocol semantics and desktop/CLI fixture parity.

## Alternatives considered

- **Require Verus across the backend now.** Declined: IO and async integration
  need additional modeling, while no new production safety gain was demonstrated.
- **Discard all experiment outputs.** Declined: the small optional examples
  preserve reproducible evidence, assumptions and negative checks at modest cost.
- **Call the model proof end-to-end verification.** Declined: the correspondence
  and actual filesystem effects remain unproved.

## Consequences

The application retains its existing build and CI workflow. Real failure/retry
coverage improves without adding a compiler dependency for contributors. The
research remains available for future work and is explicitly labeled model-only.

### Verification

[The study overview](../../docs/research/verus-transaction/README.md) and
[second-round report](../../docs/research/verus-transaction/round2-production-recovery.md)
own commands, pinned verifier details, results and limitations. The retained
runner rejects deliberate implementation errors; the production-path tests
exercise both runtimes using shared protocol fixtures. No runtime implementation
or schema change was needed for the studies.

### Trade-offs

Optional models can drift from production, so their assumptions and correspondence
need review before reuse. Verus/vstd/rustc/solver trust and actual IO behavior
remain outside the guarantees established here. Tests and abstract proofs do not
establish physical power-loss correctness or close the hash-to-rename interval.
