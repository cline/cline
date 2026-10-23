# Composer, model, attachments and voice

Verification cases for the current Cloud-only iOS app. These are required observable behaviors, not claims of completed E2E coverage.

## Sub-features

- **DRAFT-01 — Home draft editing**.
- **DRAFT-02 — Chat draft editing**.
- **DRAFT-03 — Empty and whitespace submission**.
- **DRAFT-04 — Rapid double send**.
- **DRAFT-05 — Typing during agent work**.
- **DRAFT-06 — Keyboard transition**.
- **DRAFT-07 — Home logo while typing**.
- **DRAFT-08 — Draft through drawer**.
- **DRAFT-09 — Initial draft handoff**.
- **DRAFT-10 — Initial draft recovery**.
- **MODEL-01 — Home model selection**.
- **MODEL-02 — Model search cancel**.
- **MODEL-03 — Provider catalog switch**.
- **MODEL-05 — Chat model change**.
- **MODEL-06 — Model lock while running**.
- **MODEL-07 — Catalog errors**.
- **MODEL-08 — Reasoning supported model**.
- **MODEL-09 — Reasoning unsupported model**.
- **ATTACH-01 — Attachment menu cancel**.
- **ATTACH-02 — Photo select and remove**.
- **ATTACH-03 — Photo picker cancel and permission denial**.
- **ATTACH-04 — Photo count and size limits**.
- **ATTACH-05 — Image-only and incompatible model**.
- **ATTACH-06 — Captioned image send and retry**.
- **ATTACH-07 — Text file insertion**.
- **ATTACH-08 — Invalid text file**.
- **ATTACH-09 — Text picker cancellation and stale completion**.
- **VOICE-01 — No unsolicited microphone**.
- **VOICE-02 — Permission allow and dictation**.
- **VOICE-03 — Permission deny and recovery**.
- **VOICE-04 — Silence and retry**.
- **VOICE-05 — Selection replacement**.
- **VOICE-06 — Navigation during recording**.

## How to get to it (user POV)

Use the Home or chat composer. Tap the model label for model/think settings; Add attachment for Photo library or Text file; tap the microphone only for dictation cases.

## Driving it with Maestro

Preconditions: run the skill doctor against the intended full app and use a private evidence directory. Select the cases whose fixtures are available; record unavailable fixtures as blocked.

### DRAFT-01 — Home draft editing

**Preconditions:** Signed-in Home

**Actions:** Type, select and replace text, add newlines, dismiss and reopen keyboard.

**Prove:** Draft remains editable; cursor and text remain stable; no automatic send.

### DRAFT-02 — Chat draft editing

**Preconditions:** Accessible existing chat

**Actions:** Type a multiline draft and dismiss/reopen the keyboard.

**Prove:** Text and selection remain coherent; composer stays reachable.

### DRAFT-03 — Empty and whitespace submission

**Preconditions:** Home and chat composers

**Actions:** Clear text; try empty and whitespace-only submission.

**Prove:** No request or cloud session is created.

### DRAFT-04 — Rapid double send

**Preconditions:** Disposable test repo and chat

**Actions:** Enter one read-only prompt and tap Send twice quickly.

**Prove:** Exactly one user turn and one new workspace where applicable.

### DRAFT-05 — Typing during agent work

**Preconditions:** Disposable active session

**Actions:** While agent runs, type a follow-up.

**Prove:** Shows Add a follow-up; draft stays editable and stop remains available.

### DRAFT-06 — Keyboard transition

**Preconditions:** Portrait and landscape Home/chat

**Actions:** Open and close keyboard repeatedly, including immediately after Send.

**Prove:** Composer follows keyboard without slow second slide, overlap, blank gap or lost draft.

### DRAFT-07 — Home logo while typing

**Preconditions:** Portrait Home

**Actions:** Focus composer, type and dismiss keyboard.

**Prove:** Cline logo retains its intended size and theme; it does not fade out just because keyboard opens.

### DRAFT-08 — Draft through drawer

**Preconditions:** Home and chat with a typed draft

**Actions:** Open/close sidebar and rotate while it is open.

**Prove:** Unsent draft survives; no accidental submission.

### DRAFT-09 — Initial draft handoff

**Preconditions:** Disposable repo and prompt

**Actions:** Send from Home; follow provisioning into Chat.

**Prove:** Original text/attachments appear once. Composer clears on local submission; delivery failure remains recoverable through the failed message Retry action.

### DRAFT-10 — Initial draft recovery

**Preconditions:** Disposable job interrupted during provisioning

**Actions:** Leave and reopen the app, then open the provisioning task.

**Prove:** Recoverable text is retained for text-only starts. For image-bearing starts, never auto-send a caption without its image; explicitly inspect recovery UX after eviction (a current source-review gap).

### MODEL-01 — Home model selection

**Preconditions:** Signed-in Home with catalog access

**Actions:** Open model control, search known model and choose it.

**Prove:** Selected model label updates; provider/model identity is unambiguous.

### MODEL-02 — Model search cancel

**Preconditions:** Home and existing chat

**Actions:** Search a no-match term; clear; dismiss without choosing.

**Prove:** No-results state is readable; dismissal retains the previous model.

### MODEL-03 — Provider catalog switch

