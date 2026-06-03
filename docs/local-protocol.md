# Skill Zoo Local Protocol

Skill Zoo desktop owns the local protocol. The CLI is an adjunct control surface: it may read and write desktop-owned local state, but it must follow the desktop app's protocol rather than define a separate one.

## Versioned Files

| File | Current Version | Role |
| --- | ---: | --- |
| `~/.agents/.skill-lock.json` | 3 | Desktop-owned install metadata for skills managed through Skill Zoo-compatible flows. |
| `~/.skill-zoo/archive/manifest.json` | 1 | Desktop-owned manifest for archived skills and restore metadata. |

`~/.skill-zoo/metadata.json` and `~/.skill-zoo/skills-cache.json` support desktop and CLI behavior, but they are not first-class versioned protocol files in this iteration. The cache is derived state and should not drive compatibility policy.

## Compatibility Rules

- Desktop is the source of truth for local protocol shape and semantics.
- CLI changes must conform to the desktop-owned protocol and must not update fixtures to fit CLI implementation convenience.
- Readers should tolerate missing optional fields.
- CLI writers must refuse versioned files with schema versions newer than they support. Desktop future-version write protection is not enforced in this iteration.
- Adding optional fields usually does not require a schema version bump.
- Removing fields, renaming fields, changing required fields, or changing write/read semantics requires a schema version bump or an explicit migration plan.
- Do not rely on byte-for-byte JSON formatting. Compatibility is semantic.

## Fixture Maintenance

Fixtures live in `fixtures/local-protocol/` and represent the desktop app's current protocol.

Update fixtures only when the desktop-owned protocol intentionally changes or when a fixture is proven wrong. If a CLI test fails against these fixtures, fix the CLI first unless the desktop protocol itself changed.

For a new optional field, update the relevant `*-full.json` fixture. Keep `*-minimal.json` minimal unless the field is required. For an incompatible schema change, promote the current future-version fixture into the new current-version fixture and add the next future-version fixture.
