# `@cline/ui` adoption primer

This guide is for Cline engineering teams that want a web application to share
the Cline visual language and agent-chat presentation without copying desktop
styles or adopting desktop product structure.

## The short version

`@cline/ui` has two opt-in layers:

1. A shared CSS theme built around standard shadcn/Tailwind semantic names.
2. Reusable React presentation primitives for common agent-chat interfaces.

The theme provides:

- Light and dark semantic colors
- Standard shadcn token names
- Typography families, sizes, weights, line heights, and letter spacing
- Borders, radii, cards, navigation, sidebar, and chart colors
- Selection and scrollbar values
- A small brand palette for artwork
- Tailwind v4 mappings
- Optional global, interaction, and Markdown styles

The first component surface provides:

- Sticky agent-conversation structure and a scroll-to-latest affordance
- User, assistant, system, status, and error message presentation
- Message actions with accessible labels and focus behavior
- Controlled or uncontrolled reasoning disclosures
- Static or expandable tool activity with running, success, and error states
- Empty-conversation presentation

The root component surface adds reusable agent setup and interaction controls:

- A scoped `AgentSurface` boundary for host-safe theme adoption
- Welcome heading, aurora artwork, and quick actions
- Controlled repository or model selection
- Controlled prompt composition and stop affordance
- Transport-neutral approval decisions
- Shared buttons, confirmation dialogs, and session status

Each application continues to own:

- Runtime message and tool schemas
- Session, provider, transport, streaming, and persistence behavior
- Markdown rendering and external-link/image policy
- Approval and follow-up-question orchestration
- Checkpoint, fork, clipboard, and toast behavior
- Page layouts, navigation, and product workflows
- Font-file loading and framework integration
- Product-specific animation and deliberate visual overrides

This boundary gives Cline products a shared visual and interaction language
without turning `@cline/ui` into a second agent runtime.

## Current status

`@cline/ui@0.1.0` is publicly available. The package has its own version and
manual release workflow. The API is pre-stable, so production consumers should
pin exact versions and review compatibility notes when updating.

The scoped-token and standalone Markdown exports in this guide are part of the
upcoming `0.2` release. Until a `next` preview is published, consume them from
the Cline workspace.

Desktop is the first production-shaped consumer of both the theme and shared
chat primitives. Storybook is the reference catalog for isolated component
states. Hub and other agent interfaces are candidates for the next adoption
pass once their runtime and Markdown adapters are mapped explicitly.

## Choose an adoption level

| Goal | Import | Tailwind required | React required |
| --- | --- | --- | --- |
| Use only light/dark CSS variables | `@cline/ui/theme/tokens.css` | No | No |
| Theme only an embedded subtree | `@cline/ui/theme/scoped-tokens.css` | No | No |
| Style Markdown without global base styles | A token entry point, then `@cline/ui/components/markdown.css` | No | No |
| Use tokens through Tailwind utilities | `tokens.css` then `theme.css` | Tailwind v4 | No |
| Use the complete theme and shared base behavior | `@cline/ui/theme/index.css` | Tailwind v4 | No |
| Compose shared setup and interaction controls | `@cline/ui` plus `@cline/ui/components.css` | No, if scoped tokens are imported | React 18.3 or 19 |
| Compose shared agent-chat presentation | `@cline/ui/components/agent-chat` plus its CSS | No, if tokens are mapped in plain CSS | React 18.3 or 19 |

The package exports `base.css` separately for consumers that want its global,
Markdown, scrollbar, selection, cursor, and native `color-scheme` behavior.

There is no `@cline/ui/theme` shorthand. Use the explicit theme paths documented
here so dependencies remain visible. Root React controls are exported from
`@cline/ui` and styled by `@cline/ui/components.css`.

## Install inside the Cline monorepo

Add the workspace dependency:

```json
{
  "dependencies": {
    "@cline/ui": "workspace:*"
  }
}
```

Run the repository's normal package installation workflow after updating the
manifest and lockfile.

## Install from npm in another repository

Install the latest production UI release. The `--exact` flag records the
resolved version instead of a range:

```bash
bun add --exact @cline/ui
```

The package is ESM. Its React entry point targets browser applications. Install
only the prerequisites for the layer being adopted:

