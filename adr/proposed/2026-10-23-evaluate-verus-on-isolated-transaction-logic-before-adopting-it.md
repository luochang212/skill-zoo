---
status: proposed
date: 2026-10-23
created: 2026-10-23
tags: [verification, rust, reliability]
paths: [src-tauri/src/persistence/agent_transaction.rs, src-tauri/src/services/cli.rs, docs/local-protocol.md, docs/research/verus-transaction/**]
---

# ADR: Evaluate Verus on isolated transaction logic before adopting it

## Problem

Skill Zoo protects user files through update preflight, directory replacement,
rollback and journal recovery. Recent review found that a clean preflight did
not protect edits saved during download. Such failures motivate stronger
reasoning about operation order and preserved state.

Verus checks Rust implementations against explicit specifications using theorem
proving. It could strengthen selected invariants, but our critical workflows
also involve filesystem behavior, asynchronous work, external editors and a
TypeScript UI. Proving a poorly specified rule would preserve the original bug:
"clean at preflight permits overwrite" omits edits made during preparation.

## Proposal

Keep Verus out of the main build and required CI gates for now. Continue using
regression tests, fault injection and platform-specific filesystem checks.

When transaction behavior is sufficiently stable, evaluate one isolated Rust
state machine, preferably journal commit/recovery in
`src-tauri/src/persistence/agent_transaction.rs`. Scope the trial to explicit
properties such as recovering the before-state for an uncommitted transaction
and the after-state for a committed transaction, under documented storage
assumptions. Prefer checking production transition logic; clearly identify any
model-only proof and how its transitions correspond to runtime code.

Keep the experiment optional and isolated from shipping dependencies. Assess
the additional guarantee against specification, proof, toolchain and maintenance
cost before proposing wider adoption. Production integration remains a separate
decision from an isolated feasibility study.

ADR [1](../implemented/1-own-skill-zoo-local-protocol-borrow-capabilities-not-compatibility.md)
remains authoritative: a verification experiment must preserve desktop-owned
protocol semantics and the shared CLI/Rust fixture contract.

## Alternatives considered

- **Adopt across the backend immediately.** Deferred: too much adaptation and
  proof surface before demonstrating value; external effects still need models.
- **Use tests alone indefinitely.** Lower initial cost, but leaves open whether
  a small stable transaction core could gain worthwhile additional guarantees.
- **Prove a detached model and call the workflow verified.** Insufficient:
  production behavior and storage assumptions can diverge from the model.

## Acceptance criteria

- A bounded trial has reproducible verification commands, explicit invariants,
  documented assumptions and a clear account of verified versus trusted code.
- Deliberately violating a claimed invariant makes verification fail; proofs
  are reviewed for weakened specifications or unchecked assumptions.
- Existing production-path tests remain, and their relationship to the proof
  is documented. A model proof alone does not establish disk/crash correctness.
- An outcome report weighs benefits and maintenance cost and recommends
  adoption, continued isolation or rejection; rollout is a separate decision.

## Risks

The support table reviewed on 2026-10-23 lists async/await and direct I/O as
unsupported; reassess support before a trial. Wrappers and assumed
specifications move behavior into the trusted boundary rather than prove it.
Proof maintenance may exceed the value of verifying small decision functions.
An external editor also remains outside the app's lease; a transition proof
must not imply atomicity between a filesystem hash and rename.

Sources: [Verus](https://github.com/verus-lang/verus),
[supported features](https://verus-lang.github.io/verus/guide/features.html),
[trusted assumptions](https://verus-lang.github.io/verus/guide/tcb.html).
The initial evaluation read source and documentation; the subsequent study below
ran the official Verus release.

## Research outcome (2026-10-23)

The user subsequently requested research under this proposal. The
[isolated recovery study](../../docs/research/verus-transaction/README.md)
verified a model (6 verification units, 0 errors); four deliberate implementation
mutations each failed verification. Seven existing production-path transaction
tests passed. The report records commands, measurements, storage assumptions and
the manual mapping to runtime code.

Recommend continued isolation: production recovery itself and the filesystem
remain unverified. The model added a quantified replay argument but exposed no
new production defect, while wider adoption would require maintenance of a
production/model correspondence and trusted storage boundary. This remains a
proposal; the research does not establish production adoption or change ADR 1.
