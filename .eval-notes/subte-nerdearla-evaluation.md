# Evaluation: davidgutierrezv/subte-nerdearla (Nerdearla Vibeathon 2026)

Evaluated by reading source at main@54615bb (clone in /tmp/subte-eval, not part of this repo).

## Gate: PASS (all 5)
- Audio: mic only via browser Web Speech API (lib/stage/speech.ts:23-30, components/stage/station.tsx:142-185). No file/stream input, no test audio.
- Transcription: Web Speech, interim every >=600 ms (station.tsx:26,82-87,150-152).
- Translation: google/gemini-2.5-flash-lite via Vercel AI Gateway (lib/live/translate.ts, lib/live/gateway.ts:4, lib/live/ingest.ts:64-99).
- Display: /s/[slug] (components/viewer/*).
- Multi-session: channel per session (lib/live/shared.ts:7-9), demo mode runs all (components/admin/live-demo.tsx); scaling explained only via Supabase limits.

## Scores
| Calidad | Latencia | Escalabilidad | Despliegue | Innovacion | Total | Promedio |
|---|---|---|---|---|---|---|
| 3 | 3 | 3.75 | 3.25 | 3.5 | 16.5 | 3.3 |

## Key findings
- Glossary per session reaches translation + recap prompts, not STT (admin/actions.ts:62-86 -> translate.ts:19-32).
- Interim captions only in source language (live-viewer.tsx:235); no measured latency.
- Runtime rooms/sessions in Postgres; stage IDs only in optional seed; unknown slugs 404.
- TRANSCRIPT_LIMIT=300 truncates late-join and export (lib/live/transcript.ts:8,49).
- Operator auth fails closed (lib/operator.ts:21-38); all write paths gated.
- A temporary reviewer operator key is committed in README on branch v0/readme-reviewer-key (commit e903e0d), not on main. [value redacted]
- No monitor panel, no station heartbeat, docs/* outdated (still say "planificado").
- Innovation: AI recap with clickable chapters, transcript search, Markdown export, all-rooms demo mode, room/projection mode, a11y.
- No demo video (README:71 says so); Devpost not reachable to confirm.

## Time window
First commit 2026-09-25 11:02 GMT-3, last 14:01 GMT-3 (README-only, side branch). All within window; repo created 11:27 GMT-3; not a fork; author=committer dates. No red flags.
