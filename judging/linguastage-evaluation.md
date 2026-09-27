# LinguaStage (tiziimusca/LinguaStage) — Nerdearla Vibeathon 2026 evaluation

Evaluated commit: `ffbcacf` (single commit, only branch `main`).

## Gate: FAIL (requirements 2 and 4; 1 only partial)
- Req 1 (live audio): browser mic path exists (`frontend/src/app/session/[id]/page.tsx:61-83` -> `backend/app/api/websocket.py:46-48` -> `session_manager.py:202-241`), but `numpy`/`faster_whisper` are missing from `backend/requirements.txt`; verified `import app.main` fails with `ModuleNotFoundError: numpy`.
- Req 2 (real-time transcription): FAIL. Demo pre-transcribes whole MP3 with Whisper base (`stt_engine.py:82-93`) and replays text word by word with sleeps (`stt_engine.py:117-153`). Mic path: ~256 ms chunks transcribed independently, no context (`stt_engine.py:160-170`). Runtime sessions also replay sample MP3 (`stt_engine.py:64-69`, `websocket.py:27-34`).
- Req 3 (EN->ES translation): in code — Gemini `gemini-1.5-flash` REST (`translation_engine.py:59`, availability unverified), fallback scrapes Google Translate web endpoints (`translation_engine.py:89-132`).
- Req 4 (subtitles displayed): FAIL. `frontend/src/lib/` excluded by `.gitignore:16` (`lib/`); verified `next build` fails: `Can't resolve '@/lib/api'` / `'@/lib/useWebSocket'`. `frontend/Dockerfile:24` copies missing `public/`.
- Req 5 (2 sessions + scaling doc): on paper (`session_manager.py:34-65`, `sessions.py:12-17`, `README.md:91-103`; Redis/NATS not implemented).

## Other confirmed defects
- Glossary substring replacement corrupts text (`glossary_engine.py:54-56`): verified `PostgreSQL`->`PostgreSQLSQLQL`, `tengo`->`tEngineeringo`, `production`->`Productoion`.
- No auth anywhere; CORS `*` (`main.py:25-31`); mic + manual caption input on public audience page (`session/[id]/page.tsx:169-209`).
- Latency metrics partly hard-coded (`session_manager.py:235,268,318`; `stt_engine.py:132,144`; `schemas.py:25-27`).
- Viewing auto-starts a session (`session/[id]/page.tsx:41`, `websocket.py:28-29`), so operator Stop does not hold.
- In-memory state only (`session_manager.py:26-28`); Gemini key in URL query (`translation_engine.py:59`); `google-genai` declared but unused.
- Portuguese selectable in create form (`operator/page.tsx:221-236`), only partly wired.
- License: MIT (OSI); typo "MECHANICAL" at `LICENSE:17` makes GitHub report NOASSERTION.
- Demo video: not found (no link in README; devpost.com/software/linguastage returns 404).

## Time window
Single commit ffbcacf, author = committer 2026-09-25 03:49:56 GMT-3; repo created 03:47:54, pushed 03:50:53 GMT-3. Inside the window. Red flag: one squashed commit (40 files, 4,521 lines + ~17 MB MP3s), no visible history. Author's other recent repo (robot_nlp) is unrelated.

## Advisory scores (gate fails; provisional only)
| Calidad | Latencia | Escalabilidad | Despliegue y operación | Innovación | Total (/25) | Promedio |
|---|---|---|---|---|---|---|
| 2 | 2 | 2.5 | 1.5 | 2.5 | 10.5 | 2.1 |

## Notas
- No cumple los requisitos mínimos: falta `frontend/src/lib/` en el repositorio y el frontend no compila (verificado con `next build`); puntaje orientativo
- La demo reproduce transcripciones hechas de antemano con Whisper; el micrófono envía fragmentos de ~256 ms sin contexto
- El glosario reemplaza subcadenas y corrompe palabras (p. ej. "production" → "Productoion")
- Las salas se crean en tiempo de ejecución, pero las nuevas reproducen el audio de ejemplo; el estado vive en memoria
- No hay autenticación ni exportación, y algunas métricas de latencia son valores fijos
- Buenas ideas de accesibilidad y un overlay para OBS que muestra la traducción
