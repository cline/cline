# Legenda Livre (github.com/Dtchaves/legenda-livre) - Nerdearla Vibeathon 2026 evaluation

Gate: PASS.

| Calidad | Latencia | Escalabilidad | Despliegue | Innovacion | Total | Promedio |
|---|---|---|---|---|---|---|
| 3 | 3 | 3.25 | 2.5 | 3.5 | 15.25 | 3.05 |

Evidence:
- Glossary only on fallback paths: server/gemini.js:36-51, 297-301.
- Latency metric = time since last audio chunk: server/room-runner.js:70,113,116-119.
- Full snapshot with all segments on every partial, unthrottled: server/room-store.js:36,154-160; server/index.js:169-172.
- No auth on ingest or write endpoints: server/index.js:50,71,92,103,186-207.
- No Gemini reconnect/resumption on main path: server/room-runner.js:35-40; server/gemini.js:170-179; README.md:195.
- Deploy: Dockerfile, docker-compose.yml, Cloud Run (README.md:159-174), /healthz (server/index.js:36-38).
- Export VTT/SRT/TXT, estimated timestamps: server/exporters.js; server/room-runner.js:97-99.
- OBS overlay: public/styles.css:151-158.

Time window: 14 commits, 2026-09-25 10:18-13:58 GMT-3 (inside). Repo created 10:17 GMT-3, not a fork.
Flags: large first commit d1b453a (3,760 lines, ~2,400 excluding lockfile); 0e172e2 author 18:06 vs committer 18:29 (+02:00).
Demo video: https://youtu.be/pPSVpZrRUyk (length not retrieved).
