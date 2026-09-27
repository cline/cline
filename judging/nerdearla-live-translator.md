# Evaluación Vibeathon 2026 — Franko007/nerdearla-live-translator

Evaluación por lectura de código (no ejecutado). Clon: https://github.com/Franko007/nerdearla-live-translator (ramas main, vertex-version, localrun).

## Gate: PASA
1. Audio: mic navegador → WS (`app/static/admin.html:503-519`, `app/main.py:159-215`); archivo/HLS/RTMP vía ffmpeg (`app/audio/ffmpeg.py:33-60`). Samples con voz: `speech-tts-en.wav`, `speech-15s.mp3`, `Scott_Sosna.mp3`.
2. Transcripción: ventanas de 4 s con generate_content (`app/transcribers/gemini.py:24,271-326`).
3. Traducción EN→ES: `app/segmenter.py:68-73`, `app/translators/gemini.py`.
4. Subtítulos: `/` (app.js) y `/overlay/{id}` por SSE (`app/main.py:228-269`).
5. Multi-sesión: tareas asyncio por sesión (`app/session.py:108-112`); README sección de escalado.

## Ventana temporal
- Primer commit 39b3186: 24-09 13:25 GMT-3; último 9237b0d (merge): 25-09 13:26 GMT-3. Autor = committer en todos. Ninguno fuera de ventana.
- Repo creado 2026-09-24T16:24:59Z, último push 2026-09-25T16:26:27Z, no fork.
- Nota: fbfde5e trae ~4.8k líneas en 51 archivos (1.120 de uv.lock); dos identidades (Franko007 / fjescala@gmail.com).
- Video demo: no encontrado (verificar Devpost).

## Scores
| Criterio | Score | Ref | Motivo |
|---|---|---|---|
| Calidad | 3 | NerdLingo (=) | Gemini flash-lite; glosario de evento solo en traducción (`translators/gemini.py:28-29`); ventanas de 4 s sin solape (`gemini.py:278-291`) |
| Latencia | 2.5 | OmniStage_AI (=) | Ventanas de 4 s, sin parciales en modo por defecto, traducción en serie; no medida |
| Escalabilidad | 3.25 | Josefina/OmniStage (−) | Salas en runtime, costo por sala×idioma; memoria de un proceso; 2 SSE por sala por espectador (`app.js:114-127`); Cloud Run max-instances 1 / concurrency 10 |
| Despliegue | 2.5 | NerdLingo (=) | Docker + Cloud Run + panel; sin auth en ningún endpoint; sin recuperación ante caída de Gemini; reconexión Live nunca se ejecuta (`gemini.py:197-213`); `--timeout 300` |
| Innovación | 3.25 | NerdLingo (−) / Live Subs (+) | Overlay OBS con traducción, export SRT/VTT/TXT, monitor, HLS, pt/de/fr; YouTube roto (`youtube.py:56` usa `subprocess` sin importar; yt-dlp no está en deps) |
| **Total** | **14.5/25** | | **Promedio 2.9** |

## Bugs confirmados
- `app/transcribers/gemini.py:197-213`: `send` se cancela y se espera en el `finally`, por lo que `send.done()` siempre es True y el loop de reconexión/backoff nunca corre.
- `app/youtube.py:56`: `subprocess` no importado; `yt_dlp` ausente en `pyproject.toml`/`uv.lock` (el Dockerfile lo instala con pip3 del sistema, fuera del venv de uv).
- `app/session.py:147`: al reusar una sesión (reconexión del mic con el mismo ID) se reemplaza `self.segments` y se pierde la transcripción anterior para export.
- Sin auth: `/admin`, `POST/DELETE /api/sessions`, `WS /ws/audio/{id}`, `/api/resolve-source`; `source` arbitrario va directo a ffmpeg (`session_manager.py:123-126`).
- README dice que `talk-en-2.wav` es "replay con datos reales de Gemini", pero es un tono de 330 Hz generado por `scripts/make_samples.py:37-48,114` con texto escrito a mano.

## Fila para planilla
3 | 2.5 | 3.25 | 2.5 | 3.25 | 14.5 | 2.9 | Notas:
- La calidad es la esperable con Gemini flash-lite; el glosario se aplica solo a la traducción y los cortes fijos de 4 s pueden partir palabras
- La latencia es alta para seguir una charla: ventanas de 4 s sin subtítulos parciales, y transcripción y traducción en serie
- Las salas se crean en runtime desde el admin, el micrófono o una URL/HLS, y el costo escala por sala e idioma, no por espectador
- Buen overlay para OBS/vMix que muestra la traducción, exportación SRT/VTT/TXT y panel con métricas p50/p95
- No hay autenticación en el admin ni en la ingesta de audio, y si se cae la conexión con Gemini la sesión no se recupera sola
- La resolución de YouTube falla tal como se entrega y los audios del modo demo son tonos, no voz real

## Mejoras prioritarias
1. Auth por token (que no quede abierta sin la variable de entorno) en admin/API/WS + lista blanca de fuentes (~2-3 h).
2. Arreglar reconexión Live, reintentos en modo chunked, estado visible en el overlay, timeout de Cloud Run (~3-4 h).
3. Traducción en tarea aparte, ventanas de 1,5-2 s con solape o parciales (~medio día).
4. Selector de sala y link/QR por sala con un solo SSE (~2-3 h).
5. Glosario/contexto por sala que llegue también a la transcripción; arreglar YouTube (~2-3 h).
