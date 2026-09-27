# Nerdearla Vibeathon 2026 - Evaluation: Cotorra (SantiagoOroz/cotorra)

Read-only source review (clone /tmp/cotorra-eval, not executed).

## Gate: PASS (all 5)
- Audio via ffmpeg: file/HLS/RTMP/SRT/YouTube/mic - src/cotorra/audio/source.py:76-119 (bundled sample is noise, not speech)
- One Gemini call per utterance -> transcript + translations - engines/gemini.py:55-60,153-176,219-262; partials every 1.8 s - audio/segmenter.py:159-173
- /viewer, /overlay, stage screen; 2 sessions in cotorra.yaml:26-40; scaling in README.md:205-236

## Scores: Cal 3.5 | Lat 3 | Esc 3.5 | Desp 4 | Innov 4 | Total 18 | Prom 3.6
- Cal: per-session glossary reaches prompt (glossary.py:33-46, worker.py:144,246, gemini.py:163-166) + prior-caption context; no overlap on forced 7 s cuts
- Lat: partials; README p50 2581 ms is model-only (worker.py:276); segments up to 7 s; no Live API streaming
- Esc: YAML/runtime sessions (gateway.py:229), cost per stage; Redis multi-replica broken as shipped (Dockerfile:20 no redis extra, fixed port docker-compose.yml:23, in-memory registry supervisor.py:172)
- Desp: Docker+healthcheck, Cloud Run script, CI smoke test, auto-restart, watchdog, /ops, /metrics, real-timestamp SRT/VTT; ADMIN_TOKEN fail-open (config.py:48, gateway.py:99-101); committed default WORKER_TOKEN cotorra-dev (config.py:49) allows caption injection; tokens in URLs
- Innov: OBS overlay with translation, stage screen + QR, offline Whisper+Gemma, live cost, crash drill, subtitle CLI, bilingual mode

## Time window
All 12 commits 2026-09-25 05:33-14:52 GMT-3, none outside; repo created 08:33Z, not a fork. Red flag: first 7 commits (~13.5k lines, all code) within 2 s = bulk commit. Last commit docs-only.
Demo: https://youtu.be/xIqsBC4m3TY (duration unverified).
