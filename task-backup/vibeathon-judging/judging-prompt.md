You are judging a submission to the Nerdearla Vibeathon 2026. Real prizes depend on this,
so be thorough, fair and evidence-based.

Clone the repository into a temporary folder (outside any existing project) and evaluate
it by reading the code. Don't trust the README alone; check every claim against the
source and cite file paths and line numbers. Don't run it unless asked (it probably needs
API keys). If you can't verify something, such as accuracy or latency, say so and note
where the claim comes from.

## Repository
The repository to evaluate is: [INSERT REPO URL HERE]
Devpost / demo link (if known): [OPTIONAL]
Judge's hands-on notes (if any): [OPTIONAL — these override README claims]

## Minimum requirements (gate)
To be scored at all, the submission must:
1. Receive live audio from at least one source (microphone, audio file, or stream).
2. Generate real-time transcription in the original language (Spanish or English).
3. Generate real-time translation from English to Spanish.
4. Display subtitles somewhere (web, overlay, terminal, anything).
5. Process at least two simultaneous sessions and explain in the README how to scale.

This is a pass/fail gate, not a score floor. If any requirement fails, say which and why
and stop before scoring. If it passes, score each criterion against the full brief.

## The brief (what was asked)
Required:
1. Live audio → real-time subtitles: original-language transcript plus Spanish
   (ideally Spanish → English too).
2. Run several sessions at once (5, 10 or more stages in parallel).
3. An OSI-approved license and clear docs so any conference can deploy it.
4. An audience view where each person picks the session AND the language.

Recommended: Gemini audio capabilities, or Gemma for fully local.
Optional: OBS/vMix integration; more languages (e.g. Portuguese); a glossary of
technical terms and proper names; transcript export (SRT/VTT/text); a monitoring panel.

## Sponsor / recommended stack
Using Gemini (or any sponsored/recommended technology) is the expected baseline and does
not count toward Innovación. Score only what was built beyond it.

## Demo submission
Note the demo video's length against the 2-minute cap, or that no link was found (check
Devpost first). Report separately from the software scores; don't dock points for it.

## Hackathon time window
- First commit: after 24-09-2026 12:00 GMT-3 (2026-09-24T15:00:00Z)
- Last commit: before 25-09-2026 15:00 GMT-3 (2026-09-25T18:00:00Z)

    git log --all --reverse --format='%H | author %aI | committer %cI | %an | %s' | head -5
    git log --all --format='%H | author %aI | committer %cI | %an | %s' | head -5
    git log --all --until='2026-09-24T12:00:00-03:00' --format='%H %cI %s'
    git log --all --since='2026-09-25T15:00:00-03:00' --format='%H %cI %s'
    gh api repos/OWNER/REPO --jq '{created_at, pushed_at, fork, parent: .parent.full_name}'
    gh api repos/OWNER/REPO/events --paginate --jq '.[] | select(.type=="PushEvent") | .created_at'

Compare author and committer dates. Flag: repo created/pushed outside the window, a fork
of earlier work, a huge first commit, disagreeing dates, a single squashed commit.
Eligibility is for the organizers: report it, don't change scores, don't disqualify.
Distinguish late docs-only commits from late code.

## Investigate these specifically
- Audio input: device only, or stream URL/YouTube/RTMP/HLS/tab audio/file? Script-fed? Test audio included? Capture constraints (echoCancellation, noiseSuppression, autoGainControl, sampleRate) appropriate for a mixer feed? Resampling and chunking?
- AI pipeline: models/SDKs; one-step vs transcribe-then-translate; streaming vs chunked (seams); glossary/context reaching the model; local mode and what runs in it.
- Languages: supported end to end; operator vs per-viewer choice; cheap workarounds are not architectural limits.
- Latency: measured figures (what exactly), chunk sizes, partial captions, backlog handling.
- Stages: hard-coded/config/runtime; count hard-coded IDs; unknown IDs fail cleanly?
- Scaling: cost per stage/viewer/language; in-memory vs shared state; multiple servers/workers; update fan-out.
- Connecting: QR, share link, join code, chooser; backend URL fixed at build time?
- Security: console vs audience separation; auth on every ingest path and admin/monitor/transcript endpoint; fails open when unset?; committed default keys?; tokens in URLs?; root landing page.
- Operations: deploy files, health checks, restart state, monitoring, exports (real SRT/VTT timestamps?), AI/operator disconnect handling, session rotation/resumption, audience sees outage?
- OBS/overlay: integration, readability, URL options, shows translation?
- Docs/license: OSI license, setup, env vars, runbook, platform coverage.

