# Decilo — Nerdearla Vibeathon 2026 evaluation

Repo: https://github.com/dnluc/decilo · Devpost: https://devpost.com/software/decilo
Evaluated by code reading only (not run).

## Eligibility (time window)
- First commit 8816175 (LICENSE only): 2026-09-24 16:35:24 GMT-3 (author = committer).
- Last commit e6be77b (docs): 2026-09-25 08:29:12 GMT-3 (author = committer).
- No commits before 24-09 12:00 or after 25-09 15:00 GMT-3. Repo created 2026-09-24T19:35Z, pushed_at 2026-09-25T11:29Z, not a fork.
- ~10 commits with author/committer differing by seconds to ~19 min (rebases/merges, inside the window). 109 granular commits. No red flags.
- Demo video: https://youtu.be/mrHqqAIPJkQ — 1:55 per docs/DEMO.md:14,131 and Devpost (not watched).

## Gate: PASSES
1. Audio: browser tab capture (frontend/src/capture.js:128-138, capture-worklet.js, app.py:259-320). Sample WAVs API-only (app.py:195-241).
2. Transcription: Gemini Live (gemini_live.py:89-96,152-199) or local Whisper (capture.py:111-135).
3. EN→ES: app.py:309; translate.py:39-59; gemini.py:247-254; translated interims gemini_live.py:255-295.
4. Subtitles: index.html:32-54, app.js:83-142.
5. Two sessions: runtime sessions (app.py:308-311), cap of 2 (app.py:282,220); README explains scaling briefly.

## Scores
| Calidad | Latencia | Escalabilidad | Despliegue y operación | Innovación | Total (/25) | Promedio |
|---|---|---|---|---|---|---|
| 3 | 3.5 | 3 | 2.5 | 2.75 | 14.75 | 2.95 |

- Calidad 3 (= Live Subs/NerdLingo): Gemini Live SMART; no glossary/context (translate.py:21-32 generic, per-sentence); local path has documented errors.
- Latencia 3.5 (= Live Subs): 100 ms PCM direct to Live, interims + translated interims; ~1.3 s first word self-reported only (openspec/changes/backend-latencia-incremental/tasks.md:29); stored cloud measurement is REST path 3.2 s / 4.9 s.
- Escalabilidad 3 (− Josefina/OmniStage): runtime sessions, per-stage cost, fan-out gateway (gateway.py); hard cap 2 captures; confirmed bug: registry never evicts (sessions.py:43-63) so after 20 sessions app.py:282 rejects all captures until restart; in-memory; no session chooser (loadSessions unused).
- Despliegue 2.5 (= OmniStage): Live rotation at 9 min + reconnect (gemini_live.py:36-37,105-130), fallback to segments (capture.py:194-215), /health; no deploy files, no auth anywhere, capture requires DECILO_DEMO_SESSIONS=1 (app.py:265), single console page for operator+audience, no export, no monitor.
- Innovación 2.75: hot local/cloud switch (capture.js:100-117), auto language detection (capture.py:268-298), translated partials, caption pacing/stabilization (captions.js), gap notices; no brief optionals.

## Top improvements
1. Operator token (fail closed) + separate audience route — hours.
2. Evict ended sessions, configurable concurrency — 1-2 h.
3. Session chooser + share link/QR — hours.
4. Dockerfile/Compose + Caddy HTTPS — half day.
5. Per-session glossary + context; SRT/VTT export — half day.

## Notas (spreadsheet)
- La calidad es la esperable con Gemini Live (modo SMART); no hay glosario ni contexto de la charla hacia el modelo
- Buen diseño de streaming: audio continuo a Gemini Live con parciales, incluso traducidos en vivo; la latencia reportada (~1,3 s) no tiene evidencia guardada
- Las sesiones se crean al vuelo y la audiencia no multiplica el costo, pero hay un tope de 2 capturas y el servidor deja de aceptar nuevas tras 20 sesiones sin reiniciar
- Reconexión y rotación de Gemini Live bien resueltas; faltan archivos de despliegue, autenticación y separación entre operador y audiencia
- Muy buen detalle: selector local/nube en caliente, detección de idioma y ritmo de lectura de subtítulos
- Documentación muy honesta sobre límites y evidencia; no hay OBS, exportación, glosario ni panel de monitoreo
