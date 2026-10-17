# Design

## Context

The conflict state is defined at read time (`SkillLockEntry::baseline_conflict`) and enforced at four enforcement points: the check pipeline (`commands/settings.rs` target building), the shared batch filter (`CliService::filter_updatable_candidates`), the checked-update prefilter (`commands/skill.rs::checked_update_entries_from_lock`), and the single-update path (`commands/skill.rs::update_skill_inner`). Lock writes go through `SkillLock::update` (in-process mutex, pure-memory closure — no IO allowed inside) and cross-process writer coordination uses `AgentLease`. The content-tree hashing needed for verification is git object hashing over a local directory; the recorded carriers are git tree SHAs, so the verifier must reproduce that exact convention (blob/tree SHA-1 object format, git tree sort, symlink mode `120000`, `100755`/`100644` by exec bit) — the same convention the update path already consumes from GitHub tree responses.

Field data (see proposal): on a real machine, 7 of 8 reachable conflicted entries had local content byte-matching exactly one carrier; 1 entry (`openspec-onboard`) matched the *older* carrier, correctly exposing that its content was behind the remote tip. Both directions must be handled — alignment targets the local measurement, never "the newer value".

## Goals / Non-Goals

**Goals:**
- Conflicted entries whose local content provably matches one recorded carrier stop blocking updates, on every path, with no user action.
- The lock file converges: carriers end up equal to a value that was already recorded in the entry (a measured fact, not an invented one).
- Unverifiable conflicts (missing directory, content matches neither carrier) keep today's conservative refusal.
- Idempotency: an aligned entry is an ordinary unconflicted entry — repeated checks make no further write.

**Non-Goals:**
- No UI for manual conflict arbitration beyond today's reinstall guidance.
- No GC of stale (directory-less) lock entries.
- No CLI-side repair: the CLI's conformance boundary (scan → archive → restore preserving lock bytes) stays untouched.
- No change to lock v3 field shapes, the carrier read order for non-conflicted entries, or C2 provenance gating.

## Decisions

### D1: Lazy verified alignment at every evaluation point — not a startup migration, not update-only

Alternatives considered:
- **One-time startup migration** (aligned entries healed at first launch): heals entries the user never touches, but needs a migration-completion marker, sweeps every conflicted entry (directory hashing) at startup, and re-introduces an "app acted on user data silently" moment. Rejected: the conflict only *manifests* in check/update flows, so healing at those flows covers 100% of the visible problem at a fraction of the mechanism.
- **Update-only proceed** (don't align during checks, just allow the update): simplest, but leaves the lock file permanently ambiguous for up-to-date entries (every future check re-litigates the conflict) and the single-update error users already hit ("请求无效：… Baseline records disagree") would persist unless a check runs first. Rejected for that reason.

Chosen: a single shared resolver invoked wherever a conflict state is *evaluated* (check target building, batch filter, checked prefilter, single update). It computes the local content tree SHA; if it equals exactly one carrier, it aligns both carrier fields under `SkillLock::update` (with `AgentLease` held) and the entry proceeds as unconflicted. The in-memory entry is treated as aligned only after the write succeeds; a failed lease or write leaves the conflict state for the next evaluation to retry. Idempotent; no migration marker; the file converges the first time each entry is touched.

### D2: The alignment write is protocol-legitimate because it records a measured fact

The "checks never write baselines" rule exists because a network-time snapshot cannot prove what is installed and would silently rebase entries another writer changed. Verified alignment satisfies the spirit: the only value ever written is already recorded in the entry AND byte-verified against local content. The spec delta amends the rule with exactly this exception and forbids everything else (remote-tip writes, guesses). The user-decision requirement is satisfied by evidence: there is no decision left to make once local content matches exactly one recorded baseline.

### D3: TOCTOU window accepted, same trust model as install

The tree hash is computed on disk, then the alignment is written — an external writer could change content in between (the same class of window C2 accepts before final replacement, which it mitigates rather than eliminates). The worst case is an alignment whose verified value described the content a moment before an external write; afterwards the entry is an ordinary trusted entry whose baseline is a point-in-time fact — the same model as install-recorded baselines, which are likewise never re-verified against content by checks. Content changed *during* an update operation is protected by C2's snapshot barrier; an update replacing content is the user's explicit action. We do not attempt a directory-plus-lock transaction; that design was explicitly rejected in C2 ("not cross-tool CAS").

### D4: Verification is provenance-blind

C2's Tracking/Unreadable classification gates *updates* (network authorization). Alignment is pure local bookkeeping between recorded SHAs and observed bytes; hashing does not parse YAML. Gate-free keeps the rule simple and cannot leak remote data into the lock. (If content was gh-injected, C2 still refuses the actual update on its own.)

### D5: Content-tree helper lives beside the carrier logic

The SHA computation is shared by all four evaluation points → one function next to the carrier read logic in `services/lock.rs` (or its own small module), operating on a directory path, returning `Result<String>`. Evaluation points only gain: "if conflicted → resolve or keep". This is a local repair to the existing architecture (one helper + four call sites), not a refactor.

### D6: Check-path write must hold the agent lease

`check_skill_updates` currently never writes the lock; the alignment write is its first. It MUST acquire `AgentLease` around the alignment (same pattern as update flows) so a concurrently running CLI writer isn't racing a desktop lock mutation.

## Risks / Trade-offs

- [Verified alignment "writes during a check" weakens E1's headline guarantee] → The delta amends the requirement with a narrow, falsifiable exception (only an already-recorded, byte-verified value); Rust tests assert an unverifiable entry is untouched and repeated checks make no further write, and the fixture suite gains a legacy-conflict case for the resolution matrix and alignment write.
- [A wrong tree-hash convention (mode bits, sort order, symlink handling) would "verify" against the wrong content] → Property test comparing the helper's output against real `git` object hashing on representative directories (nested dirs, exec-bit file, symlink, unicode names); plus the live-machine oracle: the helper must reproduce `83b5a650…` for the actual `openspec-explore` directory shape recorded in the field evidence.
- [Users who expect the conflict warning as a signal something is wrong] → Aligned entries behave exactly like any installed skill (up-to-date or update offered); unresolvable ones keep the loud conflict state. No diagnostic is removed.
- [Batch paths with many conflicted entries add hashing cost] → Only conflicted entries are hashed (rare, local IO, tiny directories); no change to the common path.

## Migration Plan

No data migration and no release marker: behavior activates with the new binary. Existing conflicted entries heal lazily on first check/update touch; entries never touched keep their state but are invisible to the check UI only as conflicts (they surface the moment the user interacts). Rollback = revert the binary; aligned entries are left with equal carriers, which every reader (old app, `npx skill`, `gh skill`) treats as the normal state — rollback is lossless.

## Open Questions

(none — the form-1/form-2 question from the proposal discussion is resolved by D1: lazy verified alignment needs no startup migration and no new UI; the explicit-confirmation variant remains available as a follow-up if field feedback wants a visible "repaired" signal.)
