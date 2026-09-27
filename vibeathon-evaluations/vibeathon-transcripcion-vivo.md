# Evaluation: gomezcelena21/vibeathon-transcripcion-vivo (Nerdearla Vibeathon 2026)

Backup of the judging work: the full report was delivered in the conversation. This file keeps the key findings.

## Eligibility (time window)
- One commit, one branch: 2bf1bf9 "Add files via upload". Author and committer: 2026-09-25 13:50:37 GMT-3.
- Repo created 2026-09-25 13:47:19 GMT-3, pushed 13:50:41 GMT-3. Not a fork. No commits outside the window.
- Red flag: all of the code (26 files, 4,398 lines) arrived in one upload ~70 min before the deadline, with no history.
- Demo video: not found (README/GitHub have no link; Devpost not checkable automatically).

## Gate: PASS
Mic + tab audio (frontend/src/audio.js:48-66) -> WS /ws/{id} (backend/main.py:121) -> gemini-3.5-transcribe-live (backend/gemini_client.py:30,87-108)
-> gemini-3-flash-preview translation es/en/pt (backend/translation.py:26,155) -> console, audience.html, overlay.html. Sessions per id (main.py:125); scaling in README:161-187.

## Scores
| Cal | Lat | Esc | Desp | Innov | Total | Avg |
|---|---|---|---|---|---|---|
| 3 | 2.75 | 3.25 | 2.25 | 3 | 14.25 | 2.85 |

## Key evidence
- No partials: is_final=True hard-coded (gemini_client.py:186). Each line waits for translation (main.py:248). Polling 1.5 s audience / 1 s overlay.
- Latency is measured from the last audio chunk sent (gemini_client.py:118,178), not end to end. The committed jsonl has a line at 34,606 ms.
- BATCH_SIZE=1, fragments translated without context (main.py:208). No glossary.
- Runtime rooms, in-memory single process (main.py:51-52). Multi-worker without shared state (README:178-180) would break the audience/export endpoints.
- Full transcript re-sent on every poll (main.py:107-118).
- No auth, CORS *, no Docker/HTTPS, .env.example missing, http/ws hard-coded (App.jsx:6-8), audience/overlay default localhost backend.
- Reconnect: 4 transient retries (main.py:159-161,309-338); counter never reset (main.py:172); no session resumption.
- SRT/VTT timestamps are processing times; session_start resets per WS connection (main.py:143) -> timestamps go backwards.
- Extras: PT + per-viewer language, OBS overlay with the translation, TXT/SRT/VTT per language, on-demand summary. qrcode.react declared but unused.

## Notas
- Usa Gemini Live para transcribir y Gemini Flash para traducir a español, inglés y portugués; cada persona elige idioma en la vista de audiencia
- Las sesiones se crean en el momento con cualquier ID, y el costo de IA es por sesión y no por espectador
- No hay subtítulos parciales: cada línea espera la traducción y la audiencia consulta cada 1,5 s; la latencia medida (10-70 ms) no es de punta a punta
- No tiene autenticación ni archivos de despliegue (Docker/HTTPS), y falta el .env.example que menciona el README
- La reconexión con Gemini existe pero se agota tras 4 intentos en toda la charla
- Suma overlay para OBS, exportación TXT/SRT/VTT y resumen de la sesión
