# AI SDK Cline Harness TUI

A minimal terminal UI for the Cline harness adapter, built with the AI SDK's
`@ai-sdk/tui` package.

## Getting started

Install dependencies from the repository root:

```bash
bun install
```

Set a Cline API key, then run the example:

```bash
export CLINE_API_KEY="cline_..."
bun --cwd apps/examples/ai-sdk-harness-tui dev
```

Authentication uses the Cline adapter's `auto` mode. If
`AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` contains AI Gateway credentials,
the adapter uses AI Gateway; otherwise it falls back to `CLINE_API_KEY`.

On the first run, Vercel Sandbox prints a device authorization URL. Press
Return to open it, authorize the device in your browser, and return to the
terminal. The Vercel CLI is not required.

In an unattended environment, provide `VERCEL_OIDC_TOKEN` instead of using the
interactive device flow. See [Vercel OIDC](https://vercel.com/docs/oidc).

## Configuration

Runtime settings live in [`src/config.ts`](./src/config.ts) and are controlled
with environment variables:

| Variable | Values | Default |
| --- | --- | --- |
| `CLINE_HARNESS_AUTH` | `auto`, `direct`, `ai-gateway` | `auto` |
| `CLINE_PROVIDER_ID` | Cline provider ID | Cline default |
| `CLINE_MODEL_ID` | Provider model ID | Provider default |
| `CLINE_REASONING_EFFORT` | `none` through `max` | `medium` |
| `CLINE_MAX_ITERATIONS` | Positive integer | Unlimited |
| `CLINE_PERMISSION_MODE` | `allow-reads`, `allow-edits`, `allow-all` | `allow-reads` |
| `CLINE_TUI_TITLE` | Any string | `Cline AI SDK Harness` |
| `CLINE_TUI_TOOLS` | `full`, `collapsed`, `auto-collapsed`, `hidden` | `auto-collapsed` |
| `CLINE_TUI_REASONING` | Same display modes | `collapsed` |
| `CLINE_TUI_STATISTICS` | `outputTokenCount`, `outputTokensPerSecond` | `outputTokensPerSecond` |
| `CLINE_CONTEXT_SIZE` | Positive integer | Hidden |
| `HARNESS_DEBUG` | `1` to enable | Disabled |

For example:

```bash
CLINE_MODEL_ID="anthropic/claude-sonnet-4.6" \
CLINE_TUI_REASONING=auto-collapsed \
CLINE_PERMISSION_MODE=allow-edits \
bun --cwd apps/examples/ai-sdk-harness-tui dev
```

## Extensions

Code-level capabilities live in [`src/extensions.ts`](./src/extensions.ts):

- `tools` adds host-executed AI SDK tools and can override built-in tools.
- `skills` adds reusable instructions available to the harness.
- `instructions` customizes the agent's baseline behavior.
- `mcpServers` registers native Cline MCP servers.
- `onSession` prepares each sandbox with files or configuration.

For a larger application, keep each tool, skill, and MCP integration in its own
module and compose those exports in `extensions.ts`. This keeps the reusable
terminal shell independent from the capabilities of any one specialized agent.

## What it does

- Creates a Cline harness with automatic authentication selection
- Starts an isolated Node.js 24 Vercel Sandbox session
- Binds that session to the AI SDK's terminal UI
- Shows tool calls and reasoning in collapsed sections
- Destroys the sandbox when the UI exits, including after an error

## References

- [Cline harness adapter](https://ai-sdk.dev/providers/ai-sdk-harnesses/cline)
- [AI SDK terminal UI](https://ai-sdk.dev/docs/ai-sdk-harnesses/terminal-ui)
