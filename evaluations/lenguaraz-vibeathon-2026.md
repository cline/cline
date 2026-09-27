# Nerdearla Vibeathon 2026 — Evaluation: nahuex/lenguaraz

Evaluated by reading the code (not run). Clone: full history, 82 commits on `main`.

## Gate: PASS
1. Audio: `stages.yaml` source → WAV reader or ffmpeg (file/HLS/RTMP/SRT/device) — `lenguaraz/ingest/base.py:34-47`, `ingest/ffmpeg.py:31-55`; bundled `samples/*.wav` play by default.
2. Transcription: Gemini Live `input_audio_transcription`, interim + final — `lenguaraz/stt/gemini.py:38-48,115-137`.
3. EN→ES: stage `main` en-US → es,pt via `translate/fanout.py:136-146`, `translate/gemini.py:124-150`.
4. Subtitles: `/live/:stage` (`web/src/pages/LiveCaptions.tsx`), `/overlay/:stage` (`web/src/pages/Overlay.tsx`).
5. Two stages in `stages.yaml`, one pipeline each (`runner.py:357-391`); README "Scaling to more stages" + `docs/deploy/scaling.md`.

## Overview
Python/FastAPI + React. Models: `gemini-3.5-transcribe-live` (STT, glossary as `custom_vocabulary` — SDK field unverified), `gemini-3.5-flash-lite` (translation, streamed). `gemini-3.5-live-translate-preview` declared (`config.py:235`) but unused. License Apache-2.0. Demo video: not found (`docs/devpost.md:111` placeholder). NOTE: devpost.com/software/lenguaraz is a different project (Franco Niz, Go app).

## Scores
| Criterion | Score | Closest ref | Reason |
|---|---|---|---|
| Calidad | 3.5 | Glosa/aura = | Glossary reaches STT and translation prompt + talk context; real-audio quality unverified |
| Latencia | 3.5 | Glosa = | Streaming, partials, hybrid VAD, progressive translation, hedging; self-measured ~0.9 s final + 0.6–1.05 s translation |
| Escalabilidad | 3.5 | Glosa/aura = | Config stages, cost per stage × active language; in-memory single process, `REDIS_URL` unused |
| Despliegue | 4.0 | Glosa − | Reconnect, make-before-break rotation, stall watchdog, Docker/Caddy/Cloud Run, full admin; default admin token `config.py:232`; ffmpeg source ends → STOPPED without auto-restart (`runner.py:233-239`, `stt/session.py:599-606`) |
| Innovación | 3.5 | aura = | Auto-glossary, OBS overlay w/ translation, SRT/VTT/TXT export, cost monitor, demand-driven languages, dry-run |
| **Total** | **18 / 25** | | **Promedio 3.6** |

## Top improvements
1. Refuse startup with default/empty `ADMIN_TOKEN` (~30 min).
2. Auto-restart ingest for URL sources (~2–3 h).
3. Runtime stage creation + QR per stage (~0.5 day).
4. Redis bus behind existing `Bus` interface (~1–2 days).
5. Persist transcripts; placeholder for failed translations (~3–4 h).

## Spreadsheet row
3.5 | 3.5 | 3.5 | 4 | 3.5 | 18 | 3.6 |
- El glosario por escenario (manual + automático) llega tanto a la transcripción como a la traducción, junto con el título y el resumen de la charla
- Subtítulos parciales, traducción progresiva y solicitudes duplicadas contra respuestas lentas; latencia medida por el equipo de aprox. 1–2 s hasta la traducción
- Escenarios definidos en configuración; el costo crece por escenario e idioma activo, no por espectador; falta estado compartido para escalar a varios servidores
- Muy buena operación: reconexión, rotación de sesión sin cortes, Docker con HTTPS, panel de administración completo y exportación SRT/VTT/TXT
- A mejorar: el token de administración tiene un valor por defecto público y una caída del stream de audio requiere reinicio manual
- No encontramos el video de demo ni la página de Devpost correspondiente a este repositorio

## Time window
First commit 06ef354 2026-09-24 12:46:12 GMT-3; last 9d46c3f 2026-09-25 13:52:23 GMT-3 (docs). No commits outside the window on any branch; author = committer dates. Repo created 2026-09-24 15:04:34Z, not a fork, last push 2026-09-25 16:52:40Z. Last code change 308f556 at 13:03 GMT-3; later commits docs only. No significant red flags.
