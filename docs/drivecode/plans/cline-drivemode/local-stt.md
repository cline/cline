# Local STT worker (loopback whisper)

Back to [08-provider-harness.md](08-provider-harness.md).

## Default

Local / hybrid packs seed:

```json
{
  "baseUrl": "http://127.0.0.1:8080/v1",
  "model": "whisper-1"
}
```

The hub webview posts MediaRecorder audio to
`{baseUrl}/audio/transcriptions` (OpenAI-compatible). Non-loopback URLs are
rejected for `local-worker` backends.

## Run a server

Any OpenAI-compatible local whisper server works. Example with whisper.cpp
HTTP server listening on `8080` and exposing `/v1/audio/transcriptions`.

No API keys belong in Drive facet JSON. Keep secrets out of `.cline/drive/`.

## Failure UX

If the server is down, Drive shows an actionable status string and leaves the
composer usable for typed input.
