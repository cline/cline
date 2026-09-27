# Subtitula — Nerdearla Vibeathon 2026 evaluation (backup)

Repo: https://github.com/flordelcastillo/subtitula (evaluated by reading code; not run)

## Gate: PASS (all 5)
1. Audio: mic / file / HLS / RTMP / SRT / YouTube (subtitula/audio.py:52-68), browser mic or file via /enviar (web/enviar.html); samples/ + config/sessions.yaml
2. Transcription: Live API input_audio_transcription (live.py:93-99, 196-198)
3. EN->ES: TranslationConfig(target_language_code) (live.py:102)
4. Display: viewer, overlay, pantalla, terminal
5. Multi-session: worker per room (hub.py:249-255); README "Escala"

## Scores
| Cal | Lat | Esc | Desp | Innov | Total | Prom |
|---|---|---|---|---|---|---|
| 3.5 | 3.5 | 3.5 | 4 | 4.75 | 19.25 | 3.85 |

- Calidad 3.5 (= Glosa/aura): glossary -> custom_vocabulary (live.py:93-96) + alias post-fix on all tracks (glossary.py, live.py:255); no talk context in Live engine.
- Latencia 3.5 (= Glosa): word-by-word partials, 100 ms PCM; measured ~0.34 s p50 pause-to-last-word (not end to end); lag watchdog (live.py:460-497).
- Escalabilidad 3.5: rooms from YAML, remote workers auto-register (hub.py:72-77), unknown IDs 404; cost per room x active language (on-demand, silence pause); single in-memory hub; browser audio/listen need co-located worker.
- Despliegue 4 (Glosa -): Live reconnect + session resumption + GoAway + context compression; Docker/Compose (token required there); /admin panel, /metrics, real-timestamp SRT/VTT; auth fails open without SUBTITULA_TOKEN (hub.py:135-137, 529); /admin,/api/status unauthenticated; token in WS URL; no HTTPS files.
- Innovacion 4.75 (Glosa +): QR, "Que me perdi?", agenda automation, AI-suggested glossary, listen to spoken interpretation on phone, on-demand langs, OBS overlay + live.txt, local engine.

## Time window
First commit edc5c89 2026-09-24 13:36:37 -03 (author=committer); last 5555346 2026-09-25 11:31:52 -03. None outside window. Repo created 2026-09-24T16:36:38Z, not a fork. Flag: large first commit (38 files, 3021 lines) 36 min after start; Claude Code co-authored.

## Demo video
https://youtu.be/59H_dzXcG7s exists (oEmbed); length unverified (README claims 2 min).

## Top improvements
1. Require token always; protect /admin,/api/status,/metrics; token out of URL (~2h)
2. Shared state hub (Redis) for multiple hubs/remote browser ingest (2-3 days)
3. Caddy/HTTPS + healthchecks; degraded state when Live session down (~3h)
4. End-to-end latency measurement (~4h)
5. Talk context into Live session; runtime room creation (0.5-1 day)
