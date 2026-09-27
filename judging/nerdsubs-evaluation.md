# NerdSubs — Nerdearla Vibeathon 2026 evaluation

Repo: https://github.com/Shinigamy19/nerdsubs (evaluated at HEAD `d2916cb`)
Devpost: https://devpost.com/software/nerdsubs

## Eligibility (organizers)
- Visible history: 2 commits. `a00c5e4` (24-09 06:11 GMT-3, only .gitattributes, before start) and
  `d2916cb` (single squashed commit, 64 files / +16,672 lines, dated 25-09 11:59 GMT-3).
- GitHub events show 27 original commits, repo created 25-09 02:08 GMT-3, last push 26-09 08:48 GMT-3.
- Last in-window push: `a0f6717` (25-09 14:49 GMT-3). Post-deadline pushes: `aa3a716`, `8199167` (25-09 15:04/15:22),
  `d908704`, `cef69fa`, `c3026cd`, `3db6222` (26-09 07:37–08:21), then force-pushed squashes with backdated dates.
- `git diff a0f6717 d2916cb`: 11 files, +829/−160 — Live API pipeline, audience view (/watch), captionStore, stages
  were added after the deadline.
- Demo video: not found (Devpost has none; README placeholder).

## Gate
Passed on code reading, but needs a hands-on check: Live API receives webm/opus labelled `audio/pcm;rate=16000`
(src/lib/gemini.ts:7, 202-206, 361-363); only the last chunk is sent (src/app/page.tsx:70-73); one Live session
shared by all stages (gemini.ts:223-231, 301-302).

## Scores
| Calidad | Latencia | Escalabilidad | Despliegue y operación | Innovación | Total | Promedio |
|---|---|---|---|---|---|---|
| 2 | 1.5 | 2 | 2 | 2.5 | 10 | 2.0 |

## Key evidence
- Chunks: useAudioCapture(15000), setInterval 16000 (page.tsx:29,156); partials discarded (gemini.ts:303, route.ts:65).
- Glossary declared but unused (src/lib/glossary.ts never imported; stages.ts glossary never read; fixed list gemini.ts:310).
- Translation target hard-coded "es" (gemini.ts:243); audience ?lang ignored (api/captions/[id]/route.ts).
- Hard-coded stages: stages.ts, stats.ts:13, sessionStore.ts:11-16, TranscriptionContext.tsx:55, overlay, editor, setup.
- No auth; /api/transcribe uses server key. No Docker/deploy files. In-memory state.
- captionStore seq bug freezes audience after 100 captions (captionStore.ts:18,28-30 + watch/[id]/page.tsx:54-55).
- SRT/VTT timestamps are absolute epoch (export.ts:4-9,45-62).
- Overlay link from /watch → /overlay/[id] 404 (watch/[id]/page.tsx:171).
- Extras: subtitle editor, FCPXML/Premiere/EDL export, 5-language UI, /setup OBS guide, /dashboard monitor.

## Notas (spreadsheet)
- Usa Gemini Live para transcribir y Gemini Flash para traducir, con un buen prompt de intérprete y contexto de frases previas
- El audio se envía en bloques de 15 s y se descartan fragmentos, así que la latencia es alta y se pierde parte de lo que se dice
- La vista de público permite elegir sala, pero el selector de idioma no cambia la traducción y las salas están fijas en el código
- No hay autenticación ni archivos de despliegue; el estado vive en memoria
- El editor de subtítulos con exportación a SRT, Premiere y Final Cut es un buen extra, aunque los tiempos del SRT salen mal
- No encontramos video demo; buena parte del código se subió después del cierre, con el historial reescrito