```bash
# Required for root controls and agent-chat components
bun add react@^19 react-dom@^19

# Required for the documented Tailwind-backed theme and Cline fonts
bun add @fontsource-variable/schibsted-grotesk @fontsource/azeret-mono
bun add --dev tailwindcss
```

Applications already on React 18.3 can retain that compatible version.
Tokens-only consumers do not need React or Tailwind.

Commit the consuming repository's lockfile so builds continue using the same
resolved version. Use the package manager's update command when the team
intentionally wants to move to a newer release:

```bash
bun update @cline/ui
```

For deliberate previews, UI releases can publish an unstable `next` npm tag:

```bash
bun add --exact @cline/ui@next
```

Do not use `next` for production applications. UI versions move independently
from the runtime SDK packages.

## Option 1: complete Tailwind v4 theme

Import fonts and Tailwind before the complete theme:

```css
@import "@fontsource-variable/schibsted-grotesk";
@import "@fontsource/azeret-mono/latin.css";
@import "tailwindcss";
@import "@cline/ui/theme/index.css";
```

This supplies:

- Framework-neutral token values
- Tailwind semantic mappings and dark variant
- Global typography and body styles
- Markdown and code-block styling
- Scrollbar and selection styling
- Consistent pointer affordances
- Native light/dark `color-scheme`

Application-specific CSS should follow these imports.

## Option 2: Tailwind mappings without base styles

Use this when the application wants the shared tokens and utilities but already
owns document, Markdown, scrollbar, or cursor behavior:

```css
@import "@fontsource-variable/schibsted-grotesk";
@import "@fontsource/azeret-mono/latin.css";
@import "tailwindcss";
@import "@cline/ui/theme/tokens.css";
@import "@cline/ui/theme/theme.css";
```

If the application later opts into shared base behavior, import
`@cline/ui/theme/base.css` after `theme.css`.

## Option 3: framework-neutral tokens

Applications without Tailwind can import only the variables:

```css
@import "@cline/ui/theme/tokens.css";
```

Token-only consumers must provide:

- Font files
- Resets and document defaults
- Native `color-scheme`, if desired
- Their own mapping from CSS variables to framework utilities
- Their own dark-mode class activation

For native controls that should follow the selected theme:

```css
:root {
  color-scheme: light;
}

.dark {
  color-scheme: dark;
}
```

## Option 4: subtree-scoped tokens

Use the scoped entry when an embedded Cline surface must preserve the host
application's existing `:root` theme:

```css
@import "@cline/ui/theme/scoped-tokens.css";
```

Wrap the embedded surface with `cline-ui-theme`. Dark values apply when `dark`
is on the same element or an ancestor:

```tsx
<main className="host-dashboard">
  <section className="cline-ui-theme">...</section>
</main>

<section className="cline-ui-theme dark">...</section>
```

The scoped entry defines variables only. The host continues to own document
styles, native `color-scheme`, fonts, shell layout, navigation, and routing.
Place deliberate scoped overrides after the package import:

```css
.cline-ui-theme {
  --primary: /* product-specific value */;
}

.cline-ui-theme.dark,
.dark .cline-ui-theme {
  --primary: /* dark product-specific value */;
}
```

`tokens.css` is the canonical source for both public token contracts.
Contributors edit it and run `bun run generate:theme`; consumers should not
edit or copy the generated `scoped-tokens.css` file.

## Add standalone Markdown styles

`components/markdown.css` contains optional, framework-neutral Markdown and
Streamdown treatment, but it intentionally reads semantic typography, radius,
border, and muted-color variables. Import it after either token entry and keep
rendered Markdown inside that token scope:

```css
@import "@cline/ui/theme/scoped-tokens.css";
@import "@cline/ui/components/markdown.css";
```

```tsx
<section className="cline-ui-theme">
  <div className="cline-markdown">...</div>
</section>
```

Consumers retain their own Markdown renderer, plugins, sanitization, external
link behavior, and image policy.

## Add the agent-chat components

With the complete Tailwind theme, import the component styles afterward:

```css
@import "@cline/ui/theme/index.css";
@import "@cline/ui/components/agent-chat.css";
```

Without Tailwind, import the framework-neutral tokens and component styles,
then apply the shared font family at an app or chat root (tokens define font
values but do not apply document typography):

