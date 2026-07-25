# DRV-MIC · Mic input and mute

Back to [README](../README.md). Phase 3 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Voice makes it a call. The user talks to the partner instead of typing, hands stay on the code. The mic button in the composer starts and stops listening, and mute is a real room-state control the whole system respects.

## Acceptance criteria

- The bundled `speech-input.tsx` and `mic-selector.tsx` wire into the composer when Drive is on.
- Transcribed utterances enter the same pipeline as typed messages (including the steer queue mid-turn). Voice and text are one input path.
- Mute is enforced hub-side. A muted room drops transcript ingestion, not just the mic UI (the SFU packet-drop analog from the research).
- Audio is processed in memory only. No audio files, no transcript persistence, per the DRV-PRIVACY checklist.
- Speaking presence events drive the persona chip's listening state.
- Mic permission failure degrades cleanly to text with an actionable message.

## Dependencies

- DRV-PARTNER-MVP and the phase 2 gate (voice lands on a working call), DRV-CALL-STRIP (mute control), DRV-STEER-QUEUE (mid-turn voice), DRV-PRIVACY.

## Surfaces touched

- `apps/cline-hub/src/webview/src/components/ai-elements/{speech-input,mic-selector}.tsx` (wire)
- `apps/cline-hub/src/webview/src/components/Composer.tsx`
- `sdk/packages/core/src/hub/collaboration/` (mute-gated transcript ingestion)

## Agent tasks

- [ ] Read `speech-input.tsx` to establish what STT engine it assumes (Web Speech, MediaRecorder upload, or pluggable) and document the local-only constraint fit.
  - Owner package: `@cline/cline-hub`
  - Files likely: `speech-input.tsx`, `mic-selector.tsx`
  - Verify: written finding. If the component ships audio to a cloud API by default, flag it against DRV-PRIVACY and pick the local path.
  - Done when: the STT path is chosen and privacy-checked.
- [ ] Wire mic input into the composer submitting through the normal message path.
  - Owner package: `@cline/cline-hub`
  - Files likely: `Composer.tsx`
  - Verify: `bun -F @cline/cline-hub test`, live smoke speaking a task and watching it submit
  - Done when: a spoken utterance lands in the session identically to a typed one.
- [ ] Enforce mute at the hub. Muted rooms reject transcript ingestion ops with an actionable reason.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/collaboration/ops.ts`, tests
  - Verify: `bun -F @cline/core test:unit`
  - Done when: the mute test proves ingestion stops server-side, not just in UI.
- [ ] Emit speaking presence while the mic is live and verify the persona chip reacts.
  - Owner package: `@cline/cline-hub` and `@cline/core`
  - Files likely: composer mic hook, presence emission
  - Verify: live smoke, chip shows listening while speaking
  - Done when: presence round-trips on the live surface.

## Risks

- Web Speech availability and quality vary by platform and webview. Mitigation. The read-first task decides the engine before wiring, and text input remains the always-working path.
- Accidental hot mic. Mitigation. Listening state is loud in the UI (chip plus strip), and the default is push-to-talk or explicit toggle, never auto-listen on join.
