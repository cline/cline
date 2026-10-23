# Conversation runtime and transcript

Verification cases for the current Cloud-only iOS app. These are required observable behaviors, not claims of completed E2E coverage.

## Sub-features

- **CHAT-01 — Streaming completion**.
- **CHAT-02 — Stop run**.
- **CHAT-03 — Queue follow-up**.
- **CHAT-04 — Edit and cancel queue edit**.
- **CHAT-05 — Remove queued prompt**.
- **CHAT-06 — Steer queued prompt now**.
- **CHAT-07 — Question options and custom answer**.
- **CHAT-08 — Approval allow and deny**.
- **CHAT-09 — Reconnect with pending interactions**.
- **CHAT-10 — Delivery failure and retry**.
- **CHAT-11 — Foreground and process restart**.
- **CHAT-12 — History scroll and jump**.
- **CHAT-13 — Copy and timestamps**.
- **CONTENT-01 — Markdown and code**.
- **CONTENT-02 — Reasoning collapse and long output**.
- **CONTENT-03 — Tool results and errors**.
- **CONTENT-04 — Diff expansion**.
- **CONTENT-05 — Generated image viewer**.
- **CONTENT-06 — Generated audio/video**.
- **CONTENT-07 — Branch review link**.

## How to get to it (user POV)

Open a disposable or read-only test session from the sidebar. Message composer sends input; Abort stops a run. Pending approvals/questions open their sheets. Message controls handle copy/timestamps, media and branch review.

## Driving it with Maestro

Preconditions: run the skill doctor against the intended full app and use a private evidence directory. Select the cases whose fixtures are available; record unavailable fixtures as blocked.

### CHAT-01 — Streaming completion

**Preconditions:** Disposable read-only cloud session

**Actions:** Send a prompt and observe text/tool progress until completion.

**Prove:** One ordered transcript; final response and idle/completed status agree with server.

### CHAT-02 — Stop run

**Preconditions:** Disposable active run

**Actions:** Tap Abort while streaming.

**Prove:** Stop acknowledgment is reflected; composer remains usable and no duplicate turn starts.

### CHAT-03 — Queue follow-up

**Preconditions:** Active disposable run

**Actions:** Send a second prompt while first runs.

**Prove:** Follow-up queues visibly and runs once in the correct order.

### CHAT-04 — Edit and cancel queue edit

**Preconditions:** Queued disposable prompt

**Actions:** Edit queued item; cancel; edit again and save.

**Prove:** Cancel preserves original; Save changes the queued request and displayed text.

### CHAT-05 — Remove queued prompt

**Preconditions:** Queued disposable prompt

**Actions:** Remove one queue entry.

**Prove:** Removed prompt never executes; other entries retain order.

### CHAT-06 — Steer queued prompt now

**Preconditions:** Active disposable run and queue

**Actions:** Use Send now on a queued item.

**Prove:** Steering reaches current run once and queue accurately reflects removal.

### CHAT-07 — Question options and custom answer

**Preconditions:** Controlled cloud session asking a question

**Actions:** Open question; choose an option; repeat with a custom answer.

**Prove:** Answer is delivered once and pending question clears; empty answer cannot submit.

### CHAT-08 — Approval allow and deny

**Preconditions:** Controlled cloud task with server auto-approval disabled AND an existing saved native Ask policy; default production policy automatically responds and will not expose this manual flow.

**Actions:** Review pending approval; approve one, deny another with optional reason.

**Prove:** Exactly one decision per request; denied action does not run; failure remains retryable.

### CHAT-09 — Reconnect with pending interactions

**Preconditions:** Disposable chat with queued/question state; manual approval branch also needs server auto-approval disabled and saved native Ask policy.

**Actions:** Disconnect network and reconnect.

**Prove:** Pending items reconcile with server without duplicate actions or lost transcript.

### CHAT-10 — Delivery failure and retry

**Preconditions:** Controlled failure before request acceptance

**Actions:** Send; observe failed optimistic bubble; tap Retry.

**Prove:** Message payload preserved; succeeds exactly once and clears failed state.

### CHAT-11 — Foreground and process restart

**Preconditions:** Existing active disposable cloud session

**Actions:** Background app during work, return, then force-close/reopen.

**Prove:** Reconnects to same session/history; finished response is present; prompt is not resent.

### CHAT-12 — History scroll and jump

**Preconditions:** Long existing test transcript

**Actions:** Scroll into earlier turns while new output arrives; use Jump to latest.

**Prove:** Scroll position is respected until explicit jump; latest response becomes visible.

### CHAT-13 — Copy and timestamps

**Preconditions:** Existing synthetic transcript

**Actions:** Copy user and assistant text; reveal/hide timestamp.

**Prove:** Clipboard content matches selected message; timestamp belongs to that message.

### CONTENT-01 — Markdown and code

**Preconditions:** Synthetic transcript with headings/list/table/code/link

**Actions:** Read and scroll each block, including long code in landscape.

**Prove:** Content is readable, selectable as supported, and not clipped into controls.

### CONTENT-02 — Reasoning collapse and long output

**Preconditions:** Transcript containing reasoning and long tool output

**Actions:** Expand/collapse reasoning and truncated tool output.

**Prove:** Visibility changes without changing the transcript or scrolling to an unrelated turn.

### CONTENT-03 — Tool results and errors

**Preconditions:** Controlled read-only tool success/failure

**Actions:** Open tool cards and inspect error/result details.

**Prove:** Tool identity, status and result match synthetic fixture events; media payloads are redacted as intended. Arbitrary tool-output secret redaction is not a claimed feature.

### CONTENT-04 — Diff expansion

**Preconditions:** Synthetic test transcript with file diff

**Actions:** Expand and collapse diff; inspect changed lines.

**Prove:** Additions/deletions and file names render correctly, with safe horizontal scrolling.

### CONTENT-05 — Generated image viewer

**Preconditions:** Test session returning an image

**Actions:** Load thumbnail, expand, close, retry a failed load.

**Prove:** Correct image opens; close returns to same transcript; failures have retry.

### CONTENT-06 — Generated audio/video

**Preconditions:** Test session returning media

**Actions:** Explicitly load, play, pause, close, navigate away.

**Prove:** No autoplay before user action; playback stops/releases on close or navigation.

### CONTENT-07 — Branch review link

**Preconditions:** Test repo session with known branch

**Actions:** Tap Review branch on GitHub.

**Prove:** Opens matching repository/branch compare URL; no accidental publish or PR creation.

## Gotchas

Real cloud turns and controlled runtime events are required for server-side proofs. Do not equate mocked Hub integration tests with live mobile E2E. Checkpoint fork and computer approval controls are local-only and deferred from this Cloud release.

Run all distinct entry points named above. Evidence must include the actions and resulting state. Track pass/fail/partial/blocked/not-run separately; an automated unit test is not a substitute for this user path.