```css
@import "@cline/ui/theme/tokens.css";
@import "@cline/ui/components/agent-chat.css";

.agent-chat-root {
  font-family: var(--font-sans);
}
```

Then compose the presentation around the consuming application's own data:

```tsx
import type { ReactNode } from "react";
import {
  type AgentMessageRole,
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationViewport,
  Message,
  MessageActions,
  MessageAction,
  MessageContent,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  ToolActivity,
  ToolActivityContent,
  ToolActivityTrigger,
} from "@cline/ui/components/agent-chat";

type ProductMessage = {
  id: string;
  role: "human" | "agent" | "system" | "error";
  content: string;
  reasoning?: string;
  isStreaming?: boolean;
};

const roleMap: Record<ProductMessage["role"], AgentMessageRole> = {
  human: "user",
  agent: "assistant",
  system: "system",
  error: "error",
};

type AgentTranscriptProps = {
  conversationId: string;
  messages: ProductMessage[];
  onCopy: (message: ProductMessage) => void;
  renderMarkdown: (content: string) => ReactNode;
};

export function AgentTranscript({
  conversationId,
  messages,
  onCopy,
  renderMarkdown,
}: AgentTranscriptProps) {
  return (
    <Conversation
      className="agent-chat-root"
      key={conversationId}
      style={{ height: "32rem" }}
    >
      <ConversationViewport aria-label="Agent conversation">
        <ConversationContent>
          {messages.map((message) => (
            <Message from={roleMap[message.role]} key={message.id}>
              <MessageContent>
                {message.reasoning ? (
                  <Reasoning isStreaming={message.isStreaming}>
                    <ReasoningTrigger />
                    <ReasoningContent>
                      {renderMarkdown(message.reasoning)}
                    </ReasoningContent>
                  </Reasoning>
                ) : null}

                {renderMarkdown(message.content)}
              </MessageContent>

              <MessageActions>
                <MessageAction label="Copy message" onClick={() => onCopy(message)}>
                  Copy
                </MessageAction>
              </MessageActions>
            </Message>
          ))}

          <ToolActivity expandable>
            <ToolActivityTrigger
              label="Edited 2 files"
              additions={24}
              deletions={8}
              status="success"
            />
            <ToolActivityContent>Normalized tool details</ToolActivityContent>
          </ToolActivity>
        </ConversationContent>
      </ConversationViewport>
      <ConversationScrollButton />
    </Conversation>
  );
}
```

The explicit height keeps this standalone example scrollable. In a real shell,
an equivalent bounded flex layout works too: every ancestor in the height chain
must allow shrinking (commonly `min-height: 0`) and the conversation must fill
the available height.

The example intentionally injects a consumer-owned `renderMarkdown`. Different
products currently have different Streamdown plugins, syntax-highlighting
budgets, link-confirmation behavior, and image policies. The React `key` resets
conversation-local state when the active session changes. The shared package
standardizes the surrounding presentation without silently changing those
security and product decisions.

Map runtime roles and tool states at the consumer boundary. Do not make the UI
package depend on `@cline/core`, the Vercel AI SDK, desktop schemas, or transport
events.

## Explore components in Storybook

From the Cline repository root:

```bash
bun -F @cline/ui storybook
```

Open `http://localhost:6006`. The toolbar switches light/dark mode and offers
representative chat and mobile viewports. Stories cover:

- Theme colors, typography, radii, and controls
- Complete and empty conversations
- User, assistant, and error messages
- Collapsed, expanded, and streaming reasoning
- Pending, running, successful, and failed tool activity
- Expandable and static tool summaries

In the repository's agent sandbox, bind to a forwarded host and unused port:

```bash
bun -F @cline/ui storybook -- --host 0.0.0.0 --port 3490 --exact-port
```

Build the production Storybook bundle with:

```bash
bun -F @cline/ui build-storybook
```

Storybook is the isolated component reference. Real application builds remain
the integration test for runtime adapters and product CSS.

The catalog currently runs from a Cline monorepo checkout. Story sources and
configuration are not included in the npm package, and the catalog is not
hosted yet.

## Token usage

Product components should use semantic tokens:

