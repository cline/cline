# NerdTalk (LautaroGarc/NerdTalk) — Nerdearla Vibeathon 2026 evaluation

Evaluated by reading code at commit ad8f18e (clone in /tmp, not run).

## Gate: FAIL (not scored)
1. Live audio: FAIL. `talkgo/lib/captions/hub.ts:252` `ingestAudio()` is never called anywhere; no getUserMedia/AudioWorklet/MediaRecorder; no ingest route (only app/api/admin/*); no test audio files.
2. Transcription: FAIL (declared but unused). Gemini Live config exists (`gemini.ts:92-100`, inputAudioTranscription, slidingWindow) but receives no audio.
3. EN->ES translation: FAIL. Not found; docs list "traducción simultánea" as out of scope (`docs/TalkGo/02-oradores/plan-sistema-de-oradores.md:112`).
4. Subtitles displayed: FAIL. `caption` events published to Redis `talk:{id}:events` (`hub.ts:170-181`) but nothing subscribes; only page is `app/page.tsx` landing; only SSE is admin stage feed (`app/api/admin/control/events/route.ts:13`).
5. Two sessions + scaling README: FAIL. README is create-next-app boilerplate; in-memory state (`hub.ts:250`).

## Other facts
- Repo also contains unrelated projects: vudip/ (psychology app, qwen3 Modelfile), kosa/resubidos (Discord bot), lateraltek/ (blank Next.js scaffold).
- No LICENSE (GitHub license: null). Demo video: not found in repo (check Devpost).

## Time window
- First commit 14354f9, 2026-05-05 07:46:16 GMT-3 (author=committer), "first commit": OUTSIDE window; adds only lateraltek/ scaffold.
- Last commit ad8f18e, 2026-09-25 10:14:07 GMT-3, "stage 0": inside window; 237 files / ~58k lines in one commit (all of talkgo, vudip, kosa).
- GitHub: created 2026-09-25T13:08:41Z, pushed 13:15:19Z, not a fork; only a CreateEvent, no PushEvents.
- Red flags: huge single commit, unrelated projects bundled, pre-window commit.

## Spreadsheet row
N/A (no pasa el gate) | N/A | N/A | N/A | N/A | N/A | N/A |
- No pasa los requisitos mínimos: no hay forma de ingresar audio (la función ingestAudio existe pero nunca se llama)
- No hay traducción inglés→español; la transcripción está pensada solo para español
- No hay vista de subtítulos para la audiencia: los eventos "caption" se publican en Redis pero ninguna página los consume
- El repositorio mezcla proyectos no relacionados (bot de Discord, prototipo de otra app, plantilla vacía de Next.js)
- Falta licencia y el README es el de la plantilla de create-next-app
- La base de gestión de eventos y oradores (Prisma, Redis, SSE) es prolija y podría ser un buen punto de partida
