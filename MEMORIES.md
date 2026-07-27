# Bug-finder automation memory

Tracked bugs reported by the daily critical-bug automation. Entries only for open or rejected PRs. Delete merged/fixed entries; delete rejected entries older than 30 days.

| Bug (location and root cause) | PR | Status | Recorded |
| --- | --- | --- | --- |
| `sdk/packages/core/src/hub/server/handlers/run-handlers.ts` `handleSessionInput` rejected any `run.start` with an empty prompt before checking attachments, so the desktop app's attachment-only sends (image/file with no text, routed through the shared hub) always failed with `invalid_session_input`. | PR from branch `saoudrizwan/critical-bug-management-4355` (agent run: https://cursor.com/agents/bc-6c5d21c3-9d87-47ad-b240-fc4b2abb15bd) | open | 2026-07-27 |
