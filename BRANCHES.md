# Branch map

- `main` is the canonical development line. CI runs on every push and pull request. The last release is `v0.3.58`.
- `next/own-protocol` was fast-forwarded back into `main` and no longer exists as a separate branch.
- `next/curated` (the 0.3.56 compatibility experiment) was removed; its surviving tags are `v0.3.56-beta.2` and `v0.3.56-beta.3`. Reference only; do not release or base new work on it.
- `next/verified-baselines` (remote only) is the frozen 0.3.56 prerelease experiment. Reference only.
- Other branches are reference only unless a human promotes one.
