# `@cline/ui`

Shared visual foundations and reusable React presentation primitives for Cline
web products. The package lets teams adopt the same semantic theme and agent
chat language without adopting another product's routes, state, or runtime.

`@cline/ui@0.1.0` is publicly available. The package has its own version and
release cycle. Its API is still pre-stable, so consumers should pin an exact
version and review compatibility notes when updating.

See the [adoption primer](./ADOPTION.md) for complete setup instructions,
component examples, boundaries, and release status.

## Install

Install the current release:

```bash
bun add --exact @cline/ui
```

Use `@cline/ui@next` only for deliberate previews. Monorepo consumers use
`"@cline/ui": "workspace:*"` instead.

## Entry points

| Import | Contents | Runtime requirement |
| --- | --- | --- |
| `@cline/ui` | Button and session-status React primitives | React 18.3 or 19 |
| `@cline/ui/components.css` | Framework-neutral styles for the root React primitives | Theme tokens |
| `@cline/ui/theme/tokens.css` | Light/dark custom properties only | CSS |
| `@cline/ui/theme/scoped-tokens.css` | Light/dark custom properties scoped to `.cline-ui-theme` | CSS |
| `@cline/ui/theme/theme.css` | Tailwind v4 semantic mapping and dark variant | Tailwind v4 |
| `@cline/ui/components/markdown.css` | Optional framework-neutral Markdown and Streamdown treatment | Theme tokens |
| `@cline/ui/theme/base.css` | Optional document, Markdown, scrollbar, selection, and cursor styles | Tailwind v4 |
| `@cline/ui/theme/index.css` | Complete theme: tokens, Tailwind mapping, and base styles | Tailwind v4 |
| `@cline/ui` | Host-safe agent setup, input, approval, and base control primitives | React 18.3 or 19 |
| `@cline/ui/components.css` | Framework-neutral styles for root component primitives | Scoped theme tokens |
| `@cline/ui/components/agent-chat` | Conversation, message, reasoning, action, and tool-activity React primitives | React 18.3 or 19 |
| `@cline/ui/components/agent-chat.css` | Framework-neutral styles for the agent-chat primitives | Theme tokens |

The token entry point has no React, Tailwind, font-package, or desktop runtime
dependency. Apps provide Schibsted Grotesk and Azeret Mono themselves, which
lets each bundler control font loading and asset emission.

`tokens.css` is the canonical token source; `scoped-tokens.css` is generated
from it. Contributors change `tokens.css` and run `bun run generate:theme`;
tests and CI reject drift in the scoped output. Consumers may import either
public entry point.

## Theme usage

For a Tailwind v4 app, import framework and consumer dependencies first:

```css
@import "@fontsource-variable/schibsted-grotesk";
@import "@fontsource/azeret-mono/latin.css";
@import "tailwindcss";
@import "@cline/ui/theme/index.css";
```

An app that only needs framework-neutral values can import:

```css
@import "@cline/ui/theme/tokens.css";
```

An embedded surface that must not replace its host application's root tokens
can import the scoped contract instead:

```css
@import "@cline/ui/theme/scoped-tokens.css";
```

Apply `cline-ui-theme` to the surface boundary. Dark values activate when a
`dark` class is on that boundary or one of its ancestors:

```tsx
<section className="cline-ui-theme">...</section>
<section className="cline-ui-theme dark">...</section>
```

The standalone Markdown treatment is framework-neutral but intentionally uses
semantic theme variables. Import it after either token entry point and render
Markdown beneath the same token scope:

```css
@import "@cline/ui/theme/scoped-tokens.css";
@import "@cline/ui/components/markdown.css";
```

```tsx
<section className="cline-ui-theme">
	<div className="cline-markdown">...</div>
</section>
```

The theme follows the standard shadcn semantic contract (`--background`,
`--foreground`, `--card`, `--primary`, `--border`, `--ring`, charts, and
sidebar surfaces) and Tailwind theme names. This means shadcn components and
normal Tailwind utilities inherit Cline defaults without custom adapters.

Brand artwork may use the small extension set (`--primary-emphasis` and the
`--brand-*` palette). Product controls should prefer semantic variables.

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
} from "@cline/ui/components/agent-chat";
```

`Conversation` owns sticky scrolling, `Message` owns role presentation,
`Reasoning` and `ToolActivity` provide accessible disclosures, and the smaller
action, empty-state, detail, and code primitives fill out common transcript
states. Give each conversation a bounded height through an explicit height or
a complete flex/min-height chain so its viewport can scroll.

These are presentation primitives, not an agent SDK. Consumers map their own
message and tool schemas into the components and retain their own Markdown,
transport, approvals, persistence, and product actions.

## Setup and interaction controls

The package root exports shared setup, input, approval, and base controls. Wrap
them in `AgentSurface`, which applies the scoped Cline theme, and import their
styles once:

```css
@import "@cline/ui/theme/scoped-tokens.css";
@import "@cline/ui/components.css";
```

```tsx
import { AgentApprovalCard, AgentComposer, AgentSurface } from "@cline/ui";
```

`AgentComposer` and `AgentApprovalCard` are controlled presentation components.
The consuming app owns draft state, submission, streaming, permission decisions,
and transport. Attachments, mentions, commands, and queueing remain host-owned.
For transcript messages, reasoning, and tool execution, continue to use
`@cline/ui/components/agent-chat`; do not create a second activity model in the
root component surface.

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
