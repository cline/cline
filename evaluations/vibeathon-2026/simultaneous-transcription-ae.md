# Evaluation: simultaneous-transcription-ae (nicogamba)

Repo: https://github.com/nicogamba/simultaneous-transcription-ae
Method: code read at commit `c19ff30`. Not run. No demo link found in the repo (check Devpost).

## Time window (eligibility)
- First commit `77d8c8c`: 2026-09-24 22:36:44 GMT-3. Last commit `c19ff30`: 2026-09-25 12:00:10 GMT-3.
- Author and committer dates identical. No commits outside the window. Repo created 2026-09-24 22:36 GMT-3; last push 2026-09-25 12:02 GMT-3. Not a fork.
- The large second commit (`afa38a4`, about 21k lines) is Nx scaffolding plus `pnpm-lock.yaml` (15k lines) and `.opencode/` files. No red flags.

## Gate: PASS
1. Audio: browser mic (AudioWorklet, PCM 16 kHz) and file upload (`apps/web/src/app/services/audio-capturer.service.ts:31-119`). No test audio files in the repo.
2. Transcription: Gemini `generateContent` (`apps/api/src/app/ai/translation/gemini-translation.provider.ts:96-127`).
3. EN→ES: the operator picks source and target (`admin-broadcast.component.html:14-34`).
4. Subtitles: `/stage/:id` and `/overlay/stage/:id`.
5. Sessions: runtime `Map` keyed by sessionId (`audio-pipeline.service.ts:44-67`); scaling explained in README §9.

## Scores
| Criterion | Score | Ref | Reason |
|---|---|---|---|
| Calidad | 2.5 | OmniStage_AI − | Generic prompt, no glossary. Confirmed jitter-buffer freeze on an empty or failed chunk (`jitter-buffer.service.ts:31-47` + `gemini-translation.provider.ts:53-64` + `transcription-engine.service.ts:40-55`). Late joiners see nothing (reset to seq 0, no replay). |
| Latencia | 2.5 | OmniStage_AI = | VAD chunks of 0.8–5 s, non-streaming call, no partials, no measurements. Ingest serialized per session waiting for Gemini (`audio-pipeline.service.ts:94-96`). VAD re-runs over the whole buffer on every ~8 ms mic message. |
| Escalabilidad | 3.25 | Live Subs / Josefina − | Runtime sessions plus Redis Pub/Sub fan-out. But one Redis connection per SSE viewer (`sse-broadcast.service.ts:16`), in-memory ingest, no session chooser. |
| Despliegue | 2.5 | NerdLingo = | Docker Compose + nginx + healthchecks. No auth anywhere, no HTTPS, export or monitor. An operator reconnect ends the session and resets the seq counter, so viewers get stuck (`ingestion.gateway.ts:64-79`). |
| Innovación | 2.5 | Josefina + | Basic OBS overlay showing the translation; circuit breaker; pluggable providers. No extras beyond the brief. |
| **Total** | **13.25 / 25** | | **Average 2.65** |

## Open questions
- WAV upload: each 48 KB slice is transcoded separately with `-f wav`, so later slices likely fail (`audio-acoustic.service.ts:90-121`). Test with a real WAV.
- The `gemini-3.8-flash` model name is unverified; failures are swallowed as empty text.
- Real end-to-end latency and VAD CPU load with several mic sessions.
- Demo video on Devpost.

## Top improvements
1. Jitter buffer: start from the first seq received, skip gaps after a timeout (~1 h).
2. Token auth on `/ingest` and `/api/sessions` that fails closed; hide the admin panel from the nav (~2–3 h).
3. Keep the session alive across operator reconnects (~2 h).
4. Client-side buffering, incremental VAD, non-blocking dispatch; ideally the Live API with partials.
5. SRT/VTT export (timestamps already exist), glossary in the prompt, session chooser with QR, overlay URL options.

## Spreadsheet row
Calidad | Latencia | Escalabilidad | Despliegue y operación | Innovación | Total | Promedio | Notas
2.5 | 2.5 | 3.25 | 2.5 | 2.5 | 13.25 | 2.65 |
- Arquitectura prolija (NestJS + Angular, VAD Silero en servidor, Redis Pub/Sub, Docker Compose) y README bilingüe claro
- La traducción usa Gemini con chunks de hasta 5 s cortados por silencio, sin subtítulos parciales ni latencia medida
- El buffer de reordenamiento en el cliente se traba si un chunk vuelve vacío, y quien se conecta tarde no ve subtítulos
- Las sesiones se crean en runtime, pero no hay autenticación en el panel de operador ni en la ingesta de audio
- Incluye overlay para OBS con la traducción; faltan glosario, exportación de transcripciones y panel de monitoreo
