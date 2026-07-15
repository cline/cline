# `@cline/ui`

Shared, framework-independent UI foundations for Cline web products. The
package is internal to this monorepo while the first consumers settle the
contract; it is not part of the public SDK release yet.

## Theme entry points

| Import | Contents | Requires Tailwind |
| --- | --- | --- |
| `@cline/ui/theme/tokens.css` | Light/dark custom properties only; no native `color-scheme` policy | No |
| `@cline/ui/theme/theme.css` | Tailwind v4 semantic mapping and dark variant | Yes |
| `@cline/ui/theme/base.css` | Optional base, Markdown, scrollbar, selection, and cursor styles; import after tokens and theme | Yes |
| `@cline/ui/theme/index.css` | Complete theme: tokens, Tailwind mapping, and base styles | Yes |

The token-only entry point has no React, Tailwind, font-package, or desktop
runtime dependency. Apps provide Schibsted Grotesk and Azeret Mono themselves,
which lets each bundler control font loading and asset emission.

## Usage

For a Tailwind v4 app, import framework and consumer dependencies first:

```css
@import "@fontsource-variable/schibsted-grotesk";
@import "@fontsource/azeret-mono/latin.css";
@import "tailwindcss";
@import "@cline/ui/theme/index.css";
```

An app that only needs the framework-neutral values can import just:

```css
@import "@cline/ui/theme/tokens.css";
```

The theme follows the standard shadcn semantic contract (`--background`,
`--foreground`, `--card`, `--primary`, `--border`, `--ring`, charts, and
sidebar surfaces) and Tailwind theme names (`--font-sans`, `--font-mono`,
`--font-weight-*`, and `--text-*`). This means shadcn components and normal
Tailwind utilities inherit the Cline defaults without `cline-*` adapters.

Brand artwork may use the small extension set (`--primary-emphasis` and the
`--brand-*` palette). Product components should prefer semantic variables.

## Layering and compatibility

- Import the Cline theme after Tailwind so its default typography values win.
- Override `:root` or `.dark` after the package import for a deliberate product
  variation; do not rename the default contract.
- `base.css` is optional because it includes opinionated Markdown and global
  interaction styles. When importing files individually, load `tokens.css`,
  then `theme.css`, then `base.css`. Token-only consumers do not receive resets
  or `color-scheme`; import the base layer or declare `color-scheme` locally so
  native controls follow the selected light/dark theme.
- Shell-specific layout such as `#__next`, viewport locking, and app animation
  keyframes stays with each consumer.
- Contract changes should include a compatibility note and a consumer build.

Tailwind theme variables are CSS-first and designed to be shared through an
imported stylesheet. See the
[Tailwind theme variable documentation](https://tailwindcss.com/docs/theme#sharing-across-projects).
