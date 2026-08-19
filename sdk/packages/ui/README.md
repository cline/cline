# `@cline/ui`

Shared visual foundations and reusable React presentation primitives for Cline
web products. The package lets teams adopt the same semantic theme and agent
chat language without adopting another product's routes, state, or runtime.

The package is configured for public npm releases on its own version and
release cycle. Its API is still pre-stable, so consumers should pin an exact
version and review compatibility notes when updating. Check availability with
`npm view @cline/ui version`; an `E404` means the first release is still pending.

See the [adoption primer](./ADOPTION.md) for complete setup instructions,
component examples, boundaries, and release status.

## Install

After the initial release is available:

```bash
bun add --exact @cline/ui
```

Use `@cline/ui@next` only for deliberate previews. Monorepo consumers use
`"@cline/ui": "workspace:*"` instead.

## Entry points

| Import | Contents | Runtime requirement |
| --- | --- | --- |
| `@cline/ui` | Button, icon-button, agent ask-question, approval-card, Aurora, hero-heading, prompt-queue, quick-action, search-combobox, and session-status React primitives | React 18.3 or 19 and Tailwind v4 |
| `@cline/ui/components.css` | Styles, namespaced Tailwind mappings, and source registration for the root React primitives | Tailwind v4 and theme tokens |
| `@cline/ui/theme/palette.css` | Cline-owned light/dark solid and alpha color scales | CSS |
| `@cline/ui/theme/tokens.css` | Light/dark custom properties only | CSS |
| `@cline/ui/theme/scoped-tokens.css` | Light/dark custom properties scoped to `.cline-ui-theme` | CSS |
| `@cline/ui/theme/theme.css` | Tailwind v4 semantic mapping and dark variant | Tailwind v4 |
| `@cline/ui/components/markdown.css` | Optional framework-neutral Markdown and Streamdown treatment | Theme tokens |
| `@cline/ui/theme/base.css` | Optional document, Markdown, scrollbar, selection, and cursor styles | Tailwind v4 |
| `@cline/ui/theme/index.css` | Complete theme: tokens, Tailwind mapping, and base styles | Tailwind v4 |
| `@cline/ui/components/agent-chat` | Conversation, message, reasoning, action, and tool-activity React primitives | React 18.3 or 19 |
| `@cline/ui/components/agent-chat.css` | Framework-neutral styles for the agent-chat primitives | Theme tokens |

`SessionStatus` uses semantic tone colors by default. Set
`--cline-ui-session-status-color` on the component to override its dot color
for a host-specific status palette.

`SearchCombobox` provides a searchable selector for repository and model lists.
Its in-place panel requires ancestors that do not clip overflow.

Import `components.css` after Tailwind and either token entry point. It
registers package-namespaced mappings and the packaged component sources so
their utilities are emitted without changing generic host utility names.

`AgentQuickActions` renders prompt shortcuts and reports selection to the host.

`Button` and `IconButton` share `fill`, `surface`, and `ghost` variants across
accent, neutral, and destructive tones. Both default to `type="button"` so they
are safe inside forms. `IconButton` requires an accessible `aria-label`, and
both components support Radix-style composition through `asChild`.

```tsx
import { Button, IconButton } from "@cline/ui";

<Button size="sm" tone="accent" variant="fill">
	Continue
</Button>;

<IconButton aria-label="Close" size="sm">
	<CloseIcon />
</IconButton>;
```

`AgentAurora` fills its nearest positioned ancestor, which must have resolved
dimensions.

`AgentHeroHeading` renders the shared cycling “What would you like to …?”
welcome heading and respects reduced-motion preferences.

`AgentApprovalCard` is controlled presentation; the host owns approval state
and submits its callbacks.

`AgentAskQuestion` keeps option selection locally and submits explicitly. The
host owns pending answers, errors, and response transport. Multiple-choice
items set `multiple: true` and provide `onAnswers` for array submission.

`AgentPromptQueue` renders queued prompts and reports edit, remove, and steer
actions to the host.

The token entry point has no React, Tailwind, font-package, or desktop runtime
dependency. Apps provide Inter and Geist Mono themselves, which
lets each bundler control font loading and asset emission.

`palette.css` and `tokens.css` are the canonical theme sources;
`scoped-tokens.css` and the internal component Tailwind mapping are generated
from them and `theme.css`. Contributors change the source theme files and run
`bun run generate:theme`; tests and CI reject drift in either generated output.
Consumers may import either public token entry point.

## Theme usage

For a Tailwind v4 app, import framework and consumer dependencies first:

```css
@import "@fontsource-variable/inter";
@import "@fontsource-variable/geist-mono";
@import "tailwindcss";
@import "@cline/ui/theme/index.css";
```

An app that only needs framework-neutral values can import:

```css
@import "@cline/ui/theme/tokens.css";
```

For an embedded surface, import scoped tokens and optional Markdown styles:

```css
@import "@cline/ui/theme/scoped-tokens.css";
@import "@cline/ui/components.css";
@import "@cline/ui/components/markdown.css";
```

```tsx
<section className="cline-ui-theme">
	<div className="cline-markdown">...</div>
</section>
```

Dark values activate when `.dark` is on the wrapper or an ancestor.

