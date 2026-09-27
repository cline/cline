# Nerdearla Vibeathon 2026 — Evaluation: transcribe-ia

Repo: https://github.com/luisagalva/transcribe-ia (evaluated by reading the code, not run)

## Eligibility (time window)
- First commit `45ab3bf` 24-09 23:22 GMT-3; first code commit `eab332f` 25-09 00:06 GMT-3.
- Last commit `5ed94f0` 25-09 15:06 GMT-3.
- After deadline: `a82d9c2` (15:00:49), `4c55676` merge (15:01:45), `5ed94f0` (15:06:30). Only test MP3s + .gitignore, no code. Confirmed by GitHub push events at 18:01:50Z and 18:06:38Z.
- Repo created 2026-09-25T02:18:31Z; not a fork; author == committer dates; history incremental.

## Gate
1 ✅ FFmpeg file/URL/dshow mic (`backend/workers/audio.py:23-44`); test MP3s in `media/`.
2 ✅ Gemini Live input transcription with partials (`gemini.py:50-60,131-139`).
3 ✅ Per-final translation with Gemini Flash (`translator.py:38-59`, `worker.py:114-126`).
4 ⚠️ Minimal pass: `frontend/src/hooks/useTranscript.ts` and `vite.config.ts` were never committed (`.gitignore:116` `*.ts`), so the frontend doesn't build from a clean clone. Terminal output (`worker.py:128-133`) plus WS/SRT/VTT still work.
5 ✅ One process per stage, Redis channels `stage:N:*`; README runs 3 in parallel.

## Scores
| Criterion | Score | Reference |
|---|---|---|
| Calidad | 3.25 | NerdLingo + / NejoyT − |
| Latencia | 3 | NerdLingo / OpenSimultánea = |
| Escalabilidad | 3.5 | Live Subs = |
| Despliegue y operación | 2.25 | OmniStage_AI / Live Subs − |
| Innovación | 3.25 | NerdLingo − / Live Subs + |
| **Total** | **15.25 / 25** | Average 3.05 |

## Key findings
- Glossary: `PUT /stages/{id}/glossary` → Redis → `system_instruction` (`gemini.py:20-39,55-56`); not in translator, not `custom_vocabulary`; `--lang` never reaches the model.
- `latency_ms` = time since the previous final segment (`worker.py:100,119`), not a real latency.
- Reconnect with backoff (`worker.py:198-234`), heartbeat, `/health`, Monitor, SRT/VTT with wall-clock timestamps (`transcript_export.py:65-94`).
- No auth anywhere (`gateway/main.py:87`), CORS `*`; Monitor at `/`; Docker only for Redis; `reload=True` gateway; Windows-only mic (dshow).
- `session_manager.py` (yt-dlp, `/sessions`) and `Transcribe.tsx` are dead code (reverted in `546785d`).
- `/viewer` hard-coded to stage 1 / es (`Viewer.tsx:4-5`); no audience chooser.

## Spreadsheet row
3.25 | 3 | 3.5 | 2.25 | 3.25 | 15.25 | 3.05 |
- Buena arquitectura: un worker por stage con Redis Pub/Sub, y los stages se crean con cualquier ID al lanzar el worker
- El glosario por stage llega al modelo como instrucción de sistema, pero no a la traducción
- Los subtítulos parciales se ven en el idioma original; la traducción aparece recién cuando el segmento es final
- Falta `frontend/src/hooks/useTranscript.ts` en el repo (lo excluye el `*.ts` del .gitignore), así que el frontend no compila desde un clon limpio
- No hay autenticación ni despliegue más allá de Redis en Docker, y el micrófono en vivo solo funciona en Windows
- Suma overlay para OBS, exportación SRT/VTT con tiempos reales y un panel de monitoreo
