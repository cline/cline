# Nerdearla Vibeathon 2026 — Nerdearla Live Captions (subtitulos-en-vivo)

Repo: https://github.com/RicardoNigrelli/subtitulos-en-vivo (evaluated at HEAD `6c80b11`, only branch `main`)
Devpost: https://devpost.com/software/nerdearla-live-captions
Video: https://youtu.be/cxSG4hmvxfQ — exact length unverified (sandbox could not read YouTube metadata); the video's SRT in the repo ends at 1:40.2 → probably ~1:40, under the 2-min cap.

## Gate: PASS (all 5)
1. Audio: ffmpeg file / URL (HTTP/HLS/RTMP/SRT/UDP) / mic (dshow, avfoundation, pulse) — `worker/ingesta.py:61-78`; 3 test clips in `fixtures/audio/clips/`.
2. Real-time transcription: Gemini Live `gemini-3.5-transcribe-live`, 100 ms chunks — `worker/transporte.py:35-101`, `worker/session.py:982-992`.
3. EN→ES (and ES→EN) translation: `gemini-3.5-flash-lite` / `3.1-flash-lite` — `worker/run.py:160-190`, `worker/traductor.py:316-359`.
4. Subtitles: web view `/s/<id>?lang=`, projection mode, OBS overlay — `web/app.js`.
5. 2+ sessions + scaling docs: `ops/entrypoint-worker.sh:86-100`, `ops/salas.py`, README:424-527; 5-room real recordings in `fixtures/casetes/evidencia-25-09/cinco-*`.

## Scores
| Criterion | Score | Closest ref | Reason |
|---|---|---|---|
| Calidad | 3.5 | = Glosa/aura | Gemini baseline + per-talk agenda glossary → `custom_vocabulary` (`worker/glosario.py`, `run.py:70-81`, `transporte.py:41-47`); seam overlap/dedup; translation coverage 50–78 % with shared free-tier key; glossary not sent to translator |
| Latencia | 3.25 | between NerdLingo and Glosa | Real partials (original only); my recomputation from recordings: end-of-block→text p50 ~0.5 s (~3 s from first word); text→translation p50 2.4–5.3 s; no partials in translated view |
| Escalabilidad | 3.5 | = aura/OpenSimultánea | Rooms from JSON (`ops/salas.py`) or runtime (`ops/control.py`, cap 20); cost per room×language, not per viewer; unknown IDs → waiting room; single in-memory hub, no shared state |
| Despliegue | 4.0 | < Glosa, > aura | Reopen-with-overlap on 5 causes + 240 s preventive rotation (`session.py:394-540`); hub refuses weak token off-loopback (`hub/config.py:99-110`); control API 401 without token; Docker + token-init; panel p50/p95, rotations, room control, live listen; SRT/VTT/TXT with real timestamps. Missing: HTTPS, control service not in Compose (binds 127.0.0.1), hub restart loses translations |
| Innovación | 4.0 | between OpenSimultánea and Glosa | QR per room, projection mode, OBS/vMix per language, agenda glossary, multi-target languages, live original-audio listening in panel, labelled replay, gap markers, export. No Q&A / "what did I miss" |
| **Total** | **18.25/25** | | **Promedio 3.65** |

## Time window
- First commit `bf3f6e0` 2026-09-24 12:32:06 GMT-3; last `6c80b11` 2026-09-25 11:47:36 GMT-3 (last two commits docs-only; `9440c3c` 11:42:05 is code). None outside window; author = committer everywhere; not a fork.
- GitHub created 2026-09-24 18:46 GMT-3, pushed 2026-09-25 11:47 GMT-3; all push events in window.
- Note: 2nd commit `0ba3e51` (13:56 GMT-3) is large (68 files, +9,669). Its recordings have started_at 13:11–13:30 GMT-3 (writable data, only a hint). PROMPTS.md:9-40 declares pre-event exploratory calls + "skills" docs, no code. ~34 gradual commits, no squash.

## Spreadsheet row
Calidad | Latencia | Escalabilidad | Despliegue | Innovación | Total | Promedio
3.5 | 3.25 | 3.5 | 4 | 4 | 18.25 | 3.65

Notas:
- La calidad de la transcripción es buena, y el glosario que sale de la agenda de cada charla llega a Gemini como vocabulario
- El original aparece rápido y con texto parcial, pero la traducción suma varios segundos y, con una key compartida del nivel gratuito, no siempre traduce todas las líneas
- Las salas se crean desde un archivo o desde el panel, y el costo crece por sala e idioma, no por espectador; el hub es un único proceso en memoria
- Muy buena operación: se reconecta solo con Gemini, rota la sesión, pide token sin abrirse por defecto y tiene un panel con latencia, reaperturas y control de salas
- Faltan HTTPS y el servicio de control dentro de Docker, y al reiniciar el hub se pierden las traducciones ya entregadas
- Muchos extras útiles: QR por sala, modo proyección, overlay para OBS, varios idiomas por sala, escuchar el audio en vivo desde el panel y export SRT/VTT

## Open questions
1. Exact video length (<2:00?).
2. End-to-end latency to the browser incl. translation (`qa/smoke.py` + `qa/latencia.py --vivo-tags`).
3. Glossary A/B on the same clip (`worker.medir_glosario`).
4. Panel room creation under plain `docker compose up` (expected to fail without starting `ops.control`).
5. SDK fields (`custom_vocabulary`, `interimInputTranscription`, `thinking_level`) against google-genai 2.25.0 — unverified, not suspect.
