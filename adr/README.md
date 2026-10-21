# Architecture Decision Records

This directory is the repository's memory against two agent failure modes:
drifting from long-term decisions while deep in a task, and forgetting settled
choices until they resurface as inconsistencies.

Records follow the lifecycle folders proposed/, implemented/, rejected/, and
archived/. The folders are a context budget as well as a lifecycle:
implemented/ is current authority and is read in full; proposed/ is intent and
is checked; rejected/ is anti-pattern memory and is checked;
archived/ is lowest-value frozen history and is not read by default. The four
folders are the whole record inventory: no other folder may sit under adr/ or
inside one of them, and a Markdown record at the adr/ root fails validation
rather than disappearing from the list command.

A proposal is unshipped even when its direction has been settled. Implemented
records describe shipped decisions and receive stable ADR numbers. A rejection
is a durable terminal record of a declined proposal: it is removed only when
another record owns the warning it blocks, never for appearing stale —
rejections are unnumbered, so removing a redundant one cannot reuse a number.
Archived records are frozen history, not current authority. They are ordinary
Git-tracked records: adrkit validate checks them like the rest of the
inventory, and Git history shows any later change.

Never delete a numbered decision: its stable N may be referenced elsewhere.
Implemented records may refresh factual paths, symbols, and defaults, but a
changed choice needs a new record. Archive or supersede rather than erase it.

The canonical header includes status, date, and created: YYYY-MM-DD (the
birth date, never re-stamped). Numbered records declare raised-by: human | agent
and decided-by: human | agent; these are provenance declarations, not proof
of approval. Optional tags: [frontend] classify records by theme; optional
paths: [src/payments/**] scope a record to the files it governs.

Use adrkit propose for unshipped work, adrkit implement after it ships, and
adrkit record for an already-shipped decision. Use adrkit reject with a reason
for a proposal that will not ship. A full replacement archives the old
implemented record through adrkit supersede; adrkit archive also retires
implemented guidance whose rationale is no longer needed in the active set.

Run adrkit list to discover records. Read the relevant implemented/ records in
full, check the relevant proposed/ records for intent and the rejected/ records
for the bad cases they warn against, and consult archived/ only when a task
cites history. Do not decide relevance by title alone; when a task targets
specific files, adrkit relevant <path> retrieves the records scoped to them.
For actual changes, use adrkit relevant --base <review-base> or --staged.
Supplement scope matches with inventory reading for unscoped decisions and
resolve incomplete-search diagnostics; no match does not mean no constraints.
Run adrkit validate to check the repository.
