# `apps/examples/vscode` (`@cline/vscode`)

VS Code extension that opens a chat webview and runs Cline sessions over the RPC runtime.

## What it does

- Opens a webview panel via `Cline: Open Chat`.
- Ensures a compatible owner-scoped RPC sidecar by running `cline rpc ensure --json`.
- Starts/sends/aborts chat turns using RPC runtime methods (`StartRuntimeSession`, `SendRuntimeSession`, `AbortRuntimeSession`).
- Streams runtime events into the webview for incremental assistant output.

## Requirements

- `cline` must already be installed and available on `PATH`.
- A provider/model should be configured in Cline provider settings.

## Development

```bash
# Build extension bundle
bun -F @cline/vscode build

# Typecheck
bun -F @cline/vscode typecheck
```

To run locally in VS Code:

1. Build the extension: `bun -F @cline/vscode build`.
2. Open `apps/examples/vscode` in VS Code.
3. Press `F5` to launch the Extension Development Host.
4. Run command `Cline: Open RPC Chat`.
