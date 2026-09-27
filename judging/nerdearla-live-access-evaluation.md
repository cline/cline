# Nerdearla Vibeathon 2026 — Evaluation: NERDEARLA-LIVE-ACCESS

Repo: https://github.com/angeladrianpagnini-star/NERDEARLA-LIVE-ACCESS (17 commits). Read in full, not run. Vercel home page returned 200; POST with no body to `/api/translate-token` returned 200. Gemini config fields checked against `@google/genai@2.24.0` types: all exist.

## 1. Gate check
| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Live audio | ✅ mic only | `live-translation-session.ts:274-287`; no file/URL/tab input; no test audio |
| 2 | Original transcript | ✅ | `inputAudioTranscription` :192, :224-234; UI `page.tsx:2125-2129` |
| 3 | EN→ES translation | ✅ | `gemini-3.5-live-translate-preview` (`translate-token/route.ts:112-113`), :198-204, :236-246 |
| 4 | Subtitles shown | ✅ | operator page only (`page.tsx:2143-2169`) |
| 5 | ≥2 sessions + scaling README | ⚠️ weak pass | `page.tsx:841-846`; both stages use the same default mic (no deviceId); README :250-263 generic |

## 2. Overview
Client-side Next.js 16 SPA with three modes: Conference (EN↔ES), Bilingual Conversation, Concurrency Demo (Stage A/B hard-coded). One route mints ephemeral tokens; the browser talks to Gemini Live directly. `/api/token` is never called (dead code). MIT. EN/ES only, direction chosen by the operator. Demo video not found (Devpost needs a human check). Live deploy: https://nerdearla-live-access.vercel.app

## 3. Scores
| Criterion | Score | Closest ref | Reason |
|---|---|---|---|
| Calidad | 3 | Josefina/NerdLingo (=) | Gemini baseline; glossary doesn't reach model |
| Latencia | 3 | NerdLingo/Josefina (=) | ~100 ms chunks, progressive text; not measured |
| Escalabilidad | 2 | NerdLingo (−) | 2 hard-coded stages, same mic; no audience view |
| Despliegue | 2 | NerdLingo/Josefina (−) | No auth, public token endpoint, no reconnect |
| Innovación | 2.75 | Josefina (+)/NerdLingo (−) | Conversation mode + TXT/SRT/VTT export |
| **Total** | **12.75/25** | | **Promedio 2.55** |

## 4. Key evidence
- Glossary: `technical-glossary.ts:6-53`, 6 fixed terms, regex after the model (`page.tsx:237,245,371,404,642,675`). Quick fix.
- Capture: echoCancellation/noiseSuppression/autoGainControl all true (`live-translation-session.ts:280-285`). Quick fix.
- Resampling: linear interpolation (`pcm-processor.js:22-51`); ~100 ms chunks (:25). Final flush with 4 s wait (`live-translation-session.ts:442-469`).
- Hard-coded stages: `page.tsx:41, 168-186, 188-202, 841-853, 855-882, 1128-1146, 2126`.
- No auth; token endpoint public (`route.ts:48-160`); no liveConnectConstraints (`route.ts:123-127`). Quick fix.
- No reconnect: `live-translation-session.ts:249-266`. Architectural/medium.
- Export wired (`page.tsx:1863-1935`, :1484, :1830; `session-export.ts:325-356`); one cue per segment (`session-export.ts:101-147`).
- Monitor minimal (`page.tsx:2050-2140`). No Docker/health check; state in browser memory.

## 5. Checklist
Live subtitles ✅ · Original+ES ✅ · ES→EN ✅ · 5–10 sessions ⚠️ · OSI license ✅ · Deploy docs ⚠️ · Audience view ❌ · Gemini ✅ · Gemma/local ❌ · OBS/vMix ❌ · More languages ❌ · Glossary ❌ · Export ⚠️ · Monitor ⚠️ · Test audio ❌

## 6. Open questions
Demo video on Devpost; real latency measurement; UI state after a Gemini drop (unconfirmed, not scored); whether "two laptops" counts as multi-session.

## 7. Improvements
Audience relay + QR (1–2 days); auth + constrained tokens (hours); reconnect/rotation (~1 day); runtime stages + device selector (0.5–1 day); real glossary + per-sentence cues (0.5 day).

## Time window
First e802df3 2026-09-24 13:00:00 GMT-3; last f836fb8 20:25:48 GMT-3 (README only). None outside the window; author = committer on all commits. Repo created 16:00:50Z, not a fork. No significant red flags.

## 8. Spreadsheet row
3 | 3 | 2 | 2 | 2.75 | 12.75 | 2.55 | - La traducción usa Gemini Live Translate en un solo paso, con transcripción original y traducción en vivo EN↔ES
- El audio se envía en bloques de ~100 ms y el texto aparece a medida que llega, aunque no se midió la latencia
- Las dos sesiones simultáneas están fijas en el código (Stage A/B) y toman el mismo micrófono; no hay vista para el público
- No hay autenticación: el endpoint que genera tokens de Gemini es público, y no hay reconexión si se cae la conexión
- El glosario es una lista fija de reemplazos que no llega al modelo
- Suma un modo de conversación bilingüe por turnos y exportación TXT/SRT/VTT

## 9. Feedback summaries (Spanish)
See the full report in the conversation (per-criterion paragraphs).
