---
status: implemented
date: 2026-10-31
description: Read before translating anything in src/i18n or touching the Local sidebar's repos group; one label is deliberately English in every UI language.
raised-by: human
decided-by: human
created: 2026-10-31
commit: 596f5c8
paths:
  - src/i18n/zh.json
  - src/i18n/en.json
  - src/components/skills/SkillSidebar.tsx
---

# ADR: 5 Keep the repos group unassigned label in English in Chinese UI

## Problem

Localization has one rule: user-visible copy follows the UI language, `zh.json`
mirrors `en.json` key for key, and a missing Chinese value falls back to
English (`fallbackLng: "en"` in `src/i18n/index.ts`). Applied uniformly, the
rule produces a wrong result in exactly one place.

The Local page sidebar's repos group lists GitHub repository identities:
`owner/name` strings that are user data, rendered as GitHub spells them and
never translated. The group's last row is not a repository but the sentinel for
skills installed outside any repo (`category` type `unassigned`). Its visible
siblings are English identifiers, so a translated `未分类` sits in a column of
English data: the CJK glyphs break the column's scan pattern and make the row
read as UI chrome rather than a member of that list. The list has one axis of
comparison and the label breaks it.

Agents keep treating the value as an unfinished translation and finishing it.
The latest instance shipped as `"unassigned": "未分类"` in `8d147f8` ("localize
feedback"); the maintainer has had to revert this class of change by hand.
Nothing in the code says the English value is intentional, so each audit,
reading only the file, reaches the same wrong conclusion.

## Decision

- `sidebar.unassigned` renders `Unassigned` in every UI language. English is
  the correct value here, not a missing one.
- `zh.json` keeps an explicit key whose value equals the English one instead of
  dropping the key: a missing entry is indistinguishable from an oversight and
  invites exactly the translation this record forbids, while an identical
  explicit value keeps the bundle a complete mirror so key-parity checks stay
  meaningful.
- The exception is scoped by the row's company, not its content: a label whose
  visible neighbours are repository identities stays English. It licenses
  English nowhere else. The 仓库 header itself, counts, empty states, tooltips,
  and every other string follow the UI language. A new row placed inside that
  repo list inherits the same test; a label for the list gets translated.
- This is the app's only intentional exception. A second one needs its own
  record rather than a widened reading of this rule.

## Alternatives considered

- **Translate it — treat the rule as absolute.** Rejected: this is the state
  that keeps coming back. The rule exists so users understand the UI, and a
  Chinese word inside a column of English identifiers is the one place where
  obeying it reduces understanding. It has been reverted on every sighting.
- **Drop the `zh` key and let `fallbackLng` render English.** Rejected: the
  file then carries no signal that the absence is deliberate. Intent would live
  only outside the code, and an auditor comparing key sets would see a hole.
- **Hardcode `Unassigned` in `SkillSidebar` and stop calling `t()`.** Rejected:
  it hides intentional copy from the translation layer, where it is at least
  visible beside its siblings, and replaces a documented exception with a
  silent special case in JSX.
- **Localize the repo identities too, e.g. `未分配仓库`, so the group is
  uniformly Chinese.** Rejected: `owner/name` comes from GitHub. Rewriting user
  data to match the UI language is a worse error than leaving one label in
  English, and it would break the correspondence between the sidebar and the
  repository pages.

## Consequences

The Chinese UI carries one English row, and that is the intended reading: the
group is a list of repository identifiers, one of which says "no repository".
The cost is that any future key-parity or untranslated-value audit will flag
`sidebar.unassigned` as suspicious. This record is the answer to that flag;
fixing the string is the bug. Keeping an explicit value keeps the flag loud and
reviewable instead of leaving an invisible hole.

### Verification

`src/i18n/zh.json` holds `"unassigned": "Unassigned"`, and
`src/components/skills/SkillSidebar.tsx` renders it through the single
`t("sidebar.unassigned")` call site at the end of the repos list.
`adrkit validate --all` passes. The wrong state this record replaces is
`8d147f8`.
