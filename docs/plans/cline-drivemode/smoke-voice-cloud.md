# Smoke · Voice cloud profile

Back to [TASK-GRAPH](./TASK-GRAPH.md) phase 3 gate.

## Preconditions

- Cloud LLM provider credentials already in Cline
- `runtime.profile=cloud` (default)
- Mic permission available

## Steps

1. Enter Drive mode in hub Chat (no Drive-specific API key entry).
2. Confirm default STT is `builtin.webSpeech` (or compatible cloud STT).
3. Arm mic, speak a short task, submit.
4. Optional: enable TTS, hear narration, mute mid-sentence.
5. Leave Drive. Confirm no unexpected audio persistence.

## Pass

- [ ] No Drive-specific key prompt for LLM
- [ ] Spoken or typed turn reaches the partner
- [ ] Privacy checklist still holds for captions/audio buffers
