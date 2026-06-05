---
name: maestro-debug-extension-issue
description: End-to-end workflow for reproducing, fixing, and validating a Cline VS Code / JetBrains extension bug inside a Maestro container using the debug harness, driving a real extension build over CDP with local LM Studio inference. Use when asked to find and fix an extension issue with maestro, reproduce an extension bug in a container, or run the maestro + debug-harness demo. Covers maestro setup, the Docker image, running maestro-daemon/maestro-ui, picking a Linear issue, the connect-mode debugger, reproduce-before-fixing discipline, validation by rebuilding, eternal-now comments, PRs, Linear updates, and responding to Greptile review.
---

# Debug an Extension Issue with Maestro + the Debug Harness

This skill drives a real Cline extension build running inside a Maestro Docker
container, reproduces a bug interactively, fixes it, and validates the fix by
rebuilding and re-running — never by guessing from code alone.

The golden rule, stated up front because it is the easiest to skip:
**Reproduce the issue in maestro + the debug harness before proposing a cause.**
Static code reading produces plausible-but-wrong hypotheses. Once you have a
live repro you may use the debugger and `eval` to explore behavior — but the
repro comes first.

## 0. Prerequisites

You need, on the host:

- **maestro** — clone and build from `https://github.com/dominiccooney/maestro.git`.
  It provides `maestro-daemon` (REST API that manages containers/sessions) and
  `maestro-ui` (live view of the container desktop).
- **Docker**, running.
- **A Docker image that can run VS Code and JetBrains** (see step 2).
- **LM Studio** on the host for inference (see step 5).
- **`gh` CLI**, authenticated, for PRs.

## 1. Get and build maestro

```bash
git clone https://github.com/dominiccooney/maestro.git
cd maestro
cargo build   # builds maestro-daemon and maestro-ui
```

## 2. Build the container image (VS Code + JetBrains)

Maestro ships a container build for a Linux desktop (Xvfb) with VS Code (and
JetBrains IDEs) installed. Build it before starting the daemon:

```bash
cd maestro
./build-container.sh        # produces e.g. maestro:arm64-base / maestro:arm64-full
docker images | grep maestro   # confirm the image exists
```

Pick the tag that matches your architecture (`arm64-*` on Apple Silicon). The
`-full` image is larger but bundles more IDE tooling; `-base` is enough for the
VS Code flow.

> The image provides VS Code at `/usr/share/code/code`. Crucially, **VS Code's
> bundled Electron is the only Node runtime you need in the container** — do not
> assume `node`/`npm`/`tsx` are installed there.

## 3. Run maestro-daemon and maestro-ui

**Detect whether the daemon is already running** before starting another:

```bash
curl -s -m 2 localhost:8765/sessions >/dev/null && echo "daemon UP" || echo "daemon DOWN"
```

If it is DOWN, give the user the exact command and offer to run it in the
background. Mount the worktree under repair at `/workspace/cline`:

```bash
# Run from the maestro checkout. Replace the mount path with the worktree to fix.
cargo run --bin maestro-daemon -- \
  --image maestro:arm64-full \
  --mount /ABSOLUTE/PATH/TO/cline-worktree:/workspace/cline
```

To run it in the background (so the session survives this turn):

```bash
nohup cargo run --bin maestro-daemon -- --image maestro:arm64-full \
  --mount /ABSOLUTE/PATH/TO/cline-worktree:/workspace/cline \
  > /tmp/maestro-daemon.log 2>&1 &
```

Advise the user to launch **maestro-ui** in its own terminal so they (and a
colleague) can watch and take over the container desktop live:

```bash
cd maestro && cargo run --bin maestro-ui
```

Then create/attach a session via the maestro tools (`maestro_list_sessions`,
`maestro_create_session`). Prefer attaching to the already-mounted container so
`/workspace/cline` exists. Confirm the mount from inside:

```jsonc
maestro_exec { "session_id": "<id>", "cmd": "ls /workspace/cline/apps/vscode/package.json" }
```

> The worktree is a git *worktree*, so `.git` points outside the mount and git
> commands fail in the container. That is fine — you build and run, you don't
> need git in the container.

## 4. Pick a Linear issue to fix

Use the Linear tools to find an extension (VS Code or JetBrains) bug. Filter
for something you can actually reproduce on Linux in a container:

