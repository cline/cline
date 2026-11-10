# `@cline/ui` adoption primer

This guide is for Cline engineering teams that want a web application to share
the Cline visual language and agent-chat presentation without copying desktop
styles or adopting desktop product structure.

## The short version

`@cline/ui` has two opt-in layers:

1. A shared CSS theme built around standard shadcn/Tailwind semantic names.
2. Reusable React presentation primitives for common agent-chat interfaces.

The theme provides:

- Cline-owned Slate, Iris, Vermilion, Emerald, Amber, and Sky solid/alpha palettes
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

The boundary is about runtime coupling, not about keeping the package small.
When more than one product needs the same presentation behavior, the goal is
to extract it here as a shared module rather than let each app grow its own
copy — that is the direction `@cline/ui` is headed, and more shared modules
are expected over time. Two exist today:

- `@cline/ui/components/agent-chat/tool-summary` — pure, framework-free
  functions (`buildToolSummary`, `buildGroupedToolLabel`, and the underlying
  parsers) that turn a raw `{ toolName, input, result }` payload into the
  labels, per-item details, diff counts, and before/after texts every surface
  should show. `unknown` in, data out — no React, no icons, no dependency on
  `@cline/core` or transport events.
- `@cline/ui/components/agent-chat/tool-diff` — `ToolFileDiff`, a thin
  wrapper over [`@pierre/diffs`](https://github.com/pierrecomputer/pierre)
  (optional peer dependency) that renders a tool-summary file item as a
  syntax-highlighted, theme-aware diff with consistent defaults.

Shared modules like these keep read/edit/command rows identical across
products while consumers still own their message schemas, icon assets, and
overall rendering. Before hand-rolling presentation logic in an app, check
whether it belongs here instead.

`AgentChangesPanel` and `AgentChangedFile` share the Changes pane header,
scrolling, file disclosure, path, copy feedback, and diff counts. Pass rendered
diff children and clipboard/native-editor callbacks; each host retains its
change collector, workspace paths, and conversation focus restoration.

`AgentPullRequestBar` shares PR state, merge readiness, diff counts, and check
presentation. Hosts provide normalized data, refresh/navigation callbacks,
and their accessible checks popover through `renderChecks`. Fetching, polling,
authentication, and telemetry stay in the host. Import these components from
`@cline/ui` and their styles through the existing `@cline/ui/components.css`.

`AgentCommandOutput` shares the desktop terminal frame and follow-output scrolling.
Pass ANSI-rendered or normalized output as children; transport and output limits
stay in the host. `AgentImageLightboxContent` shares the expanded image, backdrop
close action, and close control; hosts retain their dialog, focus, keyboard, and
image navigation. Import both from `@cline/ui` with `@cline/ui/components.css`.

## Current status

`@cline/ui` is configured for public npm publication with its own version and
manual release workflow. Check availability with `npm view @cline/ui version`;
an `E404` means the first release is still pending. The API is pre-stable, so
production consumers should pin exact versions and review compatibility notes
when updating.

Desktop is the first production-shaped consumer of both the theme and shared
chat primitives. Storybook is the reference catalog for isolated component
states. Hub and other agent interfaces are candidates for the next adoption
pass once their runtime and Markdown adapters are mapped explicitly.

## Choose an adoption level

| Goal | Import | Tailwind required | React required |
| --- | --- | --- | --- |
| Use only light/dark CSS variables | `@cline/ui/theme/tokens.css` | No | No |
| Render shared root React primitives without host resets | `scoped-tokens.css`, `components.css`, and `@cline/ui` | Tailwind v4 | React 18.3 or 19 |
| Use tokens through Tailwind utilities | `tokens.css` then `theme.css` | Tailwind v4 | No |
| Use the complete theme and shared base behavior | `@cline/ui/theme/index.css` | Tailwind v4 | No |
| Compose shared agent-chat presentation | `@cline/ui/components/agent-chat` plus its CSS | No, if tokens are mapped in plain CSS | React 18.3 or 19 |

The package exports `base.css` separately for consumers that want its global,
Markdown, scrollbar, selection, cursor, and native `color-scheme` behavior.

There is no `@cline/ui/theme` shorthand. Use the explicit paths documented here
so dependencies remain visible.

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

After the initial release is available, install the latest production UI
release. The `--exact` flag records the resolved version instead of a range:

```bash
bun add --exact @cline/ui
```

The package is ESM. Its React entry point targets browser applications. Install
only the prerequisites for the layer being adopted:

```bash
# Required for React components
bun add react@^19 react-dom@^19

# Required for the documented Tailwind-backed theme and Cline fonts
bun add @fontsource-variable/inter @fontsource-variable/geist-mono
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

`@cline/ui` is released with the SDK packages and shares their version. For
deliberate previews, install an unstable `nightly` build:

```bash
bun add --exact @cline/ui@nightly
```

Do not use `nightly` for production applications.

## Option 1: complete Tailwind v4 theme

Import fonts and Tailwind before the complete theme:

```css
@import "@fontsource-variable/inter";
@import "@fontsource-variable/geist-mono";
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
@import "@fontsource-variable/inter";
@import "@fontsource-variable/geist-mono";
@import "tailwindcss";
@import "@cline/ui/theme/tokens.css";
@import "@cline/ui/theme/theme.css";
```

For an existing Tailwind v4 surface that must preserve its host shell, keep
Tailwind setup host-owned and add the scoped Cline imports:

```css
@import "@cline/ui/theme/scoped-tokens.css";
@import "@cline/ui/components.css";
```

Render shared components inside `.cline-ui-theme`. Dark values activate when
`.dark` is on that wrapper or an ancestor. `components.css` registers only
package-namespaced Tailwind mappings, so generic host utilities such as
`bg-background`, `text-foreground`, and `rounded-lg` retain their host-defined
meaning outside the wrapper.

Do not import `theme.css` for this scoped setup. That entry point deliberately
registers the complete, generic Cline utility vocabulary and is intended only
for applications that want Cline to own those utility names globally.

The root primitives use package-owned semantic color, typography, radius, and
dark-variant names. Structural utilities still use Tailwind's standard spacing,
shadow, and breakpoint scales; hosts that customize those scales may change
component metrics while their own utility names and token values remain intact.

If the application later opts into Cline's global utility vocabulary and base
behavior, switch to the complete theme setup in Option 1.

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

## Buttons

Import `Button` and `IconButton` from `@cline/ui` after loading the theme and
`@cline/ui/components.css`. Use `primary` for main actions, `secondary` for
supporting actions, and `ghost` for low-emphasis actions. Existing `fill` and
`surface` variants remain aliases for `primary` and `secondary`.

Both controls support `accent`, `neutral`, and `destructive` tones and
`xs`, `sm`, `md`, and `lg` sizes. `Button` defaults to primary/accent/md;
`IconButton` defaults to ghost/neutral/sm.

Both controls use the same height and corner radius for each size:

| Size | Height with `--spacing: 0.25rem` | Corner radius |
| --- | --- | --- |
| `xs` | `1.75rem` | `--radius-md` |
| `sm` | `2rem` | `--radius-md` |
| `md` | `2.25rem` | `--radius-lg` |
| `lg` | `2.5rem` | `--radius-lg` |

Heights use 7, 8, 9, and 10 spacing units respectively. Icon buttons use the
same dimension for width, keeping them square.

```tsx
import { Button, IconButton } from "@cline/ui";
import { Plus, X } from "lucide-react";

<Button leadingIcon={Plus}>New session</Button>
<Button tone="neutral" variant="secondary">More options</Button>
<IconButton icon={X} aria-label="Close" />
```

Pass SVG components through `leadingIcon`, `trailingIcon`, or `icon`; the button
handles sizing, spacing, and decorative accessibility. Custom icons must forward
SVG props, including `className`. `IconButton` requires an accessible label.
Existing icon children remain supported.

Use `iconTone="muted"` to give managed icons a quieter color while leaving the
label unchanged; the default `"inherit"` follows the button's text color.
Prefer inherited color on solid buttons where the foreground supplies contrast.

Set `loading` to replace the leading icon (or the `IconButton` icon) with a
spinner and expose `aria-busy`. `Button` keeps its label unless `loadingLabel`
is supplied. `loadingIcon` accepts an alternative SVG component, such as
`RefreshCw`; the control owns rotation and respects reduced motion.
Loading does not disable activation: set `disabled={loading}` for an action
that must wait, or leave it enabled when clicking should cancel the operation.
The host owns async work, errors, and the loading state.

```tsx
<Button loading={saving} loadingLabel="Saving…" disabled={saving}>
  Save
</Button>
<Button loading={refreshing} loadingLabel="Cancel refresh"
  onClick={refreshing ? cancelRefresh : refresh}>
  Refresh
</Button>
```

Buttons default to `type="button"`; use `type="submit"` for forms. With `asChild`,
the child's native type behavior is preserved, so set `type="button"` explicitly
when needed. Custom composed children must forward props, refs, and children;
place Radix slot triggers outside the control.

When a `Button` label or icon changes (for example, from “Save” to a loading
spinner and “Saving…”), its width transitions over 180 ms. Fixed and full-width
buttons retain their sizing. Reduced-motion preferences disable the transition.
The host continues to own loading state, labels, and disabled behavior.

Use `className` to override component styles and `pressScale={false}` to disable
press feedback. See the button stories for more examples.

## Badges

`Badge` renders a span by default. Choose a neutral, accent, info, success,
warning, or error tone; a soft or ghost variant; and an `sm`, `xs`, or `xxs` size.
Use `interactive` for a native button with disabled behavior and a button ref.
`BadgeProps` describes the span; `InteractiveBadgeProps` describes the button.

```tsx
<Badge tone="success">Connected</Badge>
<Badge interactive tone="error" onClick={retry}>Retry</Badge>
```

## Switch

Import `Switch` from `@cline/ui` after setting up the theme and
`@cline/ui/components.css`.

```tsx
import { Switch } from "@cline/ui";

<div className="flex items-center gap-2">
  <Switch id="notifications" name="notifications" defaultChecked />
  <label htmlFor="notifications">Enable notifications</label>
</div>;

// For application-owned state:
<Switch
  aria-label="Enable notifications"
  checked={notificationsEnabled}
  onCheckedChange={setNotificationsEnabled}
/>;
```

Provide a visible label or an accessible name with `aria-label`. Keep the name
stable when toggling; the native checked state communicates whether the switch
is on. The control supports Space activation and label clicks.

Native input props, including `disabled`, `required`, `form`, `name`, `value`,
`onChange`, and accessible naming attributes, apply to the checkbox. Refs target
`HTMLInputElement`. `className`, `style`, and `hidden` apply to the outer wrapper;
`dir` applies to both the input and wrapper and supports RTL placement. Wrapper
layout defaults use the CSS components layer, so Tailwind utilities such as
`hidden`, `w-20`, and `h-10` can override them. Changing the wrapper dimensions
changes the hit area; the visual track keeps its own size.

Use `defaultChecked` for browser-owned state or `checked` with
`onCheckedChange` for controlled state. If both callbacks are supplied,
`onChange` runs first, then `onCheckedChange` receives the new boolean value.
Uncontrolled switches follow native form reset behavior; controlled switches
must be reset by their owner. Disabled switches, including those in disabled
fieldsets, are excluded from form submission.

Use `pending={saving}` for a temporary lock that retains the current checked or
unchecked appearance and sets `aria-busy`. Pending still disables the native
input, including within a disabled fieldset, so it cannot toggle and is omitted
from form submission. Explicit `disabled` takes precedence over pending's visual
treatment; reserve it for unavailable controls instead of repeating the saving
condition in both props.

```tsx
<Switch checked={enabled} pending={saving} disabled={!canEdit}
  onCheckedChange={setEnabled} aria-label="Enable schedule" />
```

The default `size="md"` preserves the original switch dimensions. Use
`size="sm"` for a compact switch. Both sizes scale with the root font size and
reserve a minimum 24px hit area on each axis.

The default `tone="accent"` uses the shared accent colors. Use `tone="neutral"`
for a checked track that is dark in light mode and light in dark mode. Both tones
support keyboard focus, forced colors, and reduced motion.

When migrating from the desktop's Radix wrapper, update button refs to
`HTMLInputElement` and read the native `checked` property in tests instead of
`aria-checked`. Continue using `checked` and `onCheckedChange` for controlled
state. Radix's `asChild`, children, and `data-state`/`data-disabled` hooks are not
provided. State selectors belong on the native input (`:checked`, `:disabled`,
`:focus-visible`); wrapper classes cannot use input-only pseudo-classes or act
as a checked `peer` for sibling labels. Use a visible label's `htmlFor` and the
input's `id` for association. Space toggles the switch; Enter follows native
checkbox behavior.

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

Theme authors can tune the visual hierarchy without rewriting component
semantics:

```css
:root,
.dark {
  --surface-1: var(--neutral-1);
  --surface-2: var(--neutral-2);
  --focus-ring: var(--accent-8);
}
```

See [Theme usage](./README.md#theme-usage) for palette generation and choosing
readable text and fill roles.

Use the small `--brand-*` palette only for branded artwork. Normal controls
should prefer visual/status roles or shadcn semantic tokens so they continue to
work across light, dark, and future theme layers.

## Radius utilities

Use `rounded-cline-ui-lg` and other `rounded-cline-ui-*` theme sizes in
shared components. They use Cline's radius tokens without taking over the
host application's `rounded-lg` utility. Desktop's equivalent utilities
resolve to the same radius values. Keep structural shapes such as
`rounded-full` unchanged; there is no `rounded-cline-ui-full` token.

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
- Keep Cline-owned palette values in `palette.css` and author UI through visual
  or status roles
- Keep `tokens.css` framework-neutral
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

Likely follow-up components should be driven by repeated needs. Approval cards,
follow-up questions, attachments, and prompt composers are candidates, but their
current product contracts should be compared before standardizing them.

## Useful references

- [Package README](./README.md)
- [Agent-chat components](./components/agent-chat/index.tsx)
- [Agent-chat styles](./components/agent-chat/agent-chat.css)
- [Tokens](./theme/tokens.css)
- [Palette](./theme/palette.css)
- [Tailwind mappings](./theme/theme.css)
- [Optional base styles](./theme/base.css)
- [Complete theme](./theme/index.css)
- [Package manifest](./package.json)
- [Desktop theme integration test (monorepo)](https://github.com/cline/cline/blob/main/apps/examples/desktop-app/webview/styles/theme-integration.test.ts)

## Conversation layout and header

`AgentConversationLayout` takes host-rendered `welcomeHeader`, `body`, `composer`,
`notice`, `welcomeSetup`, and `welcomeFooter` slots. `AgentSessionContent`
provides the shared content width; `AgentConversationHeader` groups title/status
children with optional `actions`. Import `components.css` and theme tokens as
described above.

`welcome` selects the layout; the body remains mounted when hidden.
`hideWelcomeComposer` hides the welcome composer without unmounting it, but
switching layouts can remount the composer. Keep drafts in host state.
`bodyClassName` accepts host animation classes. Hosts retain scrolling, title
editing, menus, native title-bar behavior, and all event handlers.

## Composer presentation

`AgentComposer` and its body, field, textarea, action, attachment-list, and
settings primitives preserve the desktop composer's welcome/conversation
presentation. They render the original native elements without extra wrappers;
refs and native event/ARIA props forward to those elements. Import
`@cline/ui/components.css` and the shared tokens as described above.

Compose the host's PR bar before `AgentComposerBody`. Inside the body, render
`AgentPromptQueue`, the host's suggestion positioning wrapper and
`AgentComposerField` (textarea and actions), feedback, and optional
`AgentComposerAttachments`, in that order. Nested variant-aware primitives
inherit the `AgentComposer` variant unless they set an explicit override. Pass
`hasQueue` to the body. Render model/settings controls in
`AgentComposerSettingsGroup`, with workspace/usage controls in
`AgentComposerSettingsEnd`, both inside `AgentComposerSettings`.

The host owns draft state, textarea sizing, IME/keyboard/paste behavior, focus
forwarding, suggestion menus, attachment chips and uploads, queue operations,
model/settings popovers, voice controls, and send/stop callbacks and visibility.
The shared send/stop buttons style host-provided children; supply their accessible
labels, titles, `type="button"`, disabled state, and handlers. This is an additive
presentation API, not a runtime composer or a form with implicit submission.

## Session rows

`AgentSessionRow`, `AgentSessionRowEditor`, and `AgentSessionOverview` are
exported from `@cline/ui`. Import `components.css` with the shared theme (or
scoped tokens inside `.cline-ui-theme`) as for the other root components.

The row owns the desktop row geometry, selected/hover appearance, timestamp
placement, and pending/provisioning/running/unread dot precedence. Pass
already-formatted `label` and `timestamp`, optional `leading` icons, a
`pinnedIndicator`, and an `action` element. The action remains a sibling of the
navigation button; the host supplies its hover/focus styles, disabled state,
accessible label, and event cancellation. `onSelect` handles row activation.
Root DOM props and refs pass through to the existing wrapper so host-owned
hover-card/context-menu triggers can use `asChild` without another DOM node.

By default, the navigation control is the same native `button` used by desktop.
For URL-addressable navigation, use `renderControl` to render the supplied
class and row content through the host's link component. The optional action
stays a sibling:

```tsx
<AgentSessionRow
  label={session.title}
  timestamp={session.updatedLabel}
  action={<DeleteSessionButton session={session} />}
  renderControl={({ className, children }) => (
    <Link
      className={className}
      href={`/sessions/${session.id}`}
      target="_blank"
    >
      {children}
    </Link>
  )}
/>
```

The host link owns `href`, click, accessibility, disabled, and router behavior.
`disabled` and `onSelect` apply only to the default desktop button.

`AgentSessionRowEditor` provides the matching edit frame; the host still owns
the input, focus, Enter/Escape/blur handling, and saving indicator.
`AgentSessionOverview` presents a title and `[label, value, fullValue?]` metadata
rows inside the host's hover card. Formatting, open state, positioning, context
menus, pin/fork/delete permissions, routing, grouping, and persistence stay in
the application. These primitives do not add new statuses or cloud actions.

## Context usage

`AgentContextUsage` extracts the desktop context ring and detail body without
changing the host's button, popover, positioning, focus, or dismissal behavior.
It does not insert a wrapper. Import `components.css` and the appropriate theme
tokens as usual. When the context limit or token usage is unavailable, it renders
nothing and does not invoke the child callback.

```tsx
import { AgentContextUsage } from "@cline/ui";

<AgentContextUsage
  usage={{ tokensIn: 1200, tokensOut: 300, cacheReadTokens: 400, contextWindow: 200000 }}
  costLabel="$0.014"
>
  {({ triggerLabel, ring, details }) => (
    <HostPopover>
      <HostPopoverTrigger asChild>
        <HostButton aria-label={triggerLabel}>{ring}</HostButton>
      </HostPopoverTrigger>
      <HostPopoverContent>{details}</HostPopoverContent>
    </HostPopover>
  )}
</AgentContextUsage>;
```

The `Host*` names above are host controls, not package exports. Desktop retains
its existing trigger classes, IDs, top/end placement, eight-pixel offset, and
Radix interaction. The shared body uses namespaced utilities mapped to the same
desktop tokens. Current request input/output drives context pressure and the
existing 50%/75% warnings; lifetime token traffic must not be passed as context
usage. `costLabel` is a separate optional, host-formatted cumulative cost.
Fetching metrics, choosing the model limit, and computing cumulative cost remain
host responsibilities.

## Message scroller

Use `@cline/ui/components/message-scroller` with React 19 for transcripts that
anchor new user turns and preserve the reader's position during streaming.
The behavior comes from `@shadcn/react`; the shared wrapper adds Cline styles.
Import `@cline/ui/components.css`, or import
`@cline/ui/components/message-scroller.css` with theme tokens for a plain CSS
host. Place the scroller in a parent with a constrained height.

```tsx
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@cline/ui/components/message-scroller";

function Transcript({ messages }) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
      <MessageScroller>
        <MessageScrollerViewport aria-label="Conversation">
          <MessageScrollerContent>
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                {message.content}
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
        <Outline messages={messages} />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function Outline({ messages }) {
  const { scrollToMessage } = useMessageScroller();
  const { currentAnchorId } = useMessageScrollerVisibility();
  return (
    <nav aria-label="Transcript outline">
      {messages.filter((message) => message.role === "user").map((message) => (
        <button
          key={message.id}
          type="button"
          aria-current={currentAnchorId === message.id ? "location" : undefined}
          onClick={() => scrollToMessage(message.id, { align: "start" })}
        >
          {message.content}
        </button>
      ))}
    </nav>
  );
}
```

Every direct transcript child, including tool groups, loading rows, and
approval panels, must be a `MessageScrollerItem`. Use stable IDs to support
jumps and reader-position tracking. A collapsed tool group can keep the same
row ID as its expanded form. The host chooses which rows anchor turns and
which messages appear in its outline; transport and session state remain in
the app. Key the provider by session ID when switching transcripts.
