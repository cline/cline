# Nerdearla Vibeathon 2026 — Evaluation: Captearla (nachopiris/captearla)

Evaluated by reading source (cloned to /tmp, full history, 78 commits, only `main`). Not run.

## Gate: PASS
1. Audio: browser mic (`public/stage.js:218`, worklet `public/pcm-worklet.js`) + WAV CLI (`scripts/simulate.ts`). No test audio included.
2. Transcription: Gemini generateContent, verbatim + lang (`src/captions/infrastructure/gemini-transcriber.ts:78-128`).
3. EN→ES: same call returns `es`/`en` (`gemini-transcriber.ts:67-76`; `transcription-pipeline.ts:157`).
4. Subtitles: `public/viewer.html`, `viewer.js:72-80`, projector mode.
5. Multi-session: per-session chunker/pipeline (`session-pipeline-manager.ts`); README "Capacity and cost"; team bench 5 rooms.

## Overview
Node 22 + TS (tsx), node:http + ws, vanilla JS. `@google/genai ^2.24.0`, `gemini-3.5-flash-lite` default (unverified vs SDK), one-step transcribe+translate, JSON schema. Apache-2.0. Original + ES + EN, per viewer. Demo video: not found (check Devpost).

Time window: first commit 8c665e9 2026-09-24 17:54:05 GMT-3; last 7e2ef22 2026-09-25 12:51:00 GMT-3. None outside window. Repo created 2026-09-24T23:43Z, pushed 2026-09-25T17:07Z, not a fork. 4 commits with author≠committer (all in window, rebases). No red flags.

## Scores
| Criterion | Score | Closest ref | Reason |
|---|---|---|---|
| Calidad | 3 | NerdLingo/Josefina (=) | Gemini one-step, 2-caption rolling context, no glossary, seam garbling documented by team |
| Latencia | 2.5 | OmniStage_AI (=) | 2.5–6 s chunks, no partials; measured p50 ~2.4 s excludes buffering |
| Escalabilidad | 3.5 | Josefina/OmniStage (=) | Runtime rooms, cost per stage; in-memory single process |
| Despliegue | 3 | Josefina–aura | Docker/Compose/Fly HTTPS+health, CI, ingest token (fails open if unset, in URL); no operator reconnect ("On air" stays), no export/monitor |
| Innovación | 2.5 | Josefina (+) | Projector mode, deep links, display names, load bench; no brief optionals |
| Total | 14.5/25 | | Promedio 2.9 |

## Key evidence
- Chunker: min 2.5 s / max 6 s / 400 ms silence / RMS 500, no overlap (`audio-chunker.ts:44-65`); silent chunks dropped (`:107-109`).
- Captions always `final: true` (`transcription-pipeline.ts:158`); `chunkTs` at cut time (`:80-82`); maxInFlight 3 ordered publish (`:62-135`).
- Team bench: flash-lite p50 2368 / p95 2728 ms, 5 rooms, 0 errors (`odd/tasks/gemini-3-thinking-config.md:75`); seams garbled (`:80`).
- Rooms runtime-created (`http-server.ts:118-120`); viewer silently falls back to first live room for unknown ID (`viewer.js:166-198`).
- Token: timing-safe `?token=` (`http-server.ts:64-74,164-168`); open if unset (`main.ts:62-64`); in URL (`stage-core.js:21-31`).
- Operator ingest no reconnect after open; status stays "On air" (`stage.js:249-265`); server marks offline (`http-server.ts:138-140`).
- Gemini error → chunk dropped, no retry (`gemini-transcriber.ts:129-131`).
- Confirmed bug: `scripts/simulate.ts:57`, `scripts/bench.ts:130` send no token → 401 when STAGE_TOKEN set.
- getUserMedia default constraints (`stage.js:218`), not tuned for mixer feed.

## Checklist
✅ live audio, original transcript, ES, EN, parallel sessions, OSI license, docs, audience room+language picker, Gemini.
❌ OBS, more languages, glossary, SRT/VTT export. ⚠️ monitoring (per-stage meter only), test audio (script, no files).

## Top improvements
1. Operator ingest reconnect + truthful status (~2 h).
2. Per-room glossary/context into prompt (~2–3 h).
3. Live API / smaller chunks with overlap + partials (1–2 days).
4. SRT/VTT export + OBS overlay page (~4–6 h).
5. Hardening: require token in prod, token out of URL, Gemini retry, central panel, token in scripts (~1 day).

## Spreadsheet row
3 | 2.5 | 3.5 | 3 | 2.5 | 14.5 | 2.9 |
- La transcripción y traducción con Gemini (una sola llamada, original + ES + EN) funcionan bien, pero no hay glosario y los cortes de 6 s sin solapamiento pueden cortar palabras
- La latencia está atada al tamaño del chunk (2,5–6 s) más el modelo, sin subtítulos parciales; el p50 medido (~2,4 s) no incluye el tiempo de acumulación del audio
- Las salas se crean en runtime y el costo escala por sala, no por espectador; todo vive en memoria en un solo proceso
- El deploy es muy fácil (Docker, Fly.io con HTTPS y health check, CI) y el ingest tiene token, aunque queda abierto si no se configura
- La consola del operador no se reconecta si se cae la conexión y sigue mostrando "On air"
- Buen modo proyector y benchmark de carga; faltan OBS, exportación SRT/VTT y panel de monitoreo
