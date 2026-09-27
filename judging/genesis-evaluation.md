# Nerdearla Vibeathon 2026 — Genesis (davidz1995/genesis)

Devpost: https://devpost.com/software/genesis-5ztlrq
Repo (not linked on Devpost; found via author David Zapata): https://github.com/davidz1995/genesis
Demo: https://www.youtube.com/watch?v=ci78_Ljf4LQ ("Genesis translator") — length unverified (YouTube bot wall)

## Gate: FAIL (requirement 2)

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Live audio | Pass (barely) | Only raw-PCM WebSocket ingest (main.py:38-40, routes/audio.py:41-51) fed by scripts/send_wav.py (WAV -> 16 kHz mono, 100 ms real-time chunks; wav.py:10-49, send_wav.py:23-25). Samples: 60 s and 300 s WAVs. No mic/stream/vMix audio bridge (README.md:116,151). |
| 2 | Original-language transcript | **FAIL** | engine.py:90-97 sets only output_audio_transcription (translation); input_audio_transcription absent repo-wide; engine.py:167-170 reads only output_transcription; tests/test_pipeline.py:130-152 asserts input transcription is discarded; source_lang never reaches the model (engine.py:176, tracing.py:108). |
| 3 | EN->ES translation | Pass (code, not run) | Gemini Live TranslationConfig(target_language_code, echo_target_language=True) — fields verified in google-genai source. |
| 4 | Subtitles displayed | Pass | overlay.html:43-51, partials dimmed (line 35). |
| 5 | 2+ sessions + scaling doc | Pass | Per-session Gemini task (engine.py:33-47), per-room bus (bus.py:22-26), README.md:90-112, 171-192. |

Possible undocumented workaround: a second room with --target equal to the source language (echo_target_language). Must be verified by running.

## Context (not scored)
- No LICENSE (GitHub license: null); no audience view; no auth on any endpoint; no Docker/deploy files; no Gemini reconnect; in-memory state; no export; no glossary.
- Stack: Python 3.12, FastAPI, google-genai, websockets, langfuse (optional tracing). Model gemini-3.5-live-translate-preview.

## Time window: OK
- First commit 6736eec 2026-09-25 01:02:32 GMT-3; last 386c4f7 2026-09-25 04:24:33 GMT-3 (author = committer).
- None outside the window. Repo created 2026-09-25 01:02 GMT-3, pushed 04:31 GMT-3, not a fork. 6 commits; largest 454 lines. Two author names (GitHub web vs local "u632303" with the same person's email).

## Open questions
1. Run the echo workaround (sala-en --target en alongside sala-es --target es).
2. Confirm translation end to end with the sample WAV.
3. Check the demo video length manually.

## Nota para el equipo
- El proyecto no cumple el requisito mínimo de transcripción en el idioma original: el motor solo pide y muestra el texto traducido (`output_audio_transcription`), y un test verifica explícitamente que la transcripción de entrada se descarta.
- La traducción en streaming con Gemini Live Translate, el overlay transparente para vMix con parciales atenuados y el script para enviar WAV a ritmo real están bien resueltos.
- Las salas en paralelo funcionan por `session_id`, y el README explica el camino a Redis.
- Para una próxima versión: activar `input_audio_transcription` y publicar ambos textos, agregar una licencia OSI, autenticación en el ingest, reconexión con Gemini y una vista para la audiencia.
