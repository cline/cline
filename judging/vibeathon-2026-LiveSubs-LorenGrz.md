# Nerdearla Vibeathon 2026 — LiveSubs (LorenGrz/VibeathonNerdearla2026)

Evaluated from source at HEAD `052a196` (not run). Full reasoning was delivered in the chat session.

## Eligibility
- First commit `ab26801` 2026-09-25 09:03:54 GMT-3; last `052a196` 2026-09-25 14:02:56 GMT-3. Author = committer dates.
- No commits outside window. Repo created 2026-09-25 08:43 GMT-3, not a fork. Pushes 09:04–14:02 GMT-3.
- First commit 10,127 lines, of which 8,731 are pnpm-lock.yaml. Very fast parallel AI-agent-style development (docs/planning/tasks). No action recommended.
- Demo video: README placeholder only; Devpost not verified.

## Gate: PASS (all 5)

## Scores
| Calidad | Latencia | Escalabilidad | Despliegue y operación | Innovación | Total (/25) | Promedio |
|---|---|---|---|---|---|---|
| 3.5 | 2.75 | 3.5 | 2.75 | 3.5 | 16 | 3.2 |

## Key evidence
- Glossary per session → `customVocabulary` (gemini-live.transcriber.ts:228-234) and translation prompt (gemini-translator.ts:65-66). DEFAULT_GLOSSARY_TERMS unused.
- Partials for originals; translations only after finals (maxSegmentMs 12 s, interimSilenceMs 15 s; CaptionsClient.tsx:20-24 estimates ~14 s).
- Runtime sessions, no hard-coded stages, cost per stage × target language; in-memory single process.
- Gemini reconnect on goAway/close with audio replay (gemini-live.transcriber.ts:201-308) + orchestrator backoff.
- No auth anywhere (TODO(auth) in app/admin/page.tsx:9); public QuickDemo starts sessions; DELETE doesn't stop pipeline (sessions.service.ts:70-73); NEXT_PUBLIC_API_URL baked at build.
- Innovation: broadcast-delay video sync (sync/programClock.ts), OBS overlay with translation, PT, SRT/VTT/TXT, metrics panel.

## Notas
- La calidad es la esperable con Gemini, y el glosario por sesión llega tanto al reconocimiento de voz como al prompt de traducción
- El original se ve en vivo con subtítulos parciales, pero la traducción espera a que se cierre la frase (hasta 12 s) y puede llegar con bastante demora
- Las sesiones se crean desde el panel sin salas fijas y el costo crece por sala, no por espectador; el estado queda en memoria en un solo proceso
- Muy buena reconexión con Gemini, Docker Compose con healthchecks, panel con latencia y errores, y exportación SRT/VTT/TXT
- No hay autenticación: cualquiera puede crear, iniciar o borrar sesiones, y la home permite lanzar la demo
- Muy original la sincronización del video con los subtítulos mediante un delay; también suman el overlay para OBS y el soporte de portugués
