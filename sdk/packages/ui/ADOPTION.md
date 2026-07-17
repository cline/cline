# `@cline/ui` adoption primer

This guide is for Cline engineering teams that want a web application to share
the Cline visual language without copying desktop styles or adopting desktop
product structure.

## The short version

`@cline/ui` is a CSS theme foundation, not a React component library.

It provides:

- Light and dark semantic colors
- Standard shadcn token names
- Typography families, sizes, weights, line heights, and letter spacing
- Borders, radii, cards, navigation, sidebar, and chart colors
- Selection and scrollbar values
- A small brand palette for artwork
- Tailwind v4 mappings
- Optional global, interaction, and Markdown styles

Each application continues to own:

- Components and page layouts
- Navigation and product behavior
- Font-file loading
- Framework and runtime integration
- Shell layout and viewport rules
- Product-specific animation
- Deliberate product overrides

This gives Cline web products a shared visual vocabulary without requiring
identical screens.

## Current status

```json
{
  "name": "@cline/ui",
  "version": "0.0.0",
  "private": true,
  "internal": true
}
```

The package is currently available only inside the Cline monorepo. It is not
published to npm and is not part of the public SDK release.

Desktop is the first production-shaped consumer. The next milestone is adoption
by a second Cline web application so the contract can be tested outside the
environment that created it.

## Choose an adoption level

| Goal | Import | Tailwind required |
| --- | --- | --- |
| Use only light/dark CSS variables | `@cline/ui/theme/tokens.css` | No |
| Use tokens through Tailwind utilities | `tokens.css` then `theme.css` | Tailwind v4 |
| Use the complete theme and shared base behavior | `@cline/ui/theme/index.css` | Tailwind v4 |

The package also exports `base.css` separately for consumers that want its
global, Markdown, scrollbar, selection, cursor, and native `color-scheme`
behavior.

There is no root JavaScript export and no `@cline/ui/theme` shorthand. Use the
explicit CSS paths documented below.

## Monorepo setup

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

If the application later opts into the shared base behavior, import
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

Use the small `--brand-*` palette and `--primary-emphasis` for branded
artwork or deliberate emphasis. Normal product controls should prefer semantic
tokens so they continue to work across light, dark, and future theme layers.

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

Do not copy `tokens.css` into the consuming application. Explicit overrides
make product differences reviewable and allow future package upgrades.

## Consumer-owned behavior

Keep the following outside `@cline/ui`:

- Next, Tauri, VS Code, and runtime-specific behavior
- `#__next`, viewport locking, and shell layout
- Application routes and information architecture
- Desktop session, workspace, and sidecar behavior
- Product-specific animation keyframes
- Components that have not been proven reusable by multiple products

The package should standardize visual language, not erase product boundaries.

## Adoption checklist

- [ ] Add `@cline/ui` through `workspace:*`.
- [ ] Choose tokens-only, Tailwind mappings, or the complete theme.
- [ ] Load the required font files.
- [ ] Import files in the documented order.
- [ ] Confirm the application's `.dark` behavior.
- [ ] Put deliberate overrides after package imports.
- [ ] Remove copied local tokens instead of maintaining two sources.
- [ ] Build the application in development and production.
- [ ] Compare representative screens in light and dark modes.
- [ ] Exercise focus, hover, disabled, and native-control states.
- [ ] Record required overrides and any missing shared token.

## Contract and compatibility expectations

Until the package has a stable version, contract changes should:

- Include a compatibility note
- Run package validation and tests
- Build every active consumer
- Include light/dark visual evidence when values change
- Avoid renaming standard shadcn/Tailwind variables
- Keep `tokens.css` framework-neutral
- Keep product-specific layout and runtime behavior out of the package

Removing or changing the meaning of a semantic token should eventually be
treated as a breaking change. Additive tokens and entry points can be introduced
compatibly.

## Publication status and next steps

Separate repositories cannot install `@cline/ui` from npm yet. Publication
requires more than removing `private: true`.

Recommended sequence:

1. Adopt the package in a second Cline web application.
2. Assign design and engineering owners.
3. Define compatibility, browser, Tailwind, and deprecation policies.
4. Add token-only and Tailwind consumer fixtures.
5. Add representative light/dark visual regression coverage.
6. Verify all exports from a packed artifact in a clean consumer.
7. Select an initial version and release cadence.
8. Add changelog, provenance, and npm release automation.
9. Publish a prerelease before declaring the contract stable.

Shared React components can later live under `@cline/ui/components`, but that
should be a separate proposal based on repeated needs across applications. The
CSS token entry point should remain usable without React.

## Useful references

- [Package README](./README.md)
- [Tokens](./theme/tokens.css)
- [Tailwind mappings](./theme/theme.css)
- [Optional base styles](./theme/base.css)
- [Complete theme](./theme/index.css)
- [Package manifest](./package.json)
- [Desktop integration test](../../../apps/examples/desktop-app/webview/styles/theme-integration.test.ts)
