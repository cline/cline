# DRV-CAPTIONS · Live captions

Back to [README](../README.md). Phase 3 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Captions close the loop on voice. The user sees what the mic heard before the partner acts on it, and sees what the partner is saying without audio on. Captions are the trust surface for STT quality and the accessibility path for voice features.

## Acceptance criteria

- The bundled `transcription.tsx` renders live interim transcription while the user speaks, near the composer.
- The finalized utterance is editable before submission (or auto-submits per a config flag, default confirm-first).
- Partner narration renders a caption line while TTS plays, matching the audio.
- Caption content is transient UI state. Nothing persists beyond the submitted message, per DRV-PRIVACY.

## Dependencies

- DRV-MIC (transcription source), DRV-TTS (narration captions).

## Surfaces touched

- `apps/cline-hub/src/webview/src/components/ai-elements/transcription.tsx` (wire)
- `apps/cline-hub/src/webview/src/components/Composer.tsx`, `CallStrip.tsx`

## Agent tasks

- [ ] Wire interim transcription into the composer area with the confirm-before-submit flow.
  - Owner package: `@cline/cline-hub`
  - Files likely: `Composer.tsx`, `transcription.tsx`
  - Verify: `bun -F @cline/cline-hub test`, live smoke speaking and editing before submit
  - Done when: a misheard word is correctable before the partner sees it.
- [ ] Render the narration caption during TTS playback.
  - Owner package: `@cline/cline-hub`
  - Files likely: caption line in the strip or above the stage
  - Verify: live smoke with TTS on
  - Done when: caption text matches the audio being played.
- [ ] Add the privacy assertion. Captions leave no residue in state or storage after submit or dismiss.
  - Owner package: `@cline/cline-hub`
  - Files likely: component tests
  - Verify: `bun -F @cline/cline-hub test`
  - Done when: unmount tests show no retained transcript state.

## Risks

- Confirm-first adds friction to the voice loop. Mitigation. It is the safe default for trust building. The auto-submit flag exists for users who develop confidence in their STT accuracy.
