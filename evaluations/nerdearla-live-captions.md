# Vibeathon 2026 evaluation — lucasmde/nerdearla-live-captions ("Live Captions")

Evaluated at HEAD `f4d3a6f` (main) by reading the code. Not run.

## Gate: PASS
1. Audio: browser mic/line-in/tab (`public/operator.html:89-93`, `public/viewer.html:441-458`); ffmpeg file/RTMP/SRT/HLS/device (`tools/ingest.js:20-28`); demo clips `demo/talk_en.mp3`, `demo/talk_es.mp3`; `tools/demo-parallel.sh`.
2. Transcription: Gemini Live partials + finals (`server/engines/gemini-transcribe.js:38-53,115-120`).
3. EN→ES translation: `server/session.js:254-259`, `server/engines/translate.js:64-91`.
4. Display: `/s/:id` viewer, `overlay=1`, `tv=1`.
5. Several sessions: one `LiveSession` per room (`server/index.js:17,37`); README scaling notes at lines 33 and 118-124; bench in `docs/EVIDENCIA.md`.

## Scores
| Calidad | Latencia | Escalabilidad | Despliegue y operación | Innovación | Total | Promedio |
|---|---|---|---|---|---|---|
| 3.5 | 3.5 | 3.5 | 4.25 | 4.5 | 19.25 | 3.85 |

- Calidad (= Glosa/aura/NejoyT): per-event/per-room vocabulary plus agenda speaker names → `customVocabulary` (`store.js:27,40`, `session.js:56`, `gemini-transcribe.js:42`). Doesn't reach translation; frozen when the transcriber is created.
- Latencia (= Live Subs/Glosa): 100 ms chunks, 450 ms VAD, partials in the original and translated (`session.js:310-321`), sentence cut from partials (`session.js:151-165`), batched backlog. Only post-final translation is measured (p95 2.7 s).
- Escalabilidad (= aura/Josefina): runtime rooms via `/admin/sessions` (persisted JSON); cost per room and language, not per viewer; single process with in-memory state; `cloudrun.sh` `--max-instances 3` conflicts with in-memory state.
- Despliegue (− Glosa): reconnect, 8.5 min rotation, goAway handling, 30 s audio buffer; Docker/Compose/Render/Railway/Cloud Run/K8s, health check, CI, `/admin` monitor, `/metrics`, SRT/VTT/TXT/JSON export, admin OAuth that fails closed.
  - Weaknesses: ingest token in the URL; `INGEST_TOKEN=change-me` in `.env.example`; with empty SPEAKER_EMAILS any logged-in user can transmit to any room (`auth.js:58,76`); no rate limit on speaker-code redemption; `/admin` and `/metrics` unauthenticated.
  - Compose mounts `sessions.json` read-only; the "en vivo" badge stays on during Gemini reconnects; SRT timestamps are relative to server start.
  - The README quick test uses nonexistent room IDs `main` and `workshop-1`.
- Innovación (= Glosa): QR card and TV mode, "¿Qué me perdí?", agenda now/next, per-viewer on-demand languages with back-fill, chat with floor control, high contrast, dead-air alert, speaker codes, `now.txt`.

## Demo video
https://youtu.be/y4v_iiF91rE — Devpost says 2:47 (over the 2:00 cap); YouTube length not verified directly.

## Time window
- First commit `2a1b6e3` 2026-09-25 02:05 GMT-3 (2,719 lines).
- Last in window `bc08a98` 14:42 GMT-3. Tag `v1.0-vibeathon` = `0429a82` (10:57 GMT-3).
- 18 commits after the deadline (last `f4d3a6f` 26/09 03:47 GMT-3), including about 1,000 lines of code: rooms admin panel, speaker codes, sandbox rooms, security fixes, sentence-by-sentence translation.
- Repo created 2026-09-25T11:46Z, not a fork. Organizers to decide; not reflected in scores.
