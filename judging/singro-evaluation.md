# Vibeathon 2026 — Evaluation: Sincro (GastonSch/singro)

Evaluated by reading the code at commit c4052eb (cloned to /tmp/judge/singro). Not run; two read-only
GETs to the public demo (/api/health, /api/sessions) responded.

## Gate: PASS
1. Audio: ffmpeg file/HTTP/HLS/RTSP/YouTube (src/captions/audio/ffmpeg.py:40-153), server mic (audio/microphone.py); samples/demo_en|es.* wired in sessions.yaml:26-48.
2. Transcription: Gemini Live input_audio_transcription (engines/gemini_live.py:33-43, 143-162).
3. EN→ES: translation_config target_language_code (gemini_live.py:58-60); field confirmed in google-genai types.py.
4. Display: web view, OBS overlay, monitor.
5. Multi-session: asyncio task per session (session.py:57-65); scaling in README.md:196-219.

## Overview
FastAPI + google-genai (gemini-3.5-live-translate-preview), fallback gemini_chunk (gemini-3.8-flash, unverified), local faster-whisper+argos, mock. MIT. Target es/en/pt fixed per session by operator. Demo video: not found (SUBMISSION.md:8 placeholder).

Time window: 16 commits, first f100dc6 2026-09-25 09:05:29 GMT-3, last c4052eb 10:43:27 GMT-3; none outside window; author=committer. Repo created 09:05 GMT-3, not a fork. Red flag: 4938be9 adds 47 files / 2999 lines 11 min after initial commit.

## Scores
| Criterion | Score | Ref | Reason |
|---|---|---|---|
| Calidad | 3.5 | NejoyT/aura = | Gemini Live translate; global glossary reaches system_instruction (base.py:58-77, gemini_live.py:40-42) |
| Latencia | 3 | NerdLingo/Josefina = | Streaming 100 ms, VAD 500 ms, partials both lanes; unmeasured, conflicting claims; UI latency = source drift (session.py:114-127) |
| Escalabilidad | 3.25 | Josefina/OmniStage − | Config + runtime sessions, cost per stage; single process in-memory, all events broadcast to all clients (main.py:201-210), language per session |
| Despliegue | 2.75 | NerdLingo/Live Subs + | Docker/compose/systemd/nginx TLS/LXC script, Gemini reconnect w/ backoff (gemini_live.py:251-264), real-timestamp export; NO auth anywhere, audience can start/stop, arbitrary source URL to ffmpeg |
| Innovación | 3.25 | NejoyT/Live Subs + | YouTube input, embedded video, OBS overlay w/ translation, monitor, 4 export formats, local/mock |
| Total | 15.75/25 | Promedio 3.15 | |

## Confirmed issues
- No auth on POST/DELETE /api/sessions, start/stop, /monitor (main.py:88-125); audience page has Ejecutar/Detener and + Sesión (app.js:195-206, index.html:21).
- Arbitrary source.url passed to ffmpeg -i (manager.py:62-74, ffmpeg.py:49-50).
- gemini_chunk _last_original shared across sessions (gemini_chunk.py:35, 95-97); parallel windows can reorder (121-129).
- Outage not shown to audience; stale partial remains (app.js:89-105).
- Dockerfile omits requirements-yt.txt though escenario-3 is YouTube.
- README drift: model name (README.md:19 vs config.py:41), loop claim (130), autostart claim (183).

## Spreadsheet row
3.5 | 3 | 3.25 | 2.75 | 3.25 | 15.75 | 3.15 |
- Usa Gemini Live con traducción nativa y subtítulos parciales; el glosario llega al modelo, pero es único para todo el evento
- Las sesiones se crean por config o en caliente desde la UI/API, con costo por escenario y no por espectador
- Buen material de deploy (Docker, systemd, nginx con TLS) y reconexión automática con Gemini
- No hay autenticación: cualquier espectador puede iniciar, detener o borrar escenarios y crear fuentes arbitrarias
- La latencia no está medida de punta a punta; el valor que muestra el monitor no es el retraso de los subtítulos
- Suma fuente de YouTube, video embebido, overlay OBS con traducción y exportación SRT/VTT/TXT