```css
.card {
  color: var(--card-foreground);
  background: var(--card);
  border-color: var(--border);
}

.primary-action {
  color: var(--primary-foreground);
  background: var(--primary);
}
```

Use the small `--brand-*` palette and `--primary-emphasis` for branded artwork
or deliberate emphasis. Normal controls should prefer semantic tokens so they
continue to work across light, dark, and future theme layers.

## Product overrides

Import the package first, then override standard semantic values:

```css
@import "@cline/ui/theme/index.css";

:root {
  --primary: /* product-specific value */;
}

.dark {
  --primary: /* dark product-specific value */;
}
```

Do not copy `tokens.css` or component CSS into the consuming application.
Explicit overrides make product differences reviewable and allow future
package upgrades.

## Consumer-owned behavior

Keep the following outside `@cline/ui`:

- Next, Tauri, VS Code, and runtime-specific behavior
- `#__next`, viewport locking, and shell layout
- Application routes and information architecture
- Session, workspace, provider, and sidecar behavior
- Runtime event normalization and persistence
- Tool-name classification and raw tool-payload parsing
- Approval and question request orchestration
- Product-specific actions and animation
- Components that have not been proven reusable by multiple products

The package should standardize repeated visual and interaction language, not
erase product boundaries.

## Adoption checklist

- [ ] Choose `workspace:*` or a pinned npm version.
- [ ] Commit the consuming project's lockfile.
- [ ] Choose tokens-only, Tailwind mappings, or the complete theme.
- [ ] Load the required font files.
- [ ] Import files in the documented order.
- [ ] Import `agent-chat.css` when using the React primitives.
- [ ] Install React 18.3 or 19 when using the React primitives.
- [ ] Map product message/tool models at the package boundary.
- [ ] Use the stable conversation identifier as the `Conversation` React `key`.
- [ ] Keep Markdown and link/image policy explicit in the consumer.
- [ ] Confirm the application's `.dark` behavior.
- [ ] Put deliberate overrides after package imports.
- [ ] Build the application in development and production.
- [ ] Compare representative screens in light and dark modes.
- [ ] Exercise focus, hover, disabled, streaming, and error states.
- [ ] Check the same states in Storybook.
- [ ] Record required overrides and missing shared behavior.

## Contract and compatibility expectations

Until the package has a stable version, contract changes should:

- Include a compatibility note
- Run the package build, typechecking, and tests
- Build Storybook
- Build every active consumer
- Include light/dark visual evidence when values change
- Avoid renaming standard shadcn/Tailwind variables
- Keep `tokens.css` framework-neutral
- Keep `tokens.css` canonical and regenerate the scoped token output
- Keep component props independent of product runtime schemas
- Keep product-specific layout and orchestration out of the package

Removing or changing the meaning of a semantic token or component prop should
eventually be treated as a breaking change. Additive tokens, props, and entry
points can be introduced compatibly.

## Release and stability roadmap

The npm package solves cross-repository distribution. The remaining work is to
validate and stabilize the public contract.

Recommended sequence:

1. Adopt the theme and chat primitives in a second production-shaped Cline app.
2. Record where that app needs adapters or deliberate variations.
3. Assign design and engineering owners.
4. Define browser, React, Tailwind, compatibility, and deprecation policies.
5. Add screenshot regression coverage for representative Storybook states.
6. Expand clean-consumer fixtures as supported frameworks are proven.
7. Define the compatibility point at which the API can be treated as stable.

Likely follow-up components should be driven by repeated needs. Follow-up
questions and attachments are candidates, but their current product contracts
should be compared before standardizing them. Tool activity remains in the
existing `@cline/ui/components/agent-chat` surface rather than being duplicated
by the root controls.

## Useful references

- [Package README](./README.md)
- [Agent-chat components](./components/agent-chat/index.tsx)
- [Agent-chat styles](./components/agent-chat/agent-chat.css)
- [Markdown styles](./components/markdown.css)
- [Tokens](./theme/tokens.css)
- [Tailwind mappings](./theme/theme.css)
- [Optional base styles](./theme/base.css)
- [Complete theme](./theme/index.css)
- [Package manifest](./package.json)
- [Desktop theme integration test (monorepo)](https://github.com/cline/cline/blob/main/apps/examples/desktop-app/webview/styles/theme-integration.test.ts)
