# CLI Development

The CLI lives in `cli-ts/` and uses React Ink for terminal UI.

- If needed, look at `cli-ts/src/constants/colors.ts` for re-used terminal colors, e.g. `COLORS.primaryBlue` highlight color (selections, spinners, success states).
- Never use `dimColor` with gray (e.g. `<Text color="gray" dimColor>`) - it's too hard to read. Use `color="gray"` for secondary text and normal foreground (no color) for primary text.
- When thinking about how to handle state or messages from core, look at webview for how it communicates with the vs code extension.
- When updating the webview, consider and suggest to the user to update the CLI TUI since we want to provide a similar experience to our terminal users as we do our vs code extension users.