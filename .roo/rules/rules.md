# Code Quality Rules

1. Test Coverage:

    - Before attempting completion, always make sure that any code changes have test coverage
    - Ensure all tests pass before submitting changes

2. Lint Rules:

    - Never disable any lint rules without explicit user approval

3. Styling Guidelines:
    - Use Tailwind CSS classes instead of inline style objects for new markup
    - VSCode CSS variables must be added to webview-ui/src/index.css before using them in Tailwind classes
    - Example: `<div className="text-md text-vscode-descriptionForeground mb-2" />` instead of style objects

# Adding a New Setting

To add a new setting that persists its state, follow the steps in docs/settings.md
