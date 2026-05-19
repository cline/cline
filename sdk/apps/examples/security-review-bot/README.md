# Security Review Bot on git diffs

An AI-powered application security review agent that reads a git diff, analyzes it for security risk, and produces structured findings with severity, category, CWE/OWASP metadata, exploit scenarios, remediation guidance, and confidence levels.

This example is based on the `code-review-bot` example, but uses the `ClineCore` runtime instead of the lightweight `Agent` runtime. That means it can use ClineCore's built-in workspace tools, including `read_files` and `search_codebase`, while still adding custom security review tools through `extraTools`.

## Getting started

Install dependencies:

```bash
bun install
bun run build:sdk
```

Set an API key:

```bash
export CLINE_API_KEY="cline_..."
```

Security review the last commit:

```bash
bun dev
```

Security review against a specific ref:

```bash
bun dev main
bun dev HEAD~5
bun dev abc123
```

Add run-specific review instructions with `--prompt` or `-p`:

```bash
bun dev main --prompt "Focus on authorization bypasses and SSRF"
bun dev HEAD~1 -p "Treat test-only secrets as low severity"
```

You can also pass extra positional text after the ref; it will be appended as additional review instructions:

```bash
bun dev main "Prioritize auth, secrets, and unsafe file access"
```

## Review a specific repo

The bot reviews the git repository in the current working directory. To review a different repo, run the example command from that repo's directory and pass the ref you want to compare against.

Using Bun directly from another repo:

```bash
cd /path/to/repo-you-want-to-review
bun --cwd /path/to/cline/sdk/apps/examples/security-review-bot dev main
```

With extra instructions:

```bash
cd /path/to/repo-you-want-to-review
bun --cwd /path/to/cline/sdk/apps/examples/security-review-bot dev main --prompt "Focus on payment and admin flows"
```

Or build the example once and run the compiled JavaScript from any git repo:

```bash
cd /path/to/cline/sdk/apps/examples/security-review-bot
bun run build

cd /path/to/repo-you-want-to-review
node /path/to/cline/sdk/apps/examples/security-review-bot/dist/index.js main
```

The argument is passed to `git diff <ref>` in the target repo. Common examples:

```bash
# Review all changes on your branch compared with main
bun --cwd /path/to/cline/sdk/apps/examples/security-review-bot dev main

# Review the last commit
bun --cwd /path/to/cline/sdk/apps/examples/security-review-bot dev HEAD~1

# Review changes since a release tag
bun --cwd /path/to/cline/sdk/apps/examples/security-review-bot dev v1.2.3
```

If you want to review uncommitted changes in a target repo, compare against the branch or commit you started from, for example:

```bash
cd /path/to/repo-you-want-to-review
bun --cwd /path/to/cline/sdk/apps/examples/security-review-bot dev main
```

## What it does

1. Reads a `git diff` against the specified ref (defaults to `HEAD~1`)
2. Starts a local `ClineCore` session with built-in tools enabled
3. Lets the model use ClineCore's `read_files` and `search_codebase` tools for surrounding file context
4. Adds two custom security review tools through `extraTools`:
   - `add_security_finding` - records a structured security finding with severity, category, exploit scenario, remediation, and confidence
   - `submit_security_review` - a completion tool that ends the run with a summary, overall risk rating, and merge-blocking decision
5. Prints findings grouped by severity (`critical`, `high`, `medium`, `low`, `info`)

## Finding schema

Each finding includes:

- `file` and `line` - where the issue appears
- `severity` - `critical`, `high`, `medium`, `low`, or `info`
- `category` - security category such as `injection`, `authorization`, `secrets`, `ssrf`, `xss`, or `cryptography`
- `cwe` and `owasp` - optional vulnerability taxonomy metadata
- `title` and `description` - concise summary and risk explanation
- `exploitScenario` - realistic abuse case
- `remediation` - concrete fix or mitigation
- `confidence` - `high`, `medium`, or `low`

## Concepts demonstrated

- Using `ClineCore.create()` and `cline.start()` for a local runtime session
- Enabling selected ClineCore built-in tools, including `read_files` and `search_codebase`
- Adding domain-specific custom tools with `extraTools`
- `lifecycle: { completesRun: true }` to make a tool end the agent loop
- Subscribing to `CoreSessionEvent` events with `cline.subscribe()`
- Rendering parsed `agent_event` text/tool events instead of printing serialized `chunk` payloads
- Cleaning up runtime resources with `cline.dispose()`
- Processing structured results after the run completes

## Notes

This is an AI-assisted review tool, not a replacement for SAST, dependency scanning, secret scanning, manual threat modeling, or human security review. Treat findings as review input and verify them before acting.

For a general-purpose reviewer, see [code-review-bot](../code-review-bot). For a simpler starting point, see [quickstart](../quickstart).