Embedded hosts should not import `@cline/ui/theme/theme.css`; it intentionally
maps generic Tailwind names such as `bg-background` for Cline-owned surfaces.

The theme follows the standard shadcn semantic contract (`--background`,
`--foreground`, `--card`, `--primary`, `--border`, `--ring`, charts, and
sidebar surfaces) and Tailwind theme names. This means shadcn components and
normal Tailwind utilities inherit Cline defaults without custom adapters.

Theme authors work through three layers:

1. Cline-owned 12-step solid and alpha palettes: Slate as `--neutral-*`,
   Violet as `--accent-*`, Ruby as `--error-*`, Green as `--success-*`, Amber
   as `--warning-*`, and Sky as `--info-*`.
2. Readable visual roles such as `--surface-1`, `--text-2`, `--border-1`, and
   `--success-surface`.
3. Stable shadcn compatibility variables consumed by components.

Prefer visual or status roles when authoring new framework-neutral component
CSS. Continue using standard shadcn names in shadcn-compatible components.
Tailwind exposes the role and compatibility layers, but intentionally does not
register every raw palette step. Brand artwork may use the separate
`--brand-*` colors.

The palette values are derived from Radix Colors 3.0.0 under the included MIT
license; `@cline/ui` does not depend on Radix Colors at runtime.

## Agent-chat usage

Agent-chat consumers must provide React 18.3 or 19. Install React in the
consuming application if it is not already present:

```bash
bun add react@^19 react-dom@^19
```

Applications already on React 18.3 can retain that compatible version.

In the application's global CSS, import the component styles after at least the
theme tokens:

```css
@import "@cline/ui/theme/tokens.css";
@import "@cline/ui/components/agent-chat.css";
```

Then import the React components:

```tsx
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
	ConversationViewport,
	Message,
	MessageAction,
	MessageActions,
	MessageContent,
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
	ToolActivity,
	ToolActivityCode,
	ToolActivityContent,
	ToolActivityDetails,
	ToolActivityTrigger,
	WorkActivity,
	WorkActivityContent,
	WorkActivityTrigger,
} from "@cline/ui/components/agent-chat";
```

`Conversation` owns sticky scrolling, `Message` owns role presentation,
`Reasoning` and `ToolActivity` provide accessible disclosures, `ThinkingBlock`
is the standard thinking-trace row ("Thinking" shimmer while streaming,
"Thought for Ns" once done), `WorkActivity` folds a finished run's working
rows behind a "Worked for 4m 12s and made 14 tool calls" summary, and the
smaller action, empty-state, detail, and code primitives fill out common
transcript states.

For assistant Markdown, `@cline/ui/components/markdown` exports the shared
Streamdown configuration — `markdownCodeHighlighter` (lazy Shiki with GitHub
light/dark themes) and `agentMarkdownControls` — and
`@cline/ui/components/markdown.css` carries the matching chat styling (quiet
single-box code blocks with a hover copy control, chat-scale headings, table
cards). Import the CSS unlayered so it wins over Streamdown's Tailwind
utilities, and keep `streamdown`, `shiki`, `@shikijs/langs`, and
`@shikijs/themes` installed (optional peer dependencies). Products keep their
own `<Streamdown>` wrapper for link and image policy. Give each conversation a bounded height through an explicit height or
a complete flex/min-height chain so its viewport can scroll.

These are presentation primitives, not an agent SDK. Consumers map their own
message and tool schemas into the components and retain their own Markdown,
transport, approvals, persistence, and product actions.

## Storybook

Run the interactive component catalog from the repository root:

```bash
bun -F @cline/ui storybook
```

Then open `http://localhost:6006`. Build the static catalog with:

```bash
bun -F @cline/ui build-storybook
```

In the repository's agent sandbox, bind to a forwarded host and unused port:

```bash
bun -F @cline/ui storybook -- --host 0.0.0.0 --port 3490 --exact-port
```

The catalog includes the theme foundations and representative agent-chat
states in light, dark, desktop, and narrow viewports.

Storybook currently runs from a Cline monorepo checkout. It is not hosted or
included in the npm package; deployment can be added once the catalog and
ownership model settle.

## Layering and compatibility

- Import the Cline theme after Tailwind so its default typography values win.
- Import `components/markdown.css` after either token entry point.
- Import `agent-chat.css` after theme tokens.
- Override `:root` or `.dark` after package imports for deliberate product
  variations; do not rename the default semantic contract.
- `base.css` is optional because it contains opinionated Markdown and global
  interaction styles.
- Shell layout, routes, provider/session state, and runtime behavior stay with
  each consumer.
- Contract changes should include a compatibility note, package tests, a
  Storybook build, and at least one real consumer build.

## Releases

The standalone `ui-publish.yml` workflow validates the package and publishes
only after a manual dispatch from `main`. Production releases use the npm
`latest` tag; deliberate previews use `next`. UI releases do not trigger the
SDK release, GitHub releases, or Slack announcements.

Maintainers use the repository's `publish-ui` skill for the initial bootstrap
and later releases.

The install command above pins the resolved release. Commit the consumer
lockfile and update deliberately. The package is ESM and its React components
target browser applications. A complete Tailwind theme also requires Tailwind
v4 and the two font packages shown above.
