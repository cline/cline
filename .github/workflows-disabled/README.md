# Disabled workflows (martinfr-certifyos/cline fork)

GitHub Actions only picks up `*.yml` files directly under `.github/workflows/`,
so anything moved here is effectively disabled without losing the file contents.

These workflows were moved out of the active workflows directory because they
either require secrets we don't have, publish artifacts we don't own, or trigger
external repository runs that aren't relevant to this fork.

## Why each one is disabled

| Workflow | Reason |
| --- | --- |
| `cline-evals-regression.yml` | Calls Anthropic via `CLINE_API_KEY` (Cline-hosted backend). Not available in fork. |
| `e2e.yml` | Playwright across Ubuntu / Windows / macOS runners. Expensive runner minutes; not needed for the targeted enhancement work. |
| `npm-main.yaml` | NPM publish via OIDC trust we don't have. |
| `npm-nightly.yaml` | Nightly NPM publish (scheduled). |
| `publish.yml` | VS Code Marketplace publish. |
| `publish-nightly.yml` | Nightly Marketplace publish. |
| `publish-nightly-sdk.yml` | SDK publish. |
| `publish-cli-trusted.yaml` | Scheduled CLI publish. |
| `pack-cli.yml` | Builds/publishes CLI tarballs as GitHub Releases. |
| `trigger-jetbrains-tests.yml` | `pull_request_target` triggers external JetBrains repo CI. Security-sensitive. |
| `label-jetbrains-issues.yml` | Auto-labels issues — fork has no issues. |
| `stale.yml` | Closes inactive issues — fork has no issues. |
| `test-stale.yml` | Test variant of stale workflow. |

## Re-enabling

To re-enable any of these workflows, move them back to `.github/workflows/` and
add the required secrets to the fork's repository settings.

## Active workflows

- `test.yml` — Quality checks + unit/integration/CLI tests (self-contained).
  Qlty coverage upload job is gated by the repo variable `QLTY_ENABLED` so it
  only runs when explicitly opted in.
- `cli-tui-tests.yml` — CLI TUI tests (self-contained).