- **Avoid Windows-specific issues** (titles/bodies marked "[Windows Specific]",
  or that depend on Windows filesystem/path/timing behavior). You are on macOS
  driving a Linux container, so you cannot faithfully reproduce them.
- **Avoid issues already In Progress, In Review, Done, or otherwise claimed** —
  pick from Triage / Backlog / Todo so you are not duplicating work.
- **Prefer deterministic, self-contained logic/UI/state bugs** over ones that
  need a specific paid provider, live network conditions, or external accounts.

When you settle on one, read its full description (`get_issue`) and confirm the
relevant code path exists in the mounted worktree before committing to it.

## 5. Forward LM Studio inference into the container

Run inference locally with **LM Studio** on the host, model **`google/gemma-4-e4b`**,
and point the in-container extension at it as an OpenAI-compatible provider.

- Load `google/gemma-4-e4b` in LM Studio and start its server (default
  `http://localhost:1234`). **Remind the user to raise the model's context
  length to the maximum** in LM Studio — Cline's system prompt is large (~16k
  tokens) and the default context (e.g. 4096) causes `n_keep >= n_ctx` errors.
  Use the plain `google/gemma-4-e4b` model id.
- The container reaches the host at **`host.docker.internal`**. Verify:

  ```jsonc
  maestro_exec { "session_id": "<id>",
    "cmd": "curl -s -m3 http://host.docker.internal:1234/v1/models | head -c 200" }
  ```

- In the extension's onboarding/settings, choose **OpenAI Compatible** with:
  - Base URL: `http://host.docker.internal:1234/v1`
  - API Key: any non-empty string (LM Studio ignores it)
  - Model ID: `google/gemma-4-e4b`

> Set the model in the **UI** (or confirm it in the running provider config).
> Editing the persisted `providers.json` by hand may not take effect for the
> active provider, and a stale 4096-context entry will keep erroring.

## 6. Launch VS Code and connect the debugger (connect mode)

Do **not** try to run the harness (`npx tsx server.ts`) inside the container —
the base image has no Node/`tsx`. Use **connect mode**: build on the host, run
VS Code in the container, attach the debugger over CDP.

1. **Build the extension on the host** into the bind mount (the host has the
   toolchain). The webview is built separately and is required for the sidebar
   to render — if the Cline panel is blank, the webview build is missing:

   ```bash
   cd apps/vscode && IS_DEV=true node esbuild.mjs          # builds dist/extension.js
   cd apps/vscode/webview-ui && npm install && npm run build   # builds webview-ui/build
   ```

2. **Launch VS Code in the container** with the extension-host inspector on a
   **bare** port and the extension development path:

   ```jsonc
   maestro_exec {
     "session_id": "<id>", "gui": true, "background": true,
     "cmd": "/usr/share/code/code --no-sandbox --disable-gpu /workspace/cline \
             --inspect-extensions=9229 \
             --extensionDevelopmentPath=/workspace/cline/apps/vscode \
             --disable-workspace-trust --skip-welcome --skip-release-notes \
             --user-data-dir /home/maestro/.vscode-dbg"
   }
   ```

3. **Open the Cline sidebar** (click its activity-bar icon via `maestro_click`)
   so the extension activates and its scripts load.

4. **Attach the debugger** from the harness connect mode, pointing at the
   inspector and the debuggee's dist path.

### Electron / inspector gotchas (each of these costs real time)

- **`--inspect-extensions` takes a BARE port** (`9229`). The `host:port` form
  (`0.0.0.0:9229`) is silently ignored and no inspector listener opens.
- **The ext-host inspector binds `127.0.0.1` only.** A Docker `-p` host map
  cannot reach a loopback listener. Reach it from *inside* the container
  (`maestro_exec curl 127.0.0.1:9229/json`, same network namespace) or bind it
  to a port the daemon already publishes (the bridge range, typically
  `9001–9016`).
- **The extension host runs on VS Code's bundled Electron** — that is your Node
  runtime in the container; nothing to install.
- **Scripts only appear after the extension activates.** Open the sidebar
  first; don't pass `--disable-extensions`.
- **Use the debuggee's load path** (`/workspace/cline/apps/vscode/dist/extension.js`)
  for source breakpoints, not the host path.
