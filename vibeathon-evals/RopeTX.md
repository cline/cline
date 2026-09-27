# Evaluación: RopeTX (https://github.com/daisytorrico/RopeTX)

Evaluated by reading the code only (not run). Line refs are to HEAD `7f92558` unless noted.
Scores are for the last in-window commit `4255cf7`.

## Eligibility (time window)
- First commit `2c65070`, 2026-09-25 03:08:58 GMT-3 (author = committer). 96 files, 12,004 lines in one commit.
- Last in-window commit `4255cf7`, 11:13:08 GMT-3 (docs only).
- **Late commit `7f92558`, 15:52:52 GMT-3 (52 min after deadline). Code change** (gemini_asr.py, audio_service.py, AudioInjectionModal.tsx).
  Removes the `clean_source` definition but `gemini_asr.py:68` still uses it → NameError when room language is "auto" (the default).
- Repo created 2026-09-25T06:01:31Z, not a fork. Last push 2026-09-26T03:37Z (after the deadline).
- Demo video: not found in the repo (README only has a script); Devpost blocked automated access, check by hand.

## Gate: PASS (requirement #5 weak: the README only says "más de 30 salas", with no scaling explanation)

## Scores
| Criterion | Score | Closest ref | Reason |
|---|---|---|---|
| Calidad | 3.0 | NerdLingo = | Glossary reaches ASR custom_vocabulary + translation prompt (+); single pending_text slot drops translations (gemini_translator.py:358-363); "auto" forces es-419 (gemini_asr.py:146); drops audio when >20 chunks queued (routes_ws.py:45) |
| Latencia | 3.0 | NerdLingo/Josefina = | Live interims in original language; translation only after final lines, not streamed; displayed latency is not end-to-end |
| Escalabilidad | 3.5 | aura/Josefina = | Runtime rooms in SQLite; cost per room not per viewer; single process, Compose microservices never receive audio |
| Despliegue | 2.75 | Live Subs + / aura − | Docker/Compose/Cloud Run/Firebase, JWT panel, SRT with real timestamps, reconnect w/3 retries; BUT /ws/stream has no auth, login accepts "admin"/"demo"/"operador"/"AdminSecret2026" (routes_auth.py:15), default token committed, no session resumption |
| Innovación | 3.5 | aura = | OBS/vMix overlay with translation + URL options, PT + bilingual, QR, RTMP/HLS input, 3.5mm station script, API-key pool |
| **Total** | **15.75 / 25** | | **Promedio 3.15** |

## Spreadsheet row
3 | 3 | 3.5 | 2.75 | 3.5 | 15.75 | 3.15 | - La transcripción con Gemini Live muestra subtítulos parciales en vivo y el glosario por sala llega tanto al ASR como a la traducción
- La traducción solo se hace sobre frases finales y, con varias frases seguidas, algunas se pierden (se pisa la frase pendiente)
- Las salas se crean desde el panel y el costo crece por sala, no por espectador; los microservicios del docker-compose no están conectados al flujo principal
- Buen overlay para OBS/vMix con traducción y opciones por URL, además de QR, portugués y exportación SRT
- La ingesta de audio por WebSocket no pide autenticación y el login acepta claves fijas como "admin" o "demo"
- El último commit (15:52) quedó fuera del horario del evento y rompe el modo de idioma "auto"

## Open questions
1. Does `session.receive()` stop after the first turn_complete (SDK live.py:471-474)? Stream the 3-min test clip and check that subtitles keep coming.
2. Real end-to-end latency: not measured anywhere in the repo.
3. Behaviour after 10-15 min (Live API connection limits).
4. Demo video length on Devpost.
5. Does the live deployment accept "admin"/"demo" as the login password?

## Top improvements
1. Auth on /ws/stream, remove hard-coded passwords, fail if ADMIN_TOKEN is unset (~2 h)
2. FIFO translation queue instead of a single slot (~1-2 h)
3. Fix "auto" language mode + restore the clean_source line (~1 h)
4. Live session resumption, unlimited retry, mic reconnect, real latency metric (~4-6 h)
5. Wire Redis pub/sub so the microservices actually run; document scaling (1-2 days)
