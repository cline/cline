# Cline web visual foundation

`design-tokens.css` is the portable layer of the desktop visual system. It
defines brand primitives and semantic light/dark theme variables without
depending on React, Tailwind, or the desktop runtime.

Import it before an app's component styles, then map the semantic variables
(`--background`, `--foreground`, `--primary`, `--border`, and the sidebar
family) into that app's styling framework. Product-specific components should
consume semantic variables; reserve the `--cline-*` primitives for branded
artwork such as the home glow.

The portable `--cline-*` contract also includes the typography scale, font
weights, selection color, and scrollbar colors. The desktop app's canonical
families are self-hosted Schibsted Grotesk for UI copy and Azeret Mono for code,
branches, tokens, and other technical metadata; consuming apps supply the font
files and map these namespaced values into their own framework.
