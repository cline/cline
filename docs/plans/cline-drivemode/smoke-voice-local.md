# Smoke · Voice local profile

Back to [TASK-GRAPH](./TASK-GRAPH.md) phase 3 gate.

## Preconditions

- Ollama (or openai-compatible loopback) configured in Cline
- `runtime.profile=local` (or Drive Settings → Local)
- Mic permission available

## Steps

1. Enter Drive mode in hub Chat.
2. Confirm Settings STT list disables `builtin.webSpeech`.
3. Arm mic. Confirm capture path is MediaRecorder / local-worker (not `webkitSpeechRecognition`).
4. Speak a short task (or paste text if worker stub not wired). Submit.
5. Leave Drive. Confirm no audio/transcript files under `.cline/drive/` beyond facets/registry.

## Pass

- [ ] Web Speech not constructed under local
- [ ] Utterance text uses the same submit path as typed chat
- [ ] Privacy: no audio artifacts on disk
