# Nerdearla Vibeathon 2026: evaluation of KavishKapila/nerdearla-live-subtitles

I evaluated commit `004a91c` (the only commit on `main`) by reading the code. I did not run it.

## Eligibility (for the organizers, not scored)
- One commit, `004a91c`: author and committer date 2026-09-25T18:07:16+05:30, which is 09:37 GMT-3. That is inside the window.
- Repo created 2026-09-25 12:26Z; pushes at 12:27, 12:29 and 12:37Z. Not a fork.
- Red flags:
  - The whole project (2,932 lines) arrived in a single commit.
  - The Events API shows an earlier chain (`7931317` Initial commit, `12d55d1` zip upload, `8ec31d1` delete zip). It was replaced by a parentless commit, so the history was rewritten.
  - The code was built somewhere else and uploaded as a zip, so nothing shows it was developed inside the window.
- Demo video: none found in the README or repo. Devpost couldn't be checked automatically (bot check); organizers should look by hand.

## Gate: PASS (with caveats)
1. Audio: browser mic sent over WS (`frontend/index.html:513-523`); WAV streaming script (`scripts/simulate_speaker.py`); sample MP3s through batch upload (`index.html:786-803`).
2. Transcription: local faster-whisper small, language auto-detected (`app/transcription.py:115-126`); partials every 1.2 s (`app/session_manager.py:224-271`).
3. Translation: DeepL (`app/translation.py`). With no key it silently falls back to passthrough (`translation.py:115-129`).
4. Display: listener view (`index.html:165-218`).
5. Sessions created at runtime (`session_manager.py:590-611`); scaling section at `README.md:63-68`.

Caveat: `local_files_only=True` (`transcription.py:93`) stops the model downloading on a fresh install, although `run.py:29` says the first run downloads it.

## Scores
| Criterion | Score | Closest ref | Reason |
|---|---|---|---|
| Calidad | 2.75 | NerdLingo/Josefina − | Whisper-small beam 1 + DeepL; env-var vocabulary prompt reaches Whisper (+); buffer keeps silence and the 15 s cap counts pauses, so sentences are cut and first words clipped (`session_manager.py:179,234-241,293`) (−) |
| Latencia | 2.75 | NerdLingo − | Original-language partials every 1.2 s re-transcribing the whole buffer; translation only after the final; nothing measured |
| Escalabilidad | 3.25 | Josefina/OmniStage − | Runtime sessions, cost per stage; one process, in-memory state, one shared model; Redis in the README not implemented |
| Despliegue | 2.25 | NerdLingo/Josefina − | No auth (delete, audio WS and upload all open); no Docker; `.env.example` missing; port 8000 hard-coded in the frontend; no speaker reconnect or offline status; real-timestamp SRT/VTT/JSON/TXT exports, health/metrics endpoints |
| Innovación | 2.75 | Josefina + / NerdLingo − | QR + share link, upload mode with parallel translation, automatic translation direction; no OBS or monitor panel |
| **Total** | **13.75/25** | | Average 2.75 |

Also confirmed: the Gemini class references `settings.GEMINI_API_KEY` and `GEMINI_MODEL`, which aren't defined in `config.py`, and only `RuntimeError` is caught (`transcription.py:137-142,181`). Setting `TRANSCRIPTION_ENGINE=gemini` crashes the server at startup.

## Top improvements
1. Auth plus a separate operator console (3–4 h).
2. Remove `local_files_only`, add `.env.example`, Docker/Caddy, `RELOAD=false`, and a same-origin backend URL (3–5 h).
3. Fix segmentation: trim silence, time from the first speech, add overlap (3–4 h).
4. Speaker reconnect and offline status; per-viewer language by translating into both languages (4–6 h).
5. Repair or remove the Gemini path (2 h).

## Spreadsheet row
2.75 | 2.75 | 3.25 | 2.25 | 2.75 | 13.75 | 2.75 |
- Transcripción local con faster-whisper (small) y traducción con DeepL; el prompt con términos técnicos llega a Whisper, pero la segmentación corta frases a mitad y puede recortar la primera palabra después de una pausa
- Hay subtítulos parciales en el idioma original cada ~1,2 s; la traducción recién aparece al terminar la frase y no hay mediciones de latencia
- Las sesiones se crean en tiempo real y el costo es por escenario, no por espectador; todo corre en un solo proceso con estado en memoria y un único modelo compartido
- No hay autenticación: cualquier espectador puede borrar sesiones o transmitir audio en ellas; faltan archivos de despliegue y el `.env.example`
- Buen detalle el código QR, el link para compartir y la exportación SRT/VTT/TXT con marcas de tiempo reales
- No usa Gemini (la clase existe pero no funciona), y no tiene integración con OBS ni panel de monitoreo
