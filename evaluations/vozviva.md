# VozViva — Nerdearla Vibeathon 2026 evaluation

Repo: https://github.com/AICA-Code-Studio/vozviva (code reading only; not run)

## Gate: PASS
1. Audio: /caster browser mic (static/caster.html:91-108, server.py:340-370); ffmpeg SRT/RTMP/HLS/file (sources.py:15-62). No test audio in repo.
2. Transcription: gemini-3.5-transcribe-live with interim (backends/gemini_live.py:198-239).
3. EN→ES: GeminiTranslator per final sentence (translate.py:62-92, worker.py:150-196).
4. Subtitles: SSE audience view (app.js:390-453), OBS overlay (overlay.html).
5. Multi-session: worker per configured room (server.py:64-70); Redis scaling in docs/DESPLIEGUE.md:86-94.

## Scores
| Cal | Lat | Esc | Desp | Innov | Total | Avg |
|---|---|---|---|---|---|---|
| 3.5 | 3.25 | 3.75 | 3.75 | 4.75 | 19 | 3.8 |

- Calidad: glossary from agenda → custom_vocabulary (gemini_live.py:214) + translation prompt (translate.py:30-31). Bug: seg counter restarts at 1 (backends/base.py:34) and collides with persisted transcripts (export.py:15-21, app.js:423).
- Latencia: 100 ms streaming, partials, sentence stabilizer (stabilizer.py); no end-to-end measurements published.
- Escalabilidad: config rooms, no hard-coded IDs, clean 404s; Redis pub/sub + --sessions split; cost per stage. No runtime rooms.
- Despliegue: reconnect w/ backoff (gemini_live.py:104-122), rotation at 540 s in silence + go_away (:162-187), Docker healthcheck, fail-closed ingest token (server.py:343-350), full /ops. /ops unauthenticated, token in URL, no HTTPS bundled, audience doesn't see outages.
- Innovación: tap-to-explain, ¿Qué me perdí?, Español fácil, TTS read-aloud, speaker pace monitor, agenda auto-glossary, QR posters — all wired.

## Eligibility
Commits 5660811 (2026-09-25 10:38 GMT-3) and 92405b3 (10:54, docs only). Repo created 10:40 GMT-3, not a fork. Red flag: single commit of 84 files / 9,657 lines.
Demo video: not found (Devpost has none; docs/PRESENTACION.md:14 placeholder).

## Spreadsheet row
3,5 | 3,25 | 3,75 | 3,75 | 4,75 | 19 | 3,8 |
- La transcripción usa Gemini Live con parciales, y el glosario por charla (armado desde la agenda) llega al reconocimiento y a la traducción
- Muy buen estabilizador de oraciones que adelanta la traducción, aunque no se publicaron mediciones de latencia de punta a punta
- Las salas se definen por configuración y se pueden repartir entre nodos con Redis; el costo crece por sala, no por espectador
- Buena recuperación ante caídas de Gemini (reconexión y rotación de sesión), Docker y un tablero /ops muy completo, pero /ops no tiene autenticación y la clave de envío viaja en la URL
- Funciones muy valiosas para la accesibilidad: "Tocá una frase y te la explico", "¿Qué me perdí?", Español fácil, lectura en voz alta, monitor de ritmo para el orador y carteles con QR
- Tras un reinicio, la numeración de frases vuelve a empezar y puede pisar la transcripción guardada
