# Desktop end-to-end tests

Run `bun run build:sdk` from the repository root, then `bun -F @cline/code test:e2e`.

- `welcome-chat.spec.ts` exercises the rendered welcome view.
- `resident-session.spec.ts` exercises the browser's native WebSocket connection to a real desktop sidecar, Hub, runtime, and session storage. It creates a conversation, restarts only the sidecar while the Hub retains the session, reopens the same ID, resumes it through the CLI's `createCliCore` client, and sends another desktop turn while that client remains connected. It verifies all four turns and retained history. This is protocol-level E2E coverage, not composer/history-picker or terminal UI coverage.

The resident-session fixture uses temporary storage, dynamic loopback ports, and a deterministic local model endpoint. It requires no provider credentials and does not reuse the installed Hub. Child processes and fixture storage are cleaned up at test completion. Backend diagnostics are attached to the Playwright results.

This regression test protects the behavior restored on main by #14665: reopening a resident session succeeds, preserves its ID and history, and allows subsequent turns from desktop and CLI. It previously reproduced the `session already exists` regression introduced by #14501. It runs against the checked-out SDK without runtime patches, skips, or expected failures.
