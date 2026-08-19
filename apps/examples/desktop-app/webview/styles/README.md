# Cline web visual foundation

The shared visual contract now lives in the internal
[`@cline/ui`](../../../../../sdk/packages/ui/README.md) workspace package
instead of beside the desktop app.

The desktop imports the complete `@cline/ui/theme/index.css` entry point. Other
Cline surfaces can import `@cline/ui/theme/tokens.css` without React or
Tailwind, or compose the Tailwind adapter and optional base styles in order.
Consuming apps still own their font files and shell-specific layout.
