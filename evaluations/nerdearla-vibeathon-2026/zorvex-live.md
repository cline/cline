# Nerdearla Vibeathon 2026 — Zorvex Live (ElZorroZ/Hackathon-Nerdearla)

Repo: https://github.com/ElZorroZ/Hackathon-Nerdearla (evaluated by reading code at commit 602fb4e; not run)

## Eligibility
- First commit 00f7825: 2026-09-24 21:43:52 GMT-3 (author = committer). Last commit 602fb4e: 2026-09-25 14:56:47 GMT-3 (README only). Last code commit 1580da0: 14:07:34 GMT-3 (co-authored by Devin).
- No commits outside the window. Repo created 2026-09-24 22:39 GMT-3, last push 14:56:50 GMT-3, not a fork, 32 commits with gradual growth. No red flags.
- Demo video: not found (not in README; Devpost blocked automated check — verify manually).

## Gate: PASS
1. Audio: mic (AdminApp.tsx:204-288), file upload (AdminApp.tsx:328-365, broken by byte slicing), CLI WAV streaming (stream_sample.py). Test audio gitignored; download via download_samples.py (yt-dlp).
2. Transcription: faster-whisper large-v3 (whisper_engine.py:80-95).
3. Translation: gemma2:2b via Ollama (translator.py:39-78), background per requested language.
4. Subtitles: web, OBS overlay, stage (QR), mobile.
5. Two rooms (config.py:21), round-robin in one thread; scaling in README:115-168.

## Scores
| Criterion | Score | Closest ref | Reason |
|---|---|---|---|
| Calidad | 2.75 | NerdLingo/OmniStage (3) − | Whisper large-v3 good; Gemma 2B on isolated 3 s fragments, no glossary (removed d479d3a), no overlap on browser capture, Zero-Lag drops queued audio |
| Latencia | 2.5 | OmniStage (2.5) = | 3 s chunks, no partials, translation afterwards, no measurements; key-moment extraction blocks Whisper loop (room_manager.py:291-293) |
| Escalabilidad | 3.0 | Josefina/OmniStage (3.5) − | Runtime rooms, cost per room+language; single sequential Whisper thread, in-memory state, single process |
| Despliegue | 2.25 | NerdLingo/Live Subs (2.5) − | No auth anywhere, no Docker/deploy files, NVIDIA/WSL setup; monitor panel, Gemma fallback to original, client reconnect |
| Innovación | 3.25 | NerdLingo/aura (3.5) − | OBS overlay with translation, PT, stage QR, audio-quality monitor, export, PWA; summary/key moments have no UI |
| Total | 13.75/25 | | Promedio 2.75 |

## Confirmed issues
- File upload slices raw bytes into 96 KB pieces every 500 ms (AdminApp.tsx:336-358); WAV path assumes 16 kHz mono (whisper_engine.py:161-166).
- Stage/Mobile append translation updates as new lines (StageApp.tsx:40-47, MobileApp.tsx:28).
- /flush calls clear_room which clears transcript history (routes_rooms.py:137, room_manager.py:191).
- Export: last 500 entries only (main.py:63), wall-clock SRT/VTT timestamps (subtitle_store.py:82-93), default language only.
- Requested languages per room never expire (room_manager.py:90-93).
- App.tsx:135-140 silently falls back to first room on unknown ?room=.
- `requests` missing from requirements.txt (used in stream_sample.py:21).

## Spreadsheet row
Calidad | Latencia | Escalabilidad | Despliegue y operación | Innovación | Total | Promedio
2.75 | 2.5 | 3 | 2.25 | 3.25 | 13.75 | 2.75

Notas:
- Pipeline 100% local (Whisper large-v3 + Gemma 2 2B), sin costo por minuto ni envío de audio a terceros
- La traducción usa un modelo chico sobre fragmentos de 3 s sin contexto, y el glosario fue removido
- Chunks de 3 s sin subtítulos parciales; un único hilo de Whisper procesa todas las salas en serie
- Se pueden crear salas en caliente y cada espectador elige idioma (ES/EN/PT), pero todo el estado vive en memoria
- No hay autenticación en el panel ni en la ingesta de audio, y no hay Docker ni archivos de despliegue
- Buen overlay para OBS con traducción, vista de escenario con QR y panel de métricas con calidad de audio

## Open questions
1. Real end-to-end latency with 2 rooms on RTX 3060 (watch for [Zero-Lag] flush logs).
2. Gemma 2B translation quality on technical English (ted_tech_en.wav).
3. Whether MP3/44.1 kHz WAV upload works at all.
4. Demo video on Devpost.
