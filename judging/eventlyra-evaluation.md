# EventLyra — Nerdearla Vibeathon 2026 evaluation (backup)

Repo: https://github.com/jinderve/EventLyra · Devpost: https://devpost.com/software/eventlyra
Evaluated by reading code (not run). Full report was delivered in the conversation; this is a summary.

## Eligibility
- First commit b562d01 2026-09-24 21:39:51 GMT-3; last a6f21ba 2026-09-25 14:59:53 GMT-3 (content commit 186d3c9 14:59:33).
- No commits outside window; repo created 2026-09-24 21:33 GMT-3, not a fork; all pushes in window.
- Notes: d537466/028a305 rebased (both dates in window); 028a305 is +9,904 lines mid-event; 1b0f000 authored by "Cursor Agent".
- Demo videos: E1sC3AfWnHU (main), DjPam9h5LOE, NT-c5IBNEKU — lengths NOT verified (YouTube blocked from sandbox).

## Gate: PASS
Mic (apps/web/src/lib/mic.ts), file upload (apps/api/app.py:235-300), YouTube live/VOD via yt-dlp (services/live_engine/url_source.py:240-313); faster-whisper turbo ASR; TranslateGemma 4B translation (runtime.py:168-173); /watch and /overlay via SSE; K sessions (sessions.py:277-287), README scaling section (README.md:277-287).

## Scores
| Criterion | Score | Ref | Reason |
|---|---|---|---|
| Calidad | 3 | = Josefina/OmniStage | Whisper turbo + TranslateGemma 4B; 5-term fixed post-hoc glossary; no chunk overlap; no translation context |
| Latencia | 2.5 | = OmniStage | 8 s (mic/file) / 4 s (YouTube) chunks, no partials, single GPU lock; only inference time measured; YouTube picture delayed to sync |
| Escalabilidad | 3 | between NerdLingo and Josefina | K fixed at startup, cost per stage not viewer, one-GPU ceiling, in-memory state, independent instances |
| Despliegue | 2.25 | − OmniStage/NerdLingo | No auth anywhere; Docker runs --sin-modelos (no captions); Windows-only GPU setup with E:\ paths; no YouTube retry; has health, desk, export |
| Innovación | 3.5 | = NerdLingo/aura | OBS/vMix overlay with translation, SRT/VTT/TXT, PT, production desk, video-caption sync |
| Total | 14.25/25 | | Promedio 2.85 |

## Spreadsheet row
3 | 2.5 | 3 | 2.25 | 3.5 | 14.25 | 2.85 |
- Solución 100% local (faster-whisper + TranslateGemma 4B) que comparte una sola copia de los modelos entre varias salas; muy buen README y honesto con sus límites
- La latencia es alta: fragmentos de 8 s (micrófono) o 4 s (YouTube), sin subtítulos parciales y una sola GPU que atiende las salas por turnos
- Buen detalle de sincronizar el video de YouTube con los subtítulos, y overlay para OBS/vMix que muestra la traducción
- Exporta SRT/VTT/TXT con tiempos reales y tiene un panel de producción con latencia, cola y espectadores
- No hay autenticación en ningún endpoint, el Docker corre sin modelos y la instalación con GPU es solo para Windows
- El glosario es fijo (5 términos) y se aplica después, sin llegar al modelo; cada persona elige ver original o traducción, pero no el idioma

## Open questions
1. Real end-to-end latency with K=2 (watch queue_wait_ms in /live).
2. TranslateGemma 4B quality vs Gemini on a shared clip.
3. Word loss at 8 s/4 s chunk seams.
4. Main demo video length vs 2-minute cap.
