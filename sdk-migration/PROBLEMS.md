# SDK Migration — Known Issues & Verification Tracker

This file tracks problems found during the migration. Each problem
has a status and verification evidence. Problems are never marked
🟢 without evidence.

## Status Legend

- 🔴 **Blocker** — prevents core functionality
- 🟡 **Minor** — cosmetic or UX annoyance
- 🔵 **Awaiting Verification** — fix attempted, not yet verified
- 🟢 **Verified Fixed** — fix confirmed with evidence

## Known Issues From Previous Attempt

These issues were present in the second migration attempt. They
are listed here as a reference for what to watch out for. They
do not necessarily apply to this attempt's codebase, but the
underlying patterns that caused them are relevant.

### Auth & Account (Highest Risk Area)

| ID | Description | Status |
|----|-------------|--------|
| A1 | Inference works when appearing logged out | Carried pattern |
| A2 | Inference NOT working when appearing logged in | Carried pattern |
| A3 | Login button does nothing or opens wrong URL | Carried pattern |
| A4 | Logout button does nothing | Carried pattern |
| A5 | Profile/credits/history not displayed when logged in | Carried pattern |
| A6 | Error messages instead of login buttons when actually logged out | Carried pattern |
| A7 | Hardcoded `app.cline.bot` instead of `{appBaseUrl}` | Carried pattern |
| A8 | `workos:` prefix inconsistency on account IDs | Carried pattern |
| A9 | Org switching doesn't update inference profile | Carried pattern |
| A10 | Low credit balance persists after switching orgs | Carried pattern |

### gRPC Thunking

| ID | Description | Status |
|----|-------------|--------|
| G1 | Stubbed handlers return `{data:{}}` causing webview crashes | Carried pattern |
| G2 | Proto field name mismatches (e.g., `taskId` vs `id`) | Carried pattern |
| G3 | Streaming subscriptions race condition | Carried pattern |
| G4 | "SDK mode" vs "classic mode" confusion | Addressed by design |

### Feature Removal

| ID | Description | Status |
|----|-------------|--------|
| F1 | Empty `if (request.type === "workflow") {}` blocks | Carried pattern |
| F2 | Features marked "legacy" instead of actually removed | Carried pattern |
| F3 | Workflows tab still in Cline Rules modal | Carried pattern |
| F4 | Terminal settings show IDE terminal options | Carried pattern |

### UI / Webview

| ID | Description | Status |
|----|-------------|--------|
| U1 | Copy button obscured by code blocks | Carried pattern |
| U2 | Token usage bar shows 0/0 | Carried pattern |
| U3 | Input text not cleared immediately on send | Carried pattern |
| U4 | Task history items not clickable | Carried pattern |
| U5 | MCP server management buttons are no-ops | Carried pattern |
| U6 | MCP Marketplace never loads | Carried pattern |
| U7 | Tool output rectangles appear blank | Carried pattern |

## New Issues

*Add issues found during this attempt below this line.*

<!-- Template:
### [ID] Title
- **Status**: 🔴/🟡/🔵/🟢
- **Description**: What's wrong
- **Root cause**: If known
- **Fix**: If attempted, with file references
- **Verification**: How to verify (test name, harness command)
- **Evidence**: Test output, screenshot, etc. (required for 🟢)
-->