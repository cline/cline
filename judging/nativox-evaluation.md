# Nativox: Nerdearla Vibeathon 2026 evaluation

Devpost: https://devpost.com/software/nativox
Repos: https://github.com/Vanessaalberti/nativox-app (MIT) and https://github.com/Vanessaalberti/nativox-landing (proprietary landing)
Demo: https://www.youtube.com/watch?v=kRSsCf2vV3g (duration not verified: YouTube blocked the automated check)

## Gate: PASS
1. Audio input: device/console line, browser tab, direct URL, file (`navegador/funcionalidades/sesion-en-vivo/motor/armar-sesion.ts:90-101`). No test audio files included (`muestras/audios/` is only a README).
2. Transcription: Whisper large-v3 turbo locally with WebGPU (`navegador/modulos/modelos-compartidos/whisper.ts`) or on Workers AI (`servidor/plataforma/transcriptor-workers-ai.ts`).
3. EN→ES translation: Bergamot or TranslateGemma in the browser.
4. Subtitles: audience view, stage screen, transparent OBS/vMix page.
5. Multiple sessions: one Durable Object per room, rooms created at runtime; the README explains how to scale.

## Scores
| Calidad | Latencia | Escalabilidad | Despliegue | Innovación | Total | Promedio |
|---|---|---|---|---|---|---|
| 3.5 | 2.75 | 3.75 | 4 | 4.25 | 18.25 | 3.65 |

- Calidad (= NejoyT): 3-layer glossary per talk (Whisper prompt, post-correction, protected translation) plus live corrections saved to the glossary. No real-audio proof; WER 1.4% was self-measured on synthetic voice.
- Latencia (between NerdLingo and OmniStage): local partials are original-language only; translation starts only when the phrase closes; self-measured 5.4 s. Cloud mode: 4–8 s phrases, no partials.
- Escalabilidad (+ aura): runtime rooms, no hard-coded IDs, DO + D1 state, AI cost per room and zero per viewer. Needs one publishing browser (own model copy) per room.
- Despliegue (− Glosa): one-click Cloudflare deploy, solid auth on every ingest path, WS reconnect with buffered lines, server-side Discord alerts with one-time links, monitor, TXT/SRT/VTT export.
  Confirmed gaps:
  - "Reiniciar" reloads the page but does not resume the session (`usePublicacion.ts:45`; `iniciar` is only called from the form).
  - "Pasar a la nube" and "equipo de reserva" are not implemented.
  - The audience "En vivo" badge reflects the viewer's own socket, so it doesn't show when the room goes down.
  - SRT timestamps reset to 0 with each new capture session.
- Innovación (− Glosa): fully local browser pipeline, "Evaluar esta computadora", per-room agenda with a transcript per talk, production outputs with on-air switching, unattended alerts. No QR; "modo caos" is only a simulation.

## Time window
23 commits, all between 2026-09-24 18:49 and 2026-09-25 10:36 GMT-3. Author and committer dates match on every commit. The repo was created 2026-09-24 15:06 GMT-3 and is not a fork. The Devpost description update was posted after the deadline (text only). The large commits are scaffolding (env.d.ts and the lockfile) plus one 9k-line commit after 12 h of incremental history.

## Spreadsheet row
3.5 | 2.75 | 3.75 | 4 | 4.25 | 18.25 | 3.65 |
- Transcribe y traduce en el navegador (Whisper + Bergamot o TranslateGemma) sin API keys, con opción de nube en Workers AI
- El glosario por charla llega al modelo, a la corrección y a la traducción, y las correcciones en vivo se recuerdan
- La traducción aparece recién al cerrar la frase (unos 5 s según sus propias mediciones); en la nube no hay texto provisorio
- Salas creadas en el momento, un Durable Object por sala y sin costo de IA por espectador; cada sala necesita su propia computadora con navegador
- Deploy de un clic, buen control de acceso, alertas a Discord y exportación SRT/VTT; "Reiniciar" no retoma la sesión sola
- Faltan audios de prueba en el repositorio y la audiencia no ve cuando la sala se cae
