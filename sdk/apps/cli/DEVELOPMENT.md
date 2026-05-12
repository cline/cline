# CLI Development Guide

This guide covers everything you need to build and run the Cline CLI locally after cloning the repository. It includes setup instructions, a tech stack overview, and a walkthrough of the TUI architecture.

For CLI command reference and usage, see [DOC.md](./DOC.md) and [README.md](./README.md).

## Prerequisites

Install these before starting:

1. [Bun](https://bun.sh) (v1.0.0+) - Package manager, runtime, and bundler
2. [Zig](https://ziglang.org/download/) - Required by OpenTUI's native core. The `@opentui/core` package includes a Zig-compiled native binary that builds from source on install. Without Zig, `bun install` will fail for OpenTUI packages.
3. Node.js 22+ - Required for some build tooling and test infrastructure

Verify your setup:

```bash
bun --version    # should be >= 1.0.0
zig version      # any recent stable release
node --version   # should be >= 22
```

## First-Time Setup

From the repository root:

```bash
# Install all workspace dependencies (including native OpenTUI build)
bun install

# Build the SDK packages and CLI
bun run build

# Run the CLI in dev mode (interactive)
bun run cli
```

That last command is a shortcut for `cd apps/cli && bun run dev`, which runs:

```bash
CLINE_BUILD_ENV=development bun --conditions=development ./src/index.ts
```

### Linking for Global Access

To use the CLI from anywhere on your system, first build the SDK packages, then link:

```bash
# From the repo root -- build all workspace packages
bun run build:sdk

# Then link the CLI binary
cd apps/cli
bun link
```

The `build:sdk` step is required because `bun link` runs without the `--conditions=development` flag, so Bun resolves workspace packages (`@cline/llms`, `@cline/core`, etc.) via their `package.json` exports which point to `dist/`. Without the build, those dist files don't exist and you'll get "Cannot find module" errors.

After linking, you can run `cline` from any directory:

```bash
cline              # interactive mode
cline "prompt"     # single-prompt mode
cline auth         # authenticate a provider
```

If you prefer to skip the build step, use `bun run dev` from `apps/cli/` instead -- it passes `--conditions=development` which resolves packages directly from source.

### Rebuilding After SDK Changes

If you modify any package in `packages/` (shared, llms, agents, core, etc.), rebuild the SDK:

```bash
bun run build:sdk
```

If you're using `bun run dev`, you don't need to rebuild after every SDK change -- dev mode resolves packages from source. But if you're using the linked `cline` binary, you do need to rebuild for changes to take effect.

## Monorepo Structure

```
cline-sdk/
  packages/           # SDK packages (published to npm)
    shared/           # Contracts, schemas, path helpers, runtime utilities
    llms/             # Provider settings, model catalogs, AI SDK handlers
    agents/           # Stateless agent loop, tool orchestration, hooks
    scheduler/        # Scheduled execution, concurrency control
    core/             # Stateful orchestration, sessions, hub, storage, config
    enterprise/       # Internal enterprise integrations (not published)
  apps/
    cli/              # This package - CLI host and TUI
    code/             # Tauri + Next.js desktop app
    vscode/           # VS Code extension
    desktop/          # Desktop application
    examples/         # Sample integrations
  biome.json          # Linter and formatter config (Biome)
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Bun | Package management, script execution, bundling |
| Language | TypeScript (strict) | All source code |
| CLI Framework | Commander.js | Argument parsing, subcommands |
| TUI Renderer | OpenTUI (`@opentui/core`) | Native terminal rendering engine (Zig + C ABI) |
| TUI Components | OpenTUI React (`@opentui/react`) | React 19 reconciler for declarative terminal UI |
| TUI Dialogs | `@opentui-ui/dialog` | Modal dialog system (model picker, tool approval, etc.) |
| Linter/Formatter | Biome | Code quality and formatting |
| Testing | Vitest | Unit and E2E tests |
| Logging | Pino | Runtime file logging |

### Why OpenTUI?

OpenTUI is a native terminal UI core written in Zig with TypeScript bindings. Compared to the previous terminal renderer, OpenTUI provides:

- Native diff rendering with syntax highlighting
- Streaming markdown rendering
- Scrollable content areas
- Mouse interaction (click, hover, drag-to-select, scroll)
- Built-in clipboard support (OSC52)
- Higher performance through native rendering

OpenTUI exposes a C ABI from its Zig core. The `@opentui/core` package provides TypeScript bindings, and `@opentui/react` provides a React reconciler so you can write terminal UIs with JSX.

## CLI Source Structure

```
apps/cli/src/
  index.ts              # Entry point (shebang, signal handling)
  main.ts               # CLI command definitions, argument parsing

  runtime/
    run-interactive.ts   # Interactive mode runtime (session lifecycle, event wiring)
    run-agent.ts         # Single-prompt runtime
    session-events.ts    # Event bridge types and pub/sub
    active-runtime.ts    # Abort registry
    tool-policies.ts     # Auto-approve toggle logic
    prompt.ts            # System prompt and user input assembly
    defaults.ts          # Default config values

  tui/                   # Terminal UI (OpenTUI + React)
    index.tsx            # Renderer entry point
    root.tsx             # Provider tree, view routing, global keyboard
    types.ts             # ChatEntry union, TuiProps, shared constants
    interactive-config.ts  # Config data loading
    interactive-welcome.ts # Welcome line, slash command resolution
    components/          # Reusable UI components
    contexts/            # React context providers
    hooks/               # Custom React hooks
    views/               # Full-screen view components
    utils/               # TUI-specific utilities

  session/               # Session state management
  commands/              # CLI subcommands (auth, config, history, etc.)
  connectors/            # Chat adapter bridges (Telegram, Slack, etc.)
  utils/                 # Shared utilities
  wizards/               # Interactive setup flows
  logging/               # Pino logger adapter
```

## TUI Architecture

The TUI lives at `src/tui/` and uses React with OpenTUI's reconciler. Every `.tsx` file in this directory uses a per-file JSX pragma:

```tsx
// @jsxImportSource @opentui/react
```

This tells TypeScript to use OpenTUI's JSX runtime instead of React DOM. The `tsconfig.json` sets `jsxImportSource: "@opentui/react"` globally, but the per-file pragma makes the intent explicit and avoids conflicts with any non-TUI React code.

### Entry Point: `index.tsx`

The TUI boots through `renderOpenTui()`:

```tsx
const renderer = await createCliRenderer({
  exitOnCtrlC: false,    // We handle Ctrl+C ourselves
  autoFocus: false,      // Prevents click-anywhere from stealing focus
  enableMouseMovement: true,
});

const root = createRoot(renderer);
root.render(<Root {...props} />);
```

The renderer returns `destroy()` and `waitUntilExit()` methods. The runtime calls `destroy()` on exit and awaits `waitUntilExit()` for cleanup.

### Runtime Bridge: `run-interactive.ts`

This file is the bridge between the SDK and the TUI. It:

1. Creates a `SessionManager` via `createCliCore()`
2. Sets up event subscriptions (agent events, pending prompts, team events)
3. Passes callbacks to the TUI as props (`onSubmit`, `onAbort`, `onModelChange`, etc.)
4. Manages session lifecycle (start, stop, restart, resume, compact)

The TUI never talks to the SDK directly. All communication flows through the callback props defined in `TuiProps` (see `types.ts`).

### Component Tree

```
Root (root.tsx)
  DialogProvider                    # Modal dialog system
    SessionProvider                 # Chat entries, running state, mode
      EventBridgeProvider           # Subscribes to SDK events
        View Router
          HomeView                  # Welcome screen (before first prompt)
          ChatView                  # Message list + input bar + status
          OnboardingView            # First-run provider setup
          ConfigView (dialog)       # Settings browser
          HistoryView (dialog)      # Session history
```

### Context Providers

Each context owns a slice of state. Components subscribe only to what they need.

`SessionContext` - Core chat state:
- `entries: ChatEntry[]` - All messages in the conversation
- `isRunning` / `abortRequested` - Agent execution state
- `mode` (plan/act), `autoApproveAll`, `hasSubmitted`
- `lastTotalTokens`, `lastTotalCost`, `turnStartTime`

`EventBridgeContext` - SDK event subscription:
- Subscribes to `subscribeToEvents` prop once via useEffect
- Forwards agent events to session context handlers via stable refs
- Handles pending prompts, team events

### Event Flow

```
SDK (AgentLoop)
  --> AgentEvent emitted
  --> subscribeToAgentEvents() fires
  --> UIEventEmitter.emit("agent", event)
  --> EventBridgeProvider receives event
  --> useAgentEventHandlers processes event
  --> SessionContext.entries updated
  --> React re-renders affected components
```

### ChatEntry Type

All messages in the conversation are represented as a discriminated union:

```typescript
type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant_text"; text: string; streaming: boolean }
  | { kind: "reasoning"; text: string; streaming: boolean }
  | { kind: "tool_call"; toolName: string; inputSummary: string; ... }
  | { kind: "error"; text: string }
  | { kind: "status"; text: string }
  | { kind: "team"; text: string }
  | { kind: "user_submitted"; text: string; delivery?: "queue" | "steer" }
  | { kind: "done"; tokens: number; cost: number; elapsed: string; iterations: number }
```

### Dialog System

Dialogs use `@opentui-ui/dialog`. The pattern:

```tsx
import { useDialog } from "@opentui-ui/dialog/react";

const dialog = useDialog();
const result = await dialog.choice<string>({
  style: { maxHeight: termHeight - 2 },
  content: (ctx) => <MyDialogContent {...ctx} />,
});
```

Dialog content components receive `resolve` and `dismiss` callbacks through the context. They use `useDialogKeyboard` for keyboard handling scoped to the dialog.

Important gotcha: async data loading inside a dialog (via useEffect/useState) causes layout gaps between flex children in OpenTUI. Always fetch data before opening the dialog and pass it as props.

### Key Components

`components/input-bar.tsx` - Text input with submit handling:
- Uncontrolled `<textarea>` with `key={inputKey}` for reset
- `ref` callback wires `node.onSubmit` (React reconciler pattern)
- Supports newlines (Shift+Enter) and autocomplete integration

`components/chat-entry.tsx` - Renders a single ChatEntry based on its `kind`:
- Markdown rendering for assistant text (`<markdown>`)
- Diff rendering for file edits (`<diff>`)
- Code highlighting for file reads (`<code>`)
- Spinner for streaming states

`components/status-bar.tsx` - Bottom status display:
- Model name, context bar, token/cost
- Plan/Act mode indicator
- Workspace, branch, auto-approve state

`components/tool-output.tsx` - Rich tool result rendering:
- Unified diffs with syntax highlighting
- Expandable/collapsible output sections
- File read with line numbers

`views/home-view.tsx` - Welcome screen with animated robot and centered input
`views/chat-view.tsx` - Main conversation view (scrollbox + input + status)
`views/onboarding-view.tsx` - First-run provider/model setup wizard

### OpenTUI Elements

OpenTUI provides these built-in elements (used like HTML tags in JSX):

- `<box>` - Flexbox container (like `<div>`)
- `<text>` - Text display (like `<span>`)
- `<span>` - Inline text modifier (for coloring nested text)
- `<scrollbox>` - Scrollable container
- `<textarea>` - Multi-line text input
- `<input>` - Single-line text input
- `<select>` - List selection
- `<code>` - Syntax-highlighted code block
- `<diff>` - Unified/split diff viewer
- `<markdown>` - Streaming markdown renderer

Styling uses named terminal colors as props:

```tsx
<text fg="cyan">colored text</text>
<box backgroundColor="gray" paddingX={1}>padded box</box>
```

Layout follows flexbox conventions: `flexDirection`, `flexGrow`, `flexShrink`, `gap`, `padding`, `margin`, etc.

## Testing

```bash
# Unit tests
bun run test:unit

# E2E tests
bun run test:e2e
bun run test:e2e:interactive

# TUI-specific E2E tests (uses @microsoft/tui-test)
bun run test:e2e:cli:tui

# Type checking
bun run typecheck

# Lint and format
cd ../.. && bun run fix   # auto-fix from repo root
```

## Common Development Tasks

### Running in interactive mode

```bash
bun run dev
```

### Testing onboarding flow

Use a temporary config directory to simulate a fresh install:

```bash
bun run dev -- --interactive --config /tmp/cline-test
```

Or set `CLINE_FORCE_ONBOARDING=1` to force the onboarding view regardless of existing config.

### Adding a new TUI component

1. Create a `.tsx` file in `src/tui/components/`
2. Add the JSX pragma at the top: `// @jsxImportSource @opentui/react`
3. Use OpenTUI elements (`<box>`, `<text>`, etc.) for layout
4. Import and use in the parent view or root

### Adding a new dialog

1. Create a content component that receives `ChoiceContext<T>` props
2. Use `useDialogKeyboard` for keyboard handling
3. Call `resolve(value)` to return a result, `dismiss()` to cancel
4. Open it from a hook or view: `const result = await dialog.choice<T>({ content: ... })`
5. Fetch any async data before calling `dialog.choice()`, not inside the dialog

### Adding a new slash command

1. Define the command handler in `root.tsx` (in the slash command processing section)
2. Add the command to the help dialog in `components/dialogs/help-dialog.tsx`
3. Add autocomplete entry in `hooks/use-autocomplete.ts`

### Debugging the TUI

```bash
# Run with React DevTools (requires react-devtools-core@7)
DEV=true bun run dev

# In another terminal
npx react-devtools@7
```

### Debugging the CLI process

```bash
cd apps/cli
CLINE_BUILD_ENV=development bun --conditions=development --inspect-brk=6499 ./src/index.ts
```

Then attach VS Code or Chrome DevTools to `ws://127.0.0.1:6499`.

## OpenTUI Resources

- OpenTUI docs: https://opentui.com/docs/getting-started
- Repository: https://github.com/anomalyco/opentui
- Packages used by CLI:
  - `@opentui/core` - Native renderer and built-in elements
  - `@opentui/react` - React reconciler (`createRoot`, hooks)
  - `@opentui-ui/dialog` - Dialog/modal system
  - `opentui-spinner` - Spinner component
