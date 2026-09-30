# Desktop end-to-end tests

Run `bun run build:sdk` from the repository root, then `bun -F @cline/code test:e2e`.

- `welcome-chat.spec.ts` exercises the rendered welcome view.
- `resident-session.spec.ts` exercises the browser's native WebSocket connection to a real desktop sidecar, Hub, runtime, and session storage. It creates a conversation, restarts only the sidecar while the Hub retains the session, reopens the same ID, resumes it through the CLI's `createCliCore` client, and sends another desktop turn while that client remains connected. It verifies all four turns and retained history. This is protocol-level E2E coverage, not composer/history-picker or terminal UI coverage.

The resident-session fixture uses temporary storage, dynamic loopback ports, and a deterministic local model endpoint. It requires no provider credentials and does not reuse the installed Hub. Child processes and fixture storage are cleaned up at test completion. Backend diagnostics are attached to the Playwright results.

This regression test fails with `session already exists` on the runtime introduced by #14501. It passes with #14665's runtime rollback; merge that fix before expecting the regression test to pass in CI. The test does not patch the runtime, skip the failure, or mark it as expected.
