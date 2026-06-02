# Code Review Bot Dashboard

An AI-powered code review dashboard for real GitHub pull requests. Paste a PR URL, inspect the actual changed files, stream an SDK-powered review over the real PR diff, and copy or optionally post the generated review.

<p align="center">
  <img src="./assets/dashboard.jpg" alt="Code Review Bot dashboard showing a loaded pull request diff" width="100%" />
</p>

## Getting started

Install dependencies:

```bash
bun install
bun run build:sdk
```

Set an API key:

```bash
export CLINE_API_KEY="sk_..."
```

Optionally set a GitHub token. Public PRs can be loaded without one, but a token is recommended for private repositories and higher rate limits:

```bash
export GITHUB_TOKEN="github_pat_..."
```

Run the dashboard:

```bash
bun dev
```

Open http://localhost:3457, paste a GitHub pull request URL, and click **Run Review**.

By default the app copies the generated review to your clipboard. To allow posting a summary comment back to GitHub, run with both `GITHUB_TOKEN` and:

```bash
export ENABLE_GITHUB_REVIEW_POSTING=1
```

## What it does

1. Fetches a real GitHub PR, including metadata, changed files, patches, and check status
2. Renders the PR in a dashboard with file navigation, diff view, review lanes, and finding cards
3. Sends the real PR diff to an agent with three custom tools:
   - `get_file_context` - reads full file contents from the PR head commit for surrounding context
   - `add_review_finding` - records a structured finding with file, line, severity, category, and suggestion
   - `submit_review` - a completion tool that ends the run with a summary and approve/request-changes decision
4. Streams findings to the browser via Server-Sent Events as the agent reviews the PR
5. Copies the final review locally, or posts it as a GitHub PR comment when explicitly enabled

## Concepts demonstrated

- Multiple `createTool` definitions with zod schemas
- `lifecycle: { completesRun: true }` to make a tool end the agent loop
- Rich `systemPrompt` with structured instructions
- Event subscription filtered by tool name
- GitHub REST API integration for pull request metadata and diffs
- Server-Sent Events (SSE) for a live review dashboard
- Guarded external writes through an explicit posting opt-in

## Notes

For a simpler starting point, see [quickstart](../quickstart). For an interactive chat agent, see [cli-agent](../cli-agent).
