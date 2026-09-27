# Nerdearla Vibeathon 2026: Open Live Caption(s) (RaSol0/open-live-captions)

Evaluated from source (clone at commit `cd6e44a`); not run. Devpost: https://devpost.com/software/open-live-caption, video YouTube `RVn7e8Ya81k` (length unverified).

## Time window
- First commit `8c17eaf` 2026-09-17 21:23 GMT-3 (before window): scaffolding only (LICENSE, .env.example, .gitignore, requirements.txt, template README). Repo created 2026-09-17 21:22 GMT-3.
- First code `4ee05a4` 2026-09-24 17:45 GMT-3 (+919 lines). Last `cd6e44a` 2026-09-25 02:40 GMT-3. No late commits; author = committer dates.

## Gate: PASS
Mic ingest via /broadcast (server.py:380-403); input transcription + TranslationConfig (server.py:144-151); audience captions (audience.html:412); sessions dict + load_test.py + README scaling section.

## Scores
| Calidad | Latencia | Escalabilidad | Despliegue | Innovación | Total | Promedio |
|---|---|---|---|---|---|---|
| 3 | 2.25 | 2.5 | 2 | 2.75 | 12.5 | 2.5 |

## Key evidence
- Glossary is a hard-coded post-hoc capitalization regex (glossary.py:7-56, server.py:94); doesn't reach the model.
- Audience drops partials (audience.html:412); flush happens only on the next fragment or at 160 characters (server.py:81-91), with no timer.
- Stage IDs hard-coded (server.py:32-35,337,346; audience.html:193-195,277,357,369; broadcast.html:66,127); no URL params; unknown IDs fall back to the demo clip.
- Cost per stage × language (key `id:lang`, server.py:332); /ws-ingest feeds only `id:lang` of the broadcaster, so live audio reaches one language only.
- No auth anywhere (ingest, /sessions/close, /admin, /status, export); XSS in admin.html:143,148; ws:// hard-coded (audience.html:390, broadcast.html:141,160); no Docker.
- Reconnect: 3 attempts, no backoff/resumption (server.py:123-137); audience WS has no reconnect (audience.html:396-399).
- Admin shows loop.time() (monotonic) as epoch time (server.py:79 vs admin.html:140-141).
- Export SRT/VTT/TXT with real relative timestamps (export.py, server.py:99-104); PT target; a11y toggles.

## Notas
- Usa Gemini Live Translate en un solo paso; la calidad es la esperable del modelo, pero el "glosario" solo corrige mayúsculas después y no llega al modelo
- La vista de audiencia muestra solo líneas finalizadas (sin parciales) y se cierran por silencio o a los 160 caracteres, lo que agrega bastante demora
- El servidor acepta sesiones nuevas, pero la vista de audiencia tiene 3 escenarios fijos y el micrófono en vivo solo llega al idioma elegido por quien transmite
- No hay autenticación en ingesta, cierre de sesiones ni panel; tampoco Dockerfile, y los WebSockets usan ws:// fijo (no funciona detrás de HTTPS)
- Reconexión limitada a 3 intentos, sin reanudación de sesión; la audiencia no se reconecta ni ve cuando se corta la señal
- Buen detalle la exportación SRT/VTT/TXT con tiempos reales, el portugués y las opciones de accesibilidad (texto grande, alto contraste)
