# QA 04 — The provider and model you picked stay picked

You are hunting a specific, previously-seen bug class: the selected provider silently reverts. The user picks a
provider and model, something happens — a reload, a restart, a mode switch, reopening a task — and the next request
goes somewhere else. Nothing errors, because the fallback provider is perfectly valid. The user only notices via
the bill or the output quality.

Because the failure is silent, **checking the dropdown is not a test**. There are three places the answer lives and
they can disagree:

1. what the settings UI displays,
2. what is on disk, and
3. where the next request actually goes.

Every scenario below is only a pass when all three agree. Scenario after scenario, the third one is the one that
catches it.

Owning code:

- `apps/vscode/src/shared/storage/state-keys.ts` — `planModeApiProvider` / `actModeApiProvider`, defaulting to
  `DEFAULT_API_PROVIDER` (currently `openrouter`)
- `apps/vscode/src/shared/storage/provider-keys.ts` — per-provider model id keys such as `planModeOpenRouterModelId`
- `sdk/packages/core/src/services/storage/provider-settings-manager.ts` — `providers.json` and `lastUsedProvider`
- `apps/vscode/src/core/controller/models/providerSwitchNormalization.ts` — snaps the model id on provider switch
- `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx` — state hydration into the webview

Two independent stores mean two chances to drift. A large part of this prompt is checking that
`globalState.json`'s `planModeApiProvider` / `actModeApiProvider` and `providers.json`'s `lastUsedProvider` never
disagree.

## Setup

```bash
export QA=/tmp/cline-qa/persistence
rm -rf "$QA" && mkdir -p "$QA/data/settings" "$QA/workspace"
printf 'export const name = "john"\n' > "$QA/workspace/qa.txt"

cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs

# Wire observer: whichever provider a request lands on, you will see it here.
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s fault-proxy -- \
  node /workspace/.agents/test-prompts/provider-qa/fixtures/fault-proxy.mjs

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-persist -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --disable-workspace-trust --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

The state-inspection command you will run constantly:

```bash
echo "--- providers.json ---";  cat "$QA/data/settings/providers.json"
echo "--- globalState ---";     python3 -c "import json;s=json.load(open('$QA/data/globalState.json'));print({k:v for k,v in s.items() if 'ApiProvider' in k or 'ModelId' in k or k=='mode'})"
```

## The verification every scenario ends with

Do not skip this. After the reload/restart/switch, send `Reply with exactly PONG.` and confirm the request landed
on the provider you expect. If you configured OpenAI Compatible against the fault proxy, `tail -1
/tmp/fault-proxy.jsonl` proves it directly. For real providers, use a model id that only that provider serves, so a
fallback would visibly fail or answer as a different model.

## Scenarios

**1. Reload the window.** Configure a non-default provider and a non-default model. Run `Developer: Reload Window`
from the command palette. Reopen Cline. Check all three sources.

**2. Full restart.** Close VS Code entirely, relaunch with the same `CLINE_DATA_DIR`. Check all three.

**3. Configure, then reload before sending anything.** A selection that was never used is the most likely to be
treated as uncommitted. Configure, immediately reload, then send the first message.

**4. Reload mid-task.** Start a task, let it stream, reload while it is in flight. Reopen the task and continue it.
The continuation must use the same provider — a task resuming on a different provider is a severe variant of this
bug.

**5. Reopen a task from history.** Open a previous task from the history view. Check whether the provider follows
the task or the current global selection, and confirm whichever it is, it is consistent between the header and the
actual request.

**6. Plan/Act with separate models.** Enable *Use different models for Plan and Act modes*, set two different
providers, reload. Each mode must still have its own. Then toggle between Plan and Act several times and reload
again — mode toggling is a write path, and a bad write here is what collapses both modes onto one provider.

**7. Plan/Act toggle off.** With separate models enabled and configured, turn the checkbox off, then reload. The
resulting single configuration should be predictable and documented, not whichever mode happened to write last.

**8. Two windows.** Open a second VS Code window on the same `CLINE_DATA_DIR`. Change the provider in window A.
Check window B: it should either pick up the change or clearly not, but it must never end up with the UI showing
one provider and disk holding another. Then reload B and confirm it converges.

**9. Custom / free-text model ids.** Select OpenAI Compatible and type a model id that exists in no catalog
(`fault/ok`, or something invented). Reload. The custom id must come back verbatim. A catalog default appearing in
its place points at `providerSwitchNormalization`.

**10. Provider with no credential.** Select a provider and pick a model but never enter a key. Reload. The
selection should persist with a prompt for the key — not silently revert to a provider that does have a key, which
would be the exact silent-reset symptom.

**11. Corrupt one store.** Delete `providers.json` but leave `globalState.json`, then relaunch; then the reverse.
In both directions the extension should recover to something coherent and say what happened.

**12. Settings written outside the UI.** Edit `providers.json` while VS Code is running, then reload the window.
Confirm the UI reflects the file rather than re-writing it from stale in-memory state.

## What a failure looks like

- The dropdown reads `anthropic` (or `openrouter`, the default) after a reload when you selected something else.
- The dropdown is right but `providers.json` or `globalState.json` disagrees — the UI is lying and the next request
  will go to the wrong place.
- The provider persists but the model reverts to the provider's default.
- Plan and act collapse onto a single provider.
- A custom model id is replaced by a catalog entry.
- Any case where the request lands somewhere other than what the header claims.

## Artifacts

- One video: configure a distinctive provider and model, reload the window, and send a message that visibly lands
  on the same provider. This is the headline artifact for this prompt.
- One video of the plan/act separate-models scenario surviving a restart.
- Screenshots of the settings UI beside the on-disk state for any mismatch you find.

## Report

A table of the twelve scenarios with the three-way result for each (UI / disk / wire). For any mismatch, give the
exact sequence, both files' contents before and after, and which of the two stores you believe is wrong.