- A reload (`Developer: Reload Window`) restarts the ext host and re-opens the
  inspector — re-attach after reloading.

## 7. Reproduce first — don't guess

Before writing any fix, reproduce the issue in the running extension:

- Drive the real UI (`maestro_click` / `maestro_type` / `maestro_screenshot`)
  and/or set a breakpoint and `eval` in the ext host to **observe** the bad
  behavior firsthand.
- A clean way to make a bug reproducible without external services is to set up
  a tiny local fixture (e.g. a stub MCP server, a scratch skill/rule file) that
  triggers the exact code path.
- Confirm the symptom matches the Linear report. If you *cannot* reproduce it on
  Linux, say so and reconsider the issue (it may be Windows-specific or
  environment-dependent) rather than inventing a cause.

Only after you have a live repro should you use the debugger/`eval` to explore
*why* it happens. Exploration is great; speculation dressed up as a root cause
is not.

> If the issue turns out to be already fixed on the branch, that is a valid
> outcome: demonstrate it's fixed (the reproduction attempt shows correct
> behavior) and note it on the Linear issue.

## 8. Fix, then verify by re-running the extension

1. Make the change in the host worktree source.
2. **Rebuild** the affected build output (`node esbuild.mjs`, and the webview if
   you touched it) and **reload** the VS Code window.
3. **Re-run the same reproduction** in the live extension and confirm the bad
   behavior is gone. A fix is not "validated" by unit tests alone — re-exercise
   it in maestro + the debug harness, the same way you reproduced it.

## 9. Review your change for the "eternal now"

Read your own diff as a future maintainer would, with none of today's context:

- **Comments describe the code as it is**, and the durable reason it exists.
  Do **not** reference this task, a debugging session, a Linear ticket as a
  story, "what we proved", or old/removed code the reader can't see. A bare
  issue id as a pointer (e.g. `(ENG-1234)`) is fine; a narrative is not.
- **Anticipate reviewer concerns**: brevity, simplicity, correctness,
  reliability, performance. Prefer the smallest change that fixes the root
  cause; reuse existing helpers/APIs rather than duplicating logic; handle the
  fail-open / edge cases (e.g. malformed input) so the fix can't corrupt state.
- **Run the relevant tests** (`tsc --noEmit`, the package's unit suite). Add
  tests that would have caught the bug; make tests assert their own
  preconditions so they can't rot into false positives.
- If you made **significant changes** after the first validation, rebuild and
  re-verify the fix in maestro/the debug harness again — don't assume.

## 10. PR, claim the issue, update Linear

- Create a focused branch off the target base (e.g.
  `origin/dpc/sdk-migration-simpler-login`) containing only the fix commit(s),
  push it, and **open a PR** (`gh pr create --base <base>`). Keep unrelated
  changes (lockfiles, harness/demo tooling) out of the fix PR.
- **Claim the Linear issue** (assign yourself) and **mark it In Progress**.
- **Comment on the issue** with the approach and a link to the PR.

## 11. Address Greptile review until satisfied

Greptile reviews the PR automatically. For each round:

- Read its feedback (`gh pr view <n> --json comments,reviews`).
- Evaluate each point on its merits — accept real bugs/edge cases (e.g.
  unhandled malformed input), or push back politely with reasoning if a
  suggestion is wrong.
- Apply fixes as additional commits, **re-run tests**, push, and **reply on the
  PR** explaining what changed.
- Repeat until Greptile is satisfied (no outstanding actionable comments).

## Quick checklist

- [ ] maestro built; container image built (VS Code/JetBrains)
- [ ] maestro-daemon running (detected or started, worktree mounted); maestro-ui advised
- [ ] Linear issue picked: extension bug, not Windows-specific, not already In Progress+
- [ ] LM Studio serving `google/gemma-4-e4b` at max context; forwarded via `host.docker.internal`
- [ ] Extension + webview built on host; VS Code launched in container with bare `--inspect-extensions`; debugger attached
- [ ] **Issue reproduced live** before any fix
- [ ] Fix made; rebuilt; **re-verified live** that the symptom is gone
- [ ] Diff reviewed for eternal-now comments; tests added/updated and passing
- [ ] PR opened; Linear issue claimed, In Progress, commented with PR link
- [ ] Greptile feedback addressed until satisfied
