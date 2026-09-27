# Vibeathon 2026 evaluation: JudithGrau/vibeathon-transcriptor-streaming

Commit evaluated: c1edb43 (only commit; author 2026-09-25 01:38 GMT-3, committer 02:07 GMT-3; repo created 01:40, pushed 02:07; not a fork). Inside the window; single 300-line commit hides history.

Gate: borderline pass (req. 5: two hard-coded stages, README scaling explanation is one line, README.md:8).
Setup blocker: config.js imported (speaker.html:43, index.html:41) but gitignored with no template; README.md:20 contradicts it.

| Calidad | Latencia | Escalabilidad | Despliegue | Innovacion | Total | Promedio |
|---|---|---|---|---|---|---|
| 2.5 | 2.5 | 2.75 | 2.0 | 2.0 | 11.75 | 2.35 |

Key evidence: Web Speech en-US, interimResults=false (speaker.html:64-67); per-phrase Gemini generateContent, no context (117-156); errors published as subtitles (143,151); possible reordering (69-85); Gemini key in client/URL (51,122); innerHTML XSS (index.html:70-73); listener leak on stage switch (index.html:49,59); no auth/deploy files/monitor/export/OBS/glossary.
Demo video: not found (Devpost blocked; verify manually).
