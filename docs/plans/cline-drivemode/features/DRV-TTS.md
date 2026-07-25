# DRV-TTS · Partner voice out

Back to [README](../README.md). Phase 3 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

The partner speaks its narration. The user can look at the code while hearing "tests pass, moving to the parser". Voice out is narration-only. Long answers stay in the feed where they are scannable.

## Acceptance criteria

- Narration messages (and only narration messages) can play as speech via the bundled `voice-selector.tsx` and `audio-player.tsx`.
- TTS is off by default and toggles from the call strip. Mute silences it immediately.
- Voice selection persists as config.
- Playback state emits speaking presence, so the persona chip animates while the partner talks.
- Speech never blocks work. Synthesis and playback are fire-and-forget relative to the turn loop.
- No audio artifacts are written to disk beyond transient buffers, per DRV-PRIVACY.

## Dependencies

- DRV-NARRATION (the content), DRV-MIC (shared audio plumbing and mute), DRV-CALL-STRIP (toggle home).

## Surfaces touched

- `apps/cline-hub/src/webview/src/components/ai-elements/{voice-selector,audio-player}.tsx` (wire)
- `apps/cline-hub/src/webview/src/components/CallStrip.tsx`

## Agent tasks

- [ ] Read the bundled voice components and pick the synthesis path (browser speechSynthesis first, richer engines later).
  - Owner package: `@cline/cline-hub`
  - Files likely: `voice-selector.tsx`, `audio-player.tsx`
  - Verify: written finding with the privacy check (local synthesis preferred)
  - Done when: the synthesis path is chosen.
- [ ] Implement narration playback gated on the TTS toggle and mute state.
  - Owner package: `@cline/cline-hub`
  - Files likely: narration render path in `Chat.tsx`, `CallStrip.tsx`
  - Verify: `bun -F @cline/cline-hub test`, live smoke hearing narration during a task and muting mid-sentence
  - Done when: mute cuts audio immediately on the live surface.
- [ ] Emit speaking presence during playback.
  - Owner package: `@cline/cline-hub`
  - Files likely: playback hook
  - Verify: live smoke, chip shows speaking during playback
  - Done when: presence and playback agree.

## Risks

- Narration cadence may outpace speech (three narrations while one plays). Mitigation. A small playback queue with drop-oldest beyond depth two. Spoken narration is ambient, not archival, and the feed keeps the full record.
