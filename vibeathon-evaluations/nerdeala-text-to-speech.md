# Vibeathon 2026 evaluation: G0nzalito/nerdeala-text-to-speech

Evaluated by reading the code of https://github.com/G0nzalito/nerdeala-text-to-speech (main @ d5267c5). Not run.

## Gate: PASS (all 5)
- Audio: browser mic (frontend/src/services/audioCapture.ts:79), Python mic client (capture_client.py), file upload (backend/app/routers/test_audio.py:162-214) + samples/*.wav (~5 s each)
- Transcription: faster-whisper `base` CPU int8, 2 s chunks (backend/app/workers/stt_worker.py:95-99,148-172)
- Translation: Argos Translate es<->en (backend/app/workers/translation_worker.py)
- Subtitles: web viewer /view/:id (frontend/src/components/CaptionViewer.tsx)
- Multi-session: per-session state (sessions/manager.py); README scaling section + docs/DEPLOYMENT_CONFERENCE.md

## Scores
| Calidad | Latencia | Escalabilidad | Despliegue y operación | Innovación | Total | Promedio |
|---|---|---|---|---|---|---|
| 2.5 | 2.75 | 3.5 | 2.5 | 3 | 14.25 | 2.85 |

## Key findings
- No Gemini/Gemma. Whisper + Argos, fully local after the first model download. OpenAI transcription is opt-in.
- 2 s chunks with no overlap, VAD off, no partials (`caption.interim` is declared but never emitted), no glossary.
- Sessions created at runtime; Redis pub/sub fan-out across replicas (services/events_out.py); cost per stage, not per viewer. STT is a single in-process model; SQLite.
- No auth on any operator endpoint (events/sessions/settings/test-audio/export). `start` returns capture_token to anyone (routers/sessions.py:119-124). Default SECRET_KEY is committed. `/` is the operator console.
- No capture auto-reconnect. Sequence counter resets on restart (manager.py:33), so new captions overwrite old ones in the viewer after a restart.
- SRT/VTT timestamps are chunk-relative (stt_worker.py:146,163-167; capture.py:58-59).
- Frontend container runs the Vite dev server (frontend/Dockerfile:18).
- Extras: QR code, ZIP export with audio, runtime model switch, test upload. No OBS overlay, glossary, extra languages or monitoring panel.

## Time window
- First commit 2026-09-24 23:28:42 -03:00; last 2026-09-25 10:32:19 -03:00. None outside the window. Repo created 24/09 23:20 GMT-3. Not a fork.
- Red flag: the first 25 commits (~8k lines) share three timestamps within seconds, which looks like a pre-existing tree split into commits. Not proof of earlier work.
- Demo video: not found in the repo; check Devpost.

## Notas
- Solución 100% local (faster-whisper + Argos) con muy buena documentación de despliegue para conferencias
- Las sesiones se crean en tiempo de ejecución y cada espectador elige su idioma; la difusión con Redis pub/sub está bien resuelta
- La transcripción usa bloques de 2 s sin solapamiento, sin VAD ni subtítulos parciales, lo que afecta la calidad y la latencia
- Los endpoints del operador (crear, iniciar, borrar, exportar y configuración) no tienen autenticación, y la raíz del sitio es el panel del operador
- La exportación incluye audio y subtítulos, pero los tiempos de los SRT/VTT son relativos a cada bloque y no a la sesión
- Faltan la reconexión automática de la captura, el overlay para OBS y un glosario
