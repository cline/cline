# Nerdearla Vibeathon 2026 — Evaluation: giubot/live-subtitles

Repo: https://github.com/giubot/live-subtitles (evaluated at `38d2d7c`, read-only code review, not run)
Demo: https://www.youtube.com/watch?v=c2VMYqNigqA ("Live Subtitles: App Demo"). Length not retrieved: check it against the 2-minute cap by hand.

## Gate: PASS
1. Audio input: browser mic/line-in over `/ws/ingest` (`web/src/features/capture/microphone.ts:61-118`, `internal/audio/ingest/hub.go:177`), a file or http(s)/HLS URL through ffmpeg (`internal/audio/ffmpeg/file.go`), SRT (`internal/audio/ffmpeg/srt.go`). Test clips `testdata/audio/fixtures/{en,es}.wav`, played from `FileSourceDialog.tsx` or `scripts/demo-file.sh`.
2. Transcription: Gemini Live `gemini-3.5-transcribe-live` (`internal/provider/gemini/asr.go:20`, `asr_live.go:78-87`).
3. EN→ES translation: `internal/translate/fanout.go:261-300`, `gemini-3.5-flash-lite` (`translator.go:25`).
4. Display: `/s/$id`, `/stage/$id`, `/overlay/$id`, `/replay/$id`.
5. Two or more sessions: runtime sessions; two-session acceptance test (`internal/app/acceptance_test.go`); scaling covered in `docs/scaling.md`.

## Scores
| Criterion | Score | Closest ref | Reason |
|---|---|---|---|
| Calidad | 3.5 | Glosa/aura = | Gemini baseline; glossary reaches the recognizer (CustomVocabulary) and the translator (prompt + do-not-translate check), with context sentences |
| Latencia | 3.5 | Glosa = | 100 ms streaming, interims, streamed translation partials; measured per component (~1.3–1.5 s final, ~0.7–0.8 s translation), not end to end |
| Escalabilidad | 3.75 | Live Subs/aura + | Runtime rooms, cost per room and language; load test of 10k viewers on one node (mock provider); no shared state across nodes |
| Despliegue y operación | 4.5 | Glosa = | Docker/Compose/healthcheck, releases, ACME/local-CA TLS, argon2 PIN + per-session ingest tokens, Gemini reconnect (15 s buffer) + 9-min rotation, Gemini⇄local fallback, dashboard, Prometheus, SRT/VTT export |
| Innovación | 4.5 | Glosa = | Offline Whisper+Gemma with hardware benchmark and fallback, SRT ingest, OBS SendStreamCaption + YouTube CC, recording + replay, live caption correction, stage screen with QR |
| **Total** | **19.75/25** | | **Promedio 3.95** |

## Confirmed weaknesses
- Ingest token in the capture URL `?token=` (`hub.go:177`). Quick fix.
- `POST /api/setup` is public until the PIN is set (`openapi.yaml:150-154`, `auth.go:141`). Quick fix.
- Recordings/audio endpoints are public (`openapi.yaml:958-1021`). Quick fix.
- No shared state for several nodes; the hub mode isn't built (`docs/scaling.md:13`). Architectural.
- The recovering state is only shown to the admin; viewers still see the "live" chip. Quick fix.
- No auto-restart of sessions that were live after a server restart (not found after searching resume/restore). Quick fix.

## Spreadsheet row
3.5 | 3.5 | 3.75 | 4.5 | 4.5 | 19.75 | 3.95 |
- El glosario llega tanto al reconocimiento (vocabulario de Gemini) como a la traducción, con términos que no se traducen
- Subtítulos parciales en streaming y traducción en streaming; latencia medida por componente (~1.5 s + ~0.8 s)
- Salas creadas en tiempo de ejecución, costo por sala y no por espectador; prueba de carga con 10.000 espectadores en un nodo
- Muy completo para operar: Docker, TLS, PIN, reconexión y rotación de Gemini, fallback a modelos locales, panel con latencia y costo
- Extras valiosos: modo offline con Whisper y Gemma, SRT, captions a OBS y YouTube, grabación con replay y corrección en vivo
- A mejorar: estado compartido entre nodos, y el token de captura viaja en la URL

## Time window
First commit `5884d34` 2026-09-24 14:11:36 -03:00; last `38d2d7c` 2026-09-25 13:01:42 -03:00. No commits outside the window. Repo created 2026-09-24T20:08Z, not a fork, all pushes inside the window. 175 commits, no squash; the last two commits only touch the README. No red flags.
