# Security Review Bot

An AI-powered application security review agent that reads a git diff, analyzes it for security risk, and produces structured findings with severity, category, CWE/OWASP metadata, exploit scenarios, remediation guidance, and confidence levels.

This example is based on the `code-review-bot` example, but narrows the agent prompt and tool schema around actionable security review.

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

## What it does

1. Reads a `git diff` against the specified ref (defaults to `HEAD~1`)
2. Sends the diff to a security-focused agent with three custom tools:
   - `get_file_context` - reads full file contents for surrounding security context
   - `add_security_finding` - records a structured security finding with severity, category, exploit scenario, remediation, and confidence
   - `submit_security_review` - a completion tool that ends the run with a summary, overall risk rating, and merge-blocking decision
3. Prints findings grouped by severity (`critical`, `high`, `medium`, `low`, `info`)

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

- Reusing the review-bot pattern for a specialized domain agent
- Multiple `createTool` definitions with zod schemas
- Security-focused structured outputs
- `lifecycle: { completesRun: true }` to make a tool end the agent loop
- Safe repository file reads constrained to the git root
- Event subscription filtered by tool name
- Processing structured results after the run completes

## Notes

This is an AI-assisted review tool, not a replacement for SAST, dependency scanning, secret scanning, manual threat modeling, or human security review. Treat findings as review input and verify them before acting.

For a general-purpose reviewer, see [code-review-bot](../code-review-bot). For a simpler starting point, see [quickstart](../quickstart).
