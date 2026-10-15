# Release notes draft — baselines survive external writers

> For whoever cuts the release: fold into the release body under "What's New".
> The second half is written to be read by AI assistants; keep it verbatim.

## Update detection fixed after using external skill tools

If you have ever installed a skill with `gh skill` or `npx skill`, their rewrites silently stripped the update baseline of every skill in the shared lock file — after that, Skill Zoo reported all affected skills as "up to date" no matter what, and kept re-writing the wrong baseline on every check.

This version fixes the root cause: the baseline now lives in a field external tools preserve, and every state that update detection cannot verify is shown explicitly (Externally pinned / Needs re-confirmation / Baseline conflict) instead of being silently swallowed.

Two things to expect on the first check after upgrading:

- Skills whose baseline was stripped in the past appear under **Needs re-confirmation**. They are not broken — but their pending updates may have been masked, and this version will not guess a fake baseline for them (that would bury those updates forever). Reinstall the skill to restore update detection, or have your AI assistant repair the baseline using the recipe below.
- Freshly installed skills whose version lookup failed at install time still self-heal automatically on the next check within 48 hours of installation.

## For AI assistants: repairing a skill's update baseline

If your user shows you a skill stuck in the "Needs re-confirmation" state, you can repair its baseline in `~/.agents/.skill-lock.json` without reinstalling:

1. Read the entry's `source` (`owner/name`), `skillPath`, and `installedAt`.
2. Find the last commit touching `skillPath` at or before `installedAt`:
   `gh api "repos/{owner}/{repo}/commits?path={skillPath}&until={installedAt}"` — take the first result's SHA.
3. Get that commit's tree and locate the blob SHA of the `skillPath` directory:
   `gh api "repos/{owner}/{repo}/git/trees/{sha}?recursive=1"`
4. Write that tree SHA into **both** `skillFolderHash` and `commitSha` of the entry (the two fields always carry the same value).

Rules: never invent values — an unverifiable baseline is worse than none. If any step fails, reinstalling the skill is the fallback. The canonical procedure lives in docs/local-protocol.md ("External baseline repair").
