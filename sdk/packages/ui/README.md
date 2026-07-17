# `@cline/ui`

Shared visual foundations and reusable React presentation primitives for Cline
web products. The package lets teams adopt the same semantic theme and agent
chat language without adopting another product's routes, state, or runtime.

The package is configured for public npm releases on its own version and
release cycle. Its API is still pre-stable, so consumers should pin an exact
version and review compatibility notes when updating. If npm reports `E404`,
the initial `0.1.0` bootstrap release is still pending.

See the [adoption primer](./ADOPTION.md) for complete setup instructions,
component examples, boundaries, and release status.

## Install

After the initial release is available:

```bash
bun add @cline/ui
```

Use `@cline/ui@next` only for deliberate previews. Monorepo consumers use
`"@cline/ui": "workspace:*"` instead.

## Entry points

| Import | Contents | Runtime requirement |
| --- | --- | --- |
| `@cline/ui/theme/tokens.css` | Light/dark custom properties only | CSS |
| `@cline/ui/theme/theme.css` | Tailwind v4 semantic mapping and dark variant | Tailwind v4 |
| `@cline/ui/theme/base.css` | Optional document, Markdown, scrollbar, selection, and cursor styles | Tailwind v4 |
| `@cline/ui/theme/index.css` | Complete theme: tokens, Tailwind mapping, and base styles | Tailwind v4 |
| `@cline/ui/components/agent-chat` | Conversation, message, reasoning, action, and tool-activity React primitives | React 18.3 or 19 |
| `@cline/ui/components/agent-chat.css` | Framework-neutral styles for the agent-chat primitives | Theme tokens |

The token entry point has no React, Tailwind, font-package, or desktop runtime
dependency. Apps provide Schibsted Grotesk and Azeret Mono themselves, which
lets each bundler control font loading and asset emission.

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

## Storybook

Run the interactive component catalog from the repository root:

```bash
bun -F @cline/ui storybook
```

Then open `http://localhost:6006`. Build the static catalog with:

```bash
bun -F @cline/ui build-storybook
```

The catalog includes the theme foundations and representative agent-chat
states in light, dark, desktop, and narrow viewports.

Storybook currently runs from a Cline monorepo checkout. It is not hosted or
included in the npm package; deployment can be added once the catalog and
ownership model settle.

## Layering and compatibility

- Import the Cline theme after Tailwind so its default typography values win.
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

The first release is a one-time manual bootstrap because npm only accepts a
trusted-publisher configuration for an existing package. Maintainers use the
repository's `publish-ui` skill for that bootstrap and for later releases.

Pin an exact version in production applications:

```bash
bun add @cline/ui@0.1.0
```

Commit the consumer lockfile and update deliberately. The package is ESM and
its React components target browser applications. A complete Tailwind theme
also requires Tailwind v4 and the two font packages shown above.
