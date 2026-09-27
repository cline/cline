# Vibeathon 2026 — Evaluation: GiovanniCieri/Nerdearla ("Nerdearla Live Captions")

Repo: https://github.com/GiovanniCieri/Nerdearla (evaluated at `59d147d`, code read only, not run).
SDK checked: `@google/genai@1.52.0` (pinned in pnpm-lock.yaml:35).

## 1. Gate: PASS
1. Audio ✅ mic `public/app.js:701`, tab `app.js:690-700`, extension `tabCapture` `extension/offscreen.js:11-16,46`. No test audio, no file import.
2. Transcription ✅ `server.js:961-969` final, `server.js:952-958` interim.
3. EN→ES ✅ Live Translate `server.js:761-769`, streamed `server.js:985-1012`.
4. Subtitles ✅ `public/audience.*`, overlay `audience.js:467-470`.
5. 2+ sessions ✅ `server.js:39`, `server.js:601-618`; scaling `README.md:213-228`.

## 2. Overview
Node 22 + ws, vanilla UI, AudioWorklet, MV3 extension, optional Electron; Docker/Compose.
Models: gemini-3.5-live-translate-preview, gemini-3.5-transcribe-live, gemini-3.5-flash-lite; optional WhisperLiveKit + Sortformer.
MIT. In: en/es/pt/auto; out: es/en/pt. Demo video: not found (README:277); check Devpost.

Time window: first 036301b 2026-09-25 11:31:58 -03; last 59d147d 13:56:52 -03 (author=committer). None outside. Repo created 14:32:11Z, not a fork.
Red flag: first commit 40 files / 5,834 lines ~23.5 h after start; messages "."; docs list 35 iterations absent from git. Last 3 commits README-only.

## 3. Scores
| Criterion | Score | Ref | Reason |
|---|---|---|---|
| Calidad | 3.5 | NejoyT = | Glossary reaches Flash-Lite prompt (server.js:1168-1171); ASR customVocabulary dropped by SDK |
| Latencia | 3.25 | NerdLingo/Live Subs between | 100 ms streaming, bounded queues, partials; one anecdotal ~1.0/1.2 s figure |
| Escalabilidad | 3.5 | Josefina/aura = | Runtime rooms, per-room cost, deltas; single process, one target language |
| Despliegue | 2.75 | NerdLingo + | Reconnect + GoAway resumption, Docker healthcheck, metrics, export; NO auth |
| Innovación | 3.75 | aura + / OpenSimultánea − | Multi-tab extension, budget auto-pause, diarization, PT, local fallback, overlay |
| Total | 16.75/25 | Promedio 3.35 | |

## 4. Key evidence
- Glossary → prompt `server.js:1164-1171`; → WhisperLiveKit `server.js:815-816`.
- CONFIRMED: `lib/gemini-transcription-config.js:7` customVocabulary dropped by SDK `audioTranscriptionConfigToMldev$1` (dist/node/index.mjs:7869-7875).
- 100 ms packets `public/audio-worklet.js`; client cap 12 KiB `app.js:10,543`; server queue 3, drop >900 ms `server.js:1269-1283`; viewer cut 256 KiB `server.js:434-437`.
- Metrics `server.js:203-226`; render-ack `audience.js:134-148`.
- Reconnect `server.js:620-661`; GoAway/resumption `server.js:663-682,765`; local fallback `server.js:630-643`; direct→proxy `server.js:1372-1388`; producer reconnect `app.js:774-795`; restart restore `server.js:48-69`; audience status `audience.js:184-187`.
- Export `server.js:237-280`. CONFIRMED bug: resume resets startedAt (`server.js:561`) → earlier cues 00:00:00 (`server.js:238,267`).
- No auth on any endpoint/WS (`server.js:289-414,1330`); README:217 admits it; operator-token in `.env.example:7` unimplemented; origin check `server.js:1457-1462` only in prod with Origin.
- Budget auto-pause `server.js:464-478`. Diarization `server.js:359-399`.
- Viewer language fixed per room `audience.js:34-46`.

## 5. Checklist
✅ live captions, original, EN→ES, ES→EN, parallel sessions, MIT, Gemini audio, OBS overlay (shows translation), PT, export, monitor
⚠️ docs (Windows-centric, no HTTPS/runbook), audience picks session+language (link only, one target), local (WhisperLiveKit, not Gemma), glossary (translation only)
❌ test audio files / file import

## 6. Open questions
1. Sustained p50/p95 via /api/metrics. 2. 40+ min GoAway/resumption. 3. Interims in glossary mode. 4. Glossary A/B. 5. Demo on Devpost.

## 7. Improvements
1. Auth + audience landing (~0.5 d). 2. Per-viewer languages (~1 d). 3. Glossary to ASR + export timestamp fix (~3 h). 4. HLS/RTMP/file ingest + test audio (~1 d). 5. HTTPS, cross-OS docs, measured latency (~0.5 d).

## 8. Spreadsheet row
3.5 | 3.25 | 3.5 | 2.75 | 3.75 | 16.75 | 3.35 | - Usa Gemini Live Translate; el glosario por charla llega a la traducción con Flash-Lite, pero el vocabulario para la transcripción no llega al modelo (el SDK lo descarta)
- Streaming en bloques de 100 ms, con colas acotadas y subtítulos parciales; la única medición publicada es un registro puntual (~1,0 s / ~1,2 s)
- Las salas se crean en tiempo de ejecución y el costo crece por sala, no por espectador; corre en un solo proceso y cada sala tiene un único idioma de traducción
- Muy buena recuperación ante cortes de Gemini (reintentos, rotación con reanudación de sesión, respaldo local), Docker con healthcheck, panel de métricas y exportación SRT/VTT
- No hay autenticación: cualquiera con acceso al servidor puede ver, iniciar o borrar sesiones y ver costos
- Extras valiosos: extensión para capturar varias pestañas, presupuesto diario que pausa sesiones, diarización y overlay configurable para OBS
