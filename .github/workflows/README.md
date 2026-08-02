# Workflow security rules

Cline is a public repository: anyone can open a pull request, and a pull request
is code that our runners execute. These are the invariants that keep that safe.
`repo-workflow-lint` enforces most of them automatically via actionlint and
zizmor, but the linter cannot reason about intent, so read this before adding or
editing a workflow.

## Never run pull request code with a write token

`pull_request` is the safe trigger for anything that builds or tests a
contribution. GitHub withholds secrets from fork pull requests and issues a
read-only token, so an attacker who lands a malicious build script gets nothing.

`pull_request_target` is the dangerous one: it runs in the context of the base
repository, with real secrets and a write-capable token, on a payload the pull
request author controls. Two workflows use it (`repo-strip-agent-badges`,
`ext-jb-test-integration`) and both are safe for exactly one reason — **neither
checks out anything**. They call the REST API and treat every attacker-supplied
string as data. Adding a `checkout`, an install, or a build step to a
`pull_request_target` job hands the repository to whoever opens the next pull
request. If such a job needs to see the contributor's code, split the work: run
the untrusted half under `pull_request` and pass results across as artifacts.

## Pin every action to a commit SHA

`uses: some/action@v4` trusts whoever controls that tag to not repoint it at new
code. That is how `tj-actions/changed-files` leaked secrets out of thousands of
repositories in 2025 — no victim repository was modified. Use the full 40-character
commit SHA with the version as a trailing comment:

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
```

Dependabot rewrites both the SHA and the comment, so pinning does not mean
running stale actions.

## Pass untrusted values through `env`, never inline

`${{ }}` is substituted into the script text *before* bash parses it, so a value
containing shell metacharacters becomes code rather than a string:

```yaml
# WRONG - a crafted PR title executes here
run: echo "Building ${{ github.event.pull_request.title }}"

# RIGHT - the value arrives as data
env:
    TITLE: ${{ github.event.pull_request.title }}
run: echo "Building $TITLE"
```

This applies to more than the obvious fields. Branch names reach us through
`github.head_ref` and `github.ref`, and git permits `$`, `(`, `)`, and backticks
in them. Workflow dispatch inputs are typed by whoever dispatches. Anything that
originated outside the workflow file goes through `env`.

When writing such a value to `$GITHUB_OUTPUT`, strip CR/LF first — a newline lets
the author append extra `key=value` lines and forge the step's other outputs.

## Grant the smallest token, at the job level

Declare `permissions` on the workflow (`{}` or `contents: read`) and widen only
the individual job that needs more. A workflow-level `contents: write` is
inherited by every job, including the ones that install dependencies and run
tests from a contributor's branch.

Add `persist-credentials: false` to any checkout in a job that does not push.
Otherwise `actions/checkout` leaves the job token in `.git/config`, where any
script the job later runs can read it.

## Put release secrets behind an environment

Branch protection does not protect a `workflow_dispatch` run: it executes
whatever copy of the workflow exists on the ref it was dispatched from, so any
`if:` guard inside the file can be deleted by the person dispatching it. A
deployment environment is the only gate that survives, because it is enforced by
repository settings rather than by the file.

Signing keys, registry tokens, and anything else that can ship code to users
belong in a job with `environment:` set, and the environment itself should be
restricted to `main` with required reviewers. The secret should also be scoped to
that environment rather than to the repository, so it is not merely gated in one
workflow but unreadable from every other one.