## Verification rules
- Never call model names/API fields fake from memory; check SDK types or docs, else say "unverified". (gemini-3.5-live-translate-preview works in practice.)
- Trace every feature to where it is used: "implemented", "declared but unused", or "not found after searching for X".
- Count features only if wired end to end; don't reuse README marketing language.
- A glossary counts only if user-supplied terms reach the model or a post-processing step.
- For local/offline claims, state what transcribes and translates and any remaining third-party calls.
- Don't report unconfirmed bugs.

## Scoring (1-5, half or quarter points)
Calidad, Latencia, Escalabilidad, Despliegue y operacion, Innovacion.
Scale: 1 missing/broken; 2 major gaps; 3 basic; 4 solid; 5 excellent/beyond the brief.
Score what exists today. Label weaknesses quick fix vs architectural. Count each feature under ONE criterion. Value over quantity.

## Rules the judge applied
- Calidad: Gemini entries ~3; +0.5 glossary/context reaching the model or quality shown on technical content; -0.5 large-chunk seams or visible cuts; 4+ only if shown clearly better on real audio.
- Latencia: streaming with partials 3-3.5; big chunks/pause-waiting/slow translation 2.5; >=5 s windows 2; extreme waits 1.5. Measured beats unmeasured.
- Escalabilidad: hard-coded stages 2.5-3; config/runtime rooms, cost per stage 3.5; persisted runtime rooms + many-room evidence 3.75; shared state across servers + stress test 4. Cost per viewer or single client = major penalty.
- Despliegue: neither auth nor reconnect 2.5; one of them 3; both 3.5; + full admin panel 4; + session rotation/resumption, HTTPS, auth that doesn't fail open, alerts 4.5.
- Innovacion: no extras 2; one or two optionals 3; several useful extras 3.5-4; event-changing extras verified end to end (agenda automation, que me perdi, ask-the-talk, translated audio, clips/summaries) 4.5. Gemini is baseline.
- Keep room at the top: score clearly better submissions above the references.

## Reference evaluations (judge's final scores)
| Project | Cal | Lat | Esc | Desp | Innov | Total |
|---|---|---|---|---|---|---|
| OpenCaptions | 3.5 | 3.5 | 3.75 | 4.5 | 4.5 | 19.75 |
| Glosa | 3.5 | 3.5 | 3.5 | 4.5 | 4.5 | 19.5 |
| Subdearla | 3.5 | 3.5 | 3.5 | 4 | 4.5 | 19 |
| VozViva | 3.5 | 3.5 | 3.75 | 3.75 | 4.5 | 19 |
| EveryoneMakesSubs | 3.5 | 3.5 | 3.5 | 4.25 | 4 | 18.75 |
| Piluso | 3.5 | 3.5 | 3.5 | 4 | 3.5 | 18 |
| aura | 3.5 | 3.5 | 3.5 | 3.5 | 3.5 | 17.5 |
| Live Subs | 3 | 3.5 | 3.5 | 2.5 | 3 | 15.5 |
| Conffy | 3 | 1.5 | 4 | 3 | 3.5 | 15 |
| NerdLingo | 3 | 3 | 2.5 | 2.5 | 3.5 | 14.5 |
| nerdearla-live-transcribe | 2.5 | 2 | 3 | 3 | 3 | 13.5 |
| NerdSubs | 2.5 | 2 | 2 | 2 | 3 | 11.5 |
(Reasons per project: see standings.md and the chat history.)
For each criterion, state the closest reference and why the score is above, equal or below.

## Output format
1. Time window  2. Gate check  3. Overview  4. Score table with closest reference  5. Per-criterion evidence (file:line)  6. Brief checklist  7. Open questions  8. Top improvements  9. Spreadsheet row (Calidad | Latencia | Escalabilidad | Despliegue y operacion | Innovacion | Total | Promedio | Notas, 4-6 Spanish bullets)  10. Spanish summary per criterion.