**Preconditions:** Available catalog subscriptions

**Actions:** Switch provider/catalog, select model, reopen sheet.

**Prove:** Correct catalog stays selected; identical display names do not select the wrong ID.

### MODEL-05 — Chat model change

**Preconditions:** Idle disposable cloud chat

**Actions:** Choose a supported different model then send a read-only prompt.

**Prove:** Server uses the requested model and the visible selection agrees.

### MODEL-06 — Model lock while running

**Preconditions:** Active disposable cloud chat

**Actions:** Open model selector while run is active.

**Prove:** Unsupported changes are disabled with a clear reason; current run is not altered unexpectedly.

### MODEL-07 — Catalog errors

**Preconditions:** Controlled network failure

**Actions:** Open model list offline; reconnect and Retry.

**Prove:** Error and retry appear without losing current preference.

### MODEL-08 — Reasoning supported model

**Preconditions:** Model declaring reasoning support

**Actions:** Open thinking-level control, change level, then send.

**Prove:** Choice is reflected in UI and request; fixed application reasoning choices are available only when the model declares reasoning support. Per-model level discovery is not implemented.

### MODEL-09 — Reasoning unsupported model

**Preconditions:** Model without reasoning support

**Actions:** Switch from supported to unsupported model.

**Prove:** Stale reasoning setting is not sent; unavailable control is disabled or absent.

### ATTACH-01 — Attachment menu cancel

**Preconditions:** Home and chat with draft

**Actions:** Open Add attachment; cancel.

**Prove:** Native action sheet offers Photo library and Text file; draft is unchanged.

### ATTACH-02 — Photo select and remove

**Preconditions:** Synthetic image in simulator photo library

**Actions:** Choose image, verify thumbnail, remove it.

**Prove:** Correct thumbnail appears and removal affects only that attachment.

### ATTACH-03 — Photo picker cancel and permission denial

**Preconditions:** Isolated simulator or test permissions

**Actions:** Cancel picker; deny photo permission where prompted.

**Prove:** No draft loss; permission failure provides a usable next step.

### ATTACH-04 — Photo count and size limits

**Preconditions:** Synthetic small images plus oversized image

**Actions:** Attach up to four images; attempt a fifth or oversized selection.

**Prove:** Limits are enforced with an explanation; existing attachments stay intact.

### ATTACH-05 — Image-only and incompatible model

**Preconditions:** Test image; model lacking image support

**Actions:** Attempt image-only send, then captioned send with unsupported model.

**Prove:** Requires caption and rejects known unsupported model; does not silently drop image.

### ATTACH-06 — Captioned image send and retry

**Preconditions:** Disposable session and image-capable model

**Actions:** Send image plus caption; simulate failed delivery and retry.

**Prove:** Both arrive once; failed bubble retains full attachment payload.

### ATTACH-07 — Text file insertion

**Preconditions:** Synthetic UTF-8 text file under 128 KB

**Actions:** Choose Text file; insert while preserving existing text.

**Prove:** Filename and contents become editable draft text; source file remains unchanged.

### ATTACH-08 — Invalid text file

**Preconditions:** Empty, binary or over-128-KB synthetic files

**Actions:** Select each invalid file in turn.

**Prove:** Specific validation error; draft remains unchanged and picker can be retried.

### ATTACH-09 — Text picker cancellation and stale completion

**Preconditions:** Editable draft and native picker

**Actions:** Cancel; then pick while draft changes or navigate away.

**Prove:** No stale overwrite or mutation after unmount; returning composer remains usable.

### VOICE-01 — No unsolicited microphone

**Preconditions:** Fresh Home and existing chat

**Actions:** Launch/reopen app and switch between new and existing sessions without tapping mic.

**Prove:** No microphone activation or No speech detected error appears spontaneously.

### VOICE-02 — Permission allow and dictation

**Preconditions:** Physical test device with microphone

**Actions:** Tap mic; allow speech/microphone; speak; stop.

**Prove:** Transcript appears in editable draft only; nothing is automatically sent.

### VOICE-03 — Permission deny and recovery

**Preconditions:** Isolated permission state

**Actions:** Deny mic/speech, retry, then grant through Settings.

**Prove:** Clear recovery guidance; input remains usable; no stuck listening state.

### VOICE-04 — Silence and retry

**Preconditions:** Microphone permission granted

**Actions:** Start dictation, remain silent, stop and retry with speech.

**Prove:** No-speech message applies only to initiated recording and clears on a new successful attempt.

### VOICE-05 — Selection replacement

**Preconditions:** Draft with selected substring

**Actions:** Dictate over a selection while partial results arrive.

**Prove:** Replaces owned range once; surrounding text remains unchanged.

### VOICE-06 — Navigation during recording

**Preconditions:** Active recording in disposable draft

**Actions:** Navigate to another screen and return.

**Prove:** Recording stops; hidden composers do not receive stale speech/error events.

## Gotchas

Do not send private test files. Use synthetic photos/text, verify permission paths on isolated devices, and restore any changed preference. Speech quality and physical microphone behavior need real hardware.

Run all distinct entry points named above. Evidence must include the actions and resulting state. Track pass/fail/partial/blocked/not-run separately; an automated unit test is not a substitute for this user path.
