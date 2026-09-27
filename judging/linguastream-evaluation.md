# Nerdearla Vibeathon 2026 — LinguaStream (Letalc/LinguaStream)

Read-only code review of https://github.com/Letalc/LinguaStream (cloned to /tmp, not run).
SDK fields verified against @google/genai@2.24.0 types (customVocabulary, translationConfig, targetLanguageCode exist).

## Gate: PASS
1. Audio: mic/mixer or tab audio (lib/audio-capture.ts:15-33); headless WAV script (scripts/simulate-room.ts). No test audio in repo.
2. Original transcript: inputTranscription (lib/live-transcriber.ts:251-255).
3. EN->ES: translationConfig.targetLanguageCode (convex/gemini.ts:58).
4. Subtitles: /s/[id], /overlay/[id], /present/[id].
5. Multi-session: runtime sessions (convex/sessions.ts:86-125); real 3-room 30-min test; scaling in README.md:166-178.

## Time window: all commits inside
- First: 90b28ca 2026-09-24 19:21:59 GMT-3; last: f96bc37 2026-09-25 12:02:09 GMT-3. Author == committer everywhere.
- Repo created 2026-09-24T23:13:24Z, pushed 2026-09-25T15:02:12Z, not a fork.
- Note: 2150d47 (18 min after scaffold) adds ~2.1k app LOC + ~4.3k generated/skill files. Claude co-authored.
- Demo video: not found (Devpost blocked automated access; check manually).

## Scores
| Calidad | Latencia | Escalabilidad | Despliegue | Innovación | Total | Promedio |
|---|---|---|---|---|---|---|
| 3.5 | 3.5 | 3.75 | 4.25 | 4.25 | 19.25 | 3.85 |

- Calidad = Glosa/aura: Gemini live-translate; glossary per event/talk (also auto-extracted from slides) reaches the model via customVocabulary + systemInstruction (gemini.ts:55-61, 80-89). Only ~5 s audio buffered on reconnect (live-transcriber.ts:45).
- Latencia = Glosa: 100 ms PCM chunks, partials <=150 ms, self-measured ~1.1 s original / ~2.5 s translation (docs/VALIDATION.md, unverified).
- Escalabilidad > Live Subs/aura: runtime rooms, Convex shared state, cost per room x target language; 10 rooms hit Gemini quota. translateSegment (gemini.ts:92-149) declared but unused. One browser console per room.
- Despliegue < Glosa: resumption + GoAway + stall watchdog + backoff; heartbeat + stale cron; console takeover; requireAdmin fails closed (convex/lib/auth.ts:13-19); ephemeral tokens; admin panel; TXT/SRT/VTT; Vercel + Convex + Docker. Weak: shared password; sessions.dashboard and events.recent public; committed "demo" key (DEMO_MODE only, limits removed in 877c6bc); standard audience view shows no outage notice; SRT timestamps reset on console restart (console/[id]/page.tsx:114, live-transcriber.ts:362).
- Innovación < Glosa: slides->glossary, accessible mode (LSA interpreter video, vibration, re-read), live-first TTS, slides+CC page, QR/codes, presence, PT.

## Top improvements
1. Wire translateSegment for cheap per-viewer languages (2-4 h).
2. Auth hardening: public admin queries, roles, demo limits (2-3 h).
3. Outage notice in audience view/overlay (1 h).
4. Stable SRT timestamps from session.startedAt (1 h).
5. Headless RTMP/HLS ingest worker + test audio (1-2 days).

## Spreadsheet row
3.5 | 3.5 | 3.75 | 4.25 | 4.25 | 19.25 | 3.85 |
- La calidad es buena y el glosario por evento o charla llega al modelo; además se puede extraer con IA desde las diapositivas
- La latencia es baja, con subtítulos parciales y mediciones propias de ~1 s para el original y ~2,5 s para la traducción
- Las salas se crean en tiempo de ejecución y el estado está en Convex; el costo crece por sala e idioma, no por espectador
- Muy buena operación: reconexión automática con reanudación de sesión, panel completo y contraseña que no falla abierta
- Se recomienda proteger las consultas del panel que hoy son públicas y avisar al público cuando la consola se cae
- Destaca el modo accesible (intérprete de LSA, vibración, releer), la lectura en voz alta y la salida Presentación + CC
