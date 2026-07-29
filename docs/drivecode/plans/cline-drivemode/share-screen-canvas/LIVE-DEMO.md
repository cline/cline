# Share-screen Spotlight live demo

This runbook launches a no-credential simulated-live Drivemode share-screen demo that mounts the canonical `Spotlight.tsx`.

## Prereqs

- Repo root is `/workspace`.
- Bun is available in `PATH` (`export PATH="$HOME/.bun/bin:$PATH"` if needed).
- SDK build is current.

## Command

Run this from repo root:

```bash
bun run --cwd apps/cline-hub dev
```

The process prints live URLs. Use the printed dashboard URL and open:

```text
/drive?demoShareScreen=1
```

Example shape only:

```text
http://127.0.0.1:<printed-port>/drive?demoShareScreen=1
```

Do not hardcode a port. Use whatever URL the server prints.

## What you should see

- Spotlight mounted from `apps/cline-hub/src/webview/src/drive/Spotlight.tsx`
- Scripted work cards on the Spotlight surface:
  - `edit`
  - `command`
  - `test`
  - `plan`
- A narration line that updates per scripted beat
- A human-takes-Spotlight structured pin beat
- Play/pause and beat controls for the simulated-live loop

## Verification checklist

1. Open the route above.
2. Confirm the beat counter advances while loop playback is on.
3. Confirm `edit`, `command`, and `test` cards appear.
4. Confirm narration text changes as beats advance.
5. Confirm the human spotlight beat shows a structured pin and dims agent cards.

## Captured screenshots

- `docs/drivecode/assets/share-screen-spotlight-demo-beat-1.png`
- `docs/drivecode/assets/share-screen-spotlight-demo-beat-3.png`
- `docs/drivecode/assets/share-screen-spotlight-demo-human-pin.png`
