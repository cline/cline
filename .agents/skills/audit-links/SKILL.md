---
name: audit-links
description: Find and fix broken links (404s) in the repo's Markdown/MDX docs, and audit links on a published page such as cline.bot/sdk or docs.cline.bot. Use when the user reports a dead link, asks to check docs for 404s, or wants a link audit before a docs release.
---

# Audit Links

Find every broken link, fix it at the source, and leave the repo passing `link-check` in CI.

The engine is [`sdk/scripts/check-links.ts`](../../../sdk/scripts/check-links.ts). Do not
re-implement link crawling in an ad-hoc script — extend that one so CI and this skill stay
in agreement.

## Run it

```bash
bun sdk/scripts/check-links.ts                      # offline: repo + local paths (fast, hermetic)
bun sdk/scripts/check-links.ts --external           # + HTTP-check every external URL
bun sdk/scripts/check-links.ts --site https://cline.bot/sdk   # + links on a published page
bun sdk/scripts/check-links.ts --external --json report.json  # machine-readable report
```

Exit code is non-zero when anything is broken. The offline pass is what CI blocks on; the
external pass is network-dependent and runs on a schedule.

## What each failure class means

| Class | Report shows | Usual cause |
|---|---|---|
| `repo` | `[404] https://github.com/cline/cline/...` | An absolute GitHub URL kept pointing at a path that moved. Resolved against the working tree, so it is never a flake. |
| `local` | `[missing] ../foo.md` | Relative link written from the wrong directory, or a target that was renamed. |
| `external` | `[404]`, `[ENOTFOUND]` | A third-party page died, or a link to another `cline/*` repo that does not exist. |
| `site` | same, with the page URL as the location | A link on the published page. The repo cannot fix these directly — see below. |

`401`, `403`, and `429` are reported as reachable: bot walls are not broken links.

## Fixing

Work from the source of the mistake, not the symptom.

1. **Confirm the intended target exists** before rewriting a link. `git ls-tree upstream/main <path>`
   (or `ls`) beats guessing. If the target genuinely does not exist anywhere, the fix is to
   remove the link, not to invent a plausible path.
2. **Check whether the file moved or was deleted.** `git log --all --oneline -- <path>` tells you
   which. A deleted target means the surrounding prose usually needs a small edit too.
3. **Prefer relative links inside the repo**, except in files rendered outside GitHub —
   `apps/vscode/README.marketplace.md` (VS Code Marketplace) and published package READMEs need
   absolute `https://github.com/cline/cline/blob/main/...` URLs.
4. **Watch the workspace root.** `sdk/README.md` resolves relative links from `sdk/`, so a link to
   the repo-root `apps/examples` must be `../apps/examples`. This exact mistake is what put
   `sdk/apps/examples/*` 404s on cline.bot/sdk.
5. **Submodules** (`evals/cline-bench`) are not in the tree and 404 on github.com — link to the
   other repo instead.
6. Re-run the checker until clean, then run `bun run format` if you touched the script.

## Fixing links on a published page

`--site` audits a rendered page, but a broken link there is usually *authored elsewhere*:

- Search the repo for the bad path first. Marketing and docs copy is frequently lifted from a
  README, so the same wrong path exists in-repo and fixing it there is the real fix.
- If the page is served from a source this repo does not contain (cline.bot marketing pages),
  the repo change is not enough. Report the list — with the correct target for each link — and
  let the user decide whether to open an issue. Do not open issues or PRs unprompted.

## Adding a new exclusion

If a legitimate link is flagged, fix the checker rather than deleting the link:

- Not a real URL (a template, a placeholder) → the `PLACEHOLDER` pattern in `check-links.ts`.
- Not reachable from CI (a dev server, an intranet host) → `SKIP_HOSTS`.
- Inside a generated or vendored tree → `SKIP_DIRS`.

Links inside fenced code blocks and inline code are already ignored, so an example URL in a
snippet needs no exclusion.

## Reporting

Give the user a table of `file:line`, the broken URL, and the corrected target — grouped by
whether the fix lands in this repo or elsewhere. State plainly when a link has no valid target.
