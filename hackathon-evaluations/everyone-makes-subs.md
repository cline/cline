# Nerdearla Vibeathon 2026 — Evaluación: Everyone Makes Subs

Repo: https://github.com/tomas-nobile/everyone-makes-subs (clonado en /tmp/eval, historial completo; código leído, no ejecutado).

## Elegibilidad (ventana temporal)
- Primer commit: 369dc7b · 2026-09-24 20:34:43 GMT-3 (autor = committer)
- Último commit: cd3cabe · 2026-09-25 13:03:26 GMT-3 (cambio de código)
- Ningún commit fuera de la ventana; autor/committer coinciden en los 80 commits; una sola rama.
- GitHub: creado 2026-09-24 23:29 GMT-3, no es fork, último push 13:03 GMT-3.
- Nota: las primeras ~4 h de historial se subieron en un solo push al crear el repo. Commits cada 1–2 min (dos agentes de Claude Code, según el README). Sin indicios de trabajo previo.

## Gate: PASA (los 5 requisitos)
Mic de estación por WS, URL/YouTube/HLS con ffmpeg, archivo, RTMP/SRT con MediaMTX; samples incluidos · Gemini Live `gemini-3.5-transcribe-live` · traducción a `es` forzada · vista de teléfono/TV/overlay · salas creadas en tiempo de ejecución + README "How to scale".

## Puntajes
| Criterio | Puntaje | Referencia | Motivo |
|---|---|---|---|
| Calidad | 3.5 | Glosa/aura (=) | Glosario por charla que llega a customVocabulary, al prompt y a los reemplazos |
| Latencia | 3.5 | Glosa (=) | Parciales; p50 medido ~0,8 s al original / ~2,6 s al español; p95 free tier ~41 s |
| Escalabilidad | 3.5 | aura/OpenSimultánea (=) | Salas en runtime, costo por sala, un SSE por sala; un solo proceso en memoria |
| Despliegue y operación | 4.25 | Glosa (−) | Docker, instalador, túnel, auth, reconexión + rotación, panel, SRT/VTT; el setup queda abierto mientras no hay contraseña |
| Innovación | 4.5 | Glosa (=) | Agenda automática, "¿Qué me perdí?", QR, TV, subtitulado de videos, modo stream con retraso |
| **Total** | **19.25/25** | Promedio **3.85** | |

## Video
- Pitch: 2:39 (158,8 s), supera el límite de 2 min.
- Demo anterior: 1:52 (111,8 s), dentro del límite.

## Fila para la planilla
3.5 | 3.5 | 3.5 | 4.25 | 4.5 | 19.25 | 3.85 |
- El glosario por charla (generado con Gemini y editable) llega al reconocimiento de voz, al prompt de traducción y a los reemplazos
- Latencia medida y documentada: ~0,8 s al original y ~2,6 s al español (p50), con subtítulos en progreso; en el free tier el p95 sube mucho
- Salas creadas en tiempo de ejecución o desde la agenda, con costo por sala y no por espectador; todo corre en un solo proceso, sin estado compartido
- Operación muy completa: Docker, instalador, túnel HTTPS, reconexión y rotación de sesiones de Gemini, panel de monitoreo y exportación SRT/VTT/TXT
- Muchos extras útiles: agenda automática, "¿Qué me perdí?", QR, pantalla de sala, overlay para OBS y subtitulado de videos
- Mientras no hay contraseña, el asistente de configuración queda abierto a cualquiera; el video pitch dura 2:39 y supera el límite de 2 minutos

## Evidencia clave (rutas dentro de everyone-makes-subs/)
- Glosario: server/src/ai/auxModel.ts:49-73; routes/admin.ts:124-130; StageWorker.ts:68-71; LiveSession.ts:53; Translator.ts:87; Segmenter.ts:120,149-156
- Reconexión/rotación: server/src/asr/Transcriber.ts:159-251
- Auth y setup abierto: server/src/auth.ts:59-80; routes/setup.ts:44-68
- Clave de estación en la URL: web/src/hooks/useStationAudio.ts:70
- Exportación: server/src/store/export.ts:29-90
- Escala: docs/scale.md:15; bench/latency-2026-09-25T11-19-19.json
