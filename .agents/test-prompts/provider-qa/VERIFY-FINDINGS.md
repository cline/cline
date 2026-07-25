# Verify four reported Cline provider bugs

Four bugs were reported against Cline's provider handling. Nobody has confirmed them independently. Your job is to
reproduce each one on a clean VS Code and tell us, for each, whether it is **real**, **not real**, or
**inconclusive**.

You do not need any tooling beyond what is already on this machine: a checkout at `/workspace`, VS Code, a virtual
display on `DISPLAY=:1`, and real API keys in your environment. Do not install a test harness and do not use any
script under `.agents/test-prompts/provider-qa/fixtures/` — the point is to check these bugs the way a user would
hit them.

Be skeptical. A report that says "confirmed" without a transcript is worthless, and so is "could not reproduce"
without saying what you actually did.

## Your API keys

Real credentials are injected as environment variables. The names are inconsistent, so list what you actually have
before assuming anything:

```bash
env | cut -d= -f1 | grep -iE 'key|token' | sort
```

At the time of writing these are the useful ones. Confirm each still exists before using it.

| Provider in the Cline UI | Environment variable |
|--------------------------|----------------------|
| Anthropic | `AnthropicKEy` |
| OpenAI | `openAIKey` |
| OpenRouter | `OpenrouterAPIKey` (also `OPENROUTER_API_KEY`) |
| Cline | `clineApiKey` (also `CLINE_API_KEY`) |

Never paste a key into a file you commit, into a screenshot, or into your report. Refer to them as
`$AnthropicKEy` and so on.

Before touching the UI, check the keys are alive — a dead key will waste an hour of clicking:

```bash
cd /workspace
echo "$AnthropicKEy" | head -c 8   # just confirms it is non-empty
```

## Set up a clean VS Code

Build the extension only if `apps/vscode/dist/extension.js` is missing (the build takes a couple of minutes):

```bash
cd /workspace/apps/vscode
bun run build:webview
bun esbuild.mjs
```

Create a fresh workspace and launch:

```bash
rm -rf /tmp/v && mkdir -p /tmp/v/ws
printf 'export const name = "john"\n' > /tmp/v/ws/qa.txt

DISPLAY=:1 CLINE_DATA_DIR=/tmp/v/data \
  code --no-sandbox --disable-dev-shm-usage --disable-workspace-trust \
       --user-data-dir=/tmp/v/ud \
       --extensionDevelopmentPath=/workspace/apps/vscode \
       /tmp/v/ws
```

Three things about that command matter, and skipping them will cost you hours:

- `--disable-dev-shm-usage` — this machine gives `/dev/shm` only 64 MB. Without the flag the window dies at startup
  with *"The window terminated unexpectedly (reason: 'crashed', code: '133')"*, which looks exactly like a broken
  extension but is not.
- `--disable-workspace-trust` — otherwise VS Code opens in Restricted Mode and refuses to run terminal commands,
  which looks exactly like a broken tool.
- `--user-data-dir` — keeps this run isolated. If you launch a second VS Code with the same one, it attaches to the
  first window instead of starting a new one, and you will end up testing a window you did not configure. Keep one
  window open at a time, and check with `ps -ef | grep extensionDevelopmentPath`.

If the window ever shows the crash-133 dialog: kill VS Code, `rm -rf /tmp/v/ud`, and relaunch. Prefer `kill` over
`kill -9`; a SIGKILLed profile reproduces that dialog on every subsequent launch.

Then click the Cline icon in the Activity Bar. On a fresh data directory Cline shows onboarding: choose **Bring my
own API key** → **Continue**, then pick a provider, paste the key, pick a model. Afterwards the same settings form
is behind the gear icon in the Cline panel, and **Done** closes it.

## How to see which model a request actually used

Two of the findings are about the UI showing one thing while a different thing is sent. Do not judge these by
looking at the screen. Use one of these instead:

```bash
# Cline logs the model per request. Check both locations: the run's own data dir and the default one.
grep -ao '"model":"[^"]*"' /tmp/v/data/logs/cline.log   2>/dev/null | tail -5
grep -ao '"model":"[^"]*"' ~/.cline/data/logs/cline.log 2>/dev/null | tail -5
```

And when you need proof rather than a hint: set the suspect model id to something that does not exist, like
`totally-not-a-real-model-xyz`. A real provider rejects it by name, so the error message tells you exactly which
model id was sent.

---

## Finding 1 (HIGH) — the model that gets used can differ from the model the UI and config show

**The claim.** A run configured with one model sent its request using a different one. The model that was actually
used came from `~/.cline/data/globalState.json` — the *default* Cline data directory — even though the run was
launched with `CLINE_DATA_DIR` pointing somewhere else. Two things are alleged: that `CLINE_DATA_DIR` does not
isolate this file, and that the effective model comes from `actModeApiModelId` in it rather than from the `model`
field in the run's own `settings/providers.json`.

**Why it matters.** If true, a user can select a model, see it selected, and be billed for a different one, with
nothing on screen indicating anything is wrong.

**Reproduce it.**

1. Look at the default data directory before you start, and save a copy so you can put it back:
   ```bash
   cp ~/.cline/data/globalState.json /tmp/globalState.backup.json 2>/dev/null || echo "no file yet"
   grep -o '"actModeApiModelId":"[^"]*"' ~/.cline/data/globalState.json 2>/dev/null
   ```
2. In the running VS Code, configure **Anthropic** with `$AnthropicKEy` and select a valid model. Confirm what got
   written:
   ```bash
   cat /tmp/v/data/settings/providers.json
   ```
3. Now put a bogus model id into the *default* directory's file, leaving the run's own config alone:
   ```bash
   python3 - <<'EOF'
   import json, os
   p = os.path.expanduser("~/.cline/data/globalState.json")
   s = json.load(open(p)) if os.path.exists(p) else {}
   s["actModeApiModelId"] = "totally-not-a-real-model-xyz"
   s["planModeApiModelId"] = "totally-not-a-real-model-xyz"
   json.dump(s, open(p, "w"), indent=2)
   EOF
   ```
4. Close VS Code, relaunch with the same command, open Cline, and send `Reply with exactly PONG.`
5. Read the result, then restore the file:
   ```bash
   grep -ao '"model":"[^"]*"' /tmp/v/data/logs/cline.log ~/.cline/data/logs/cline.log 2>/dev/null | tail -5
   cp /tmp/globalState.backup.json ~/.cline/data/globalState.json 2>/dev/null
   ```

**Real if** the request used `totally-not-a-real-model-xyz` — you will see Anthropic reject that exact name — while
the settings UI and `/tmp/v/data/settings/providers.json` both still show the model you picked.

**Not real if** the request used the model you selected and the bogus value in the default directory was ignored.

Also worth noting either way: does `/tmp/v/data/globalState.json` exist at all after the run? The report says it
never gets created, which is the reason the default one gets consulted.

---

## Finding 2 (HIGH) — upgrading from the old config format silently loses a model id

**The claim.** Cline used to store provider settings in `globalState.json` + `secrets.json`, and now stores them in
`settings/providers.json`; a migration runs on startup. When the old config used *different providers for Plan and
Act mode*, the migration reads only the mode named in `globalState.mode` and applies it to every provider, so the
other mode's model id is never read and that provider silently falls back to a default.

**Why it matters.** An upgrade quietly changes which model a user's Act mode runs on.

**Reproduce it.** Write the old-format files by hand into a fresh directory, deliberately leaving
`settings/providers.json` out so the migration has to run:

```bash
rm -rf /tmp/v2 && mkdir -p /tmp/v2/data /tmp/v2/ws
printf 'export const name = "john"\n' > /tmp/v2/ws/qa.txt

cat > /tmp/v2/data/globalState.json <<'EOF'
{
  "mode": "plan",
  "planModeApiProvider": "anthropic",
  "planModeApiModelId": "claude-sonnet-4-5-20250929",
  "actModeApiProvider": "openrouter",
  "actModeOpenRouterModelId": "z-ai/glm-4.6"
}
EOF

python3 - <<EOF
import json, os
json.dump({"apiKey": os.environ["AnthropicKEy"],
           "openRouterApiKey": os.environ["OpenrouterAPIKey"]},
          open("/tmp/v2/data/secrets.json", "w"), indent=2)
EOF
```

Then launch against it (close the other window first) and inspect what migration produced:

```bash
DISPLAY=:1 CLINE_DATA_DIR=/tmp/v2/data \
  code --no-sandbox --disable-dev-shm-usage --disable-workspace-trust \
       --user-data-dir=/tmp/v2/ud \
       --extensionDevelopmentPath=/workspace/apps/vscode /tmp/v2/ws

# after the Cline panel has opened once:
cat /tmp/v2/data/settings/providers.json
```

**Real if** the `openrouter` entry's `model` is anything other than `z-ai/glm-4.6` — a default like
`anthropic/claude-sonnet-4.6` is the reported symptom. The Anthropic entry should be correct, which is the tell that
only one mode was read.

**Not real if** the openrouter entry carries `z-ai/glm-4.6`.

Then finish the check in the UI: switch to **Act** mode, send a message, and report which model was actually used
and whether the user was told anything changed.

---

## Finding 3 (MEDIUM) — the Model ID box selects the wrong model when one id is a prefix of another

**The claim.** The Model ID field is an autocomplete. Typing a model id that is a strict prefix of another id
commits the *longer* one, silently. It was seen with a pair of test ids; nobody checked it against real models.

**Why it matters.** A user picks `gpt-4.1` and gets billed for a different model without ever seeing it happen.

**Reproduce it.** OpenRouter serves plenty of prefix-sharing pairs. Use `openai/gpt-4.1`, which is a strict prefix
of `openai/gpt-4.1-mini`.

1. Configure **OpenRouter** with `$OpenrouterAPIKey`.
2. In the Model ID field, type exactly `openai/gpt-4.1` and commit it the way a user would.
3. Do **not** trust the field. Check what was stored:
   ```bash
   grep -o '"model":"[^"]*"' /tmp/v/data/settings/providers.json
   ```
4. Send a message and check what was sent:
   ```bash
   grep -ao '"model":"[^"]*"' /tmp/v/data/logs/cline.log ~/.cline/data/logs/cline.log 2>/dev/null | tail -3
   ```
5. Try committing it three ways — pressing Enter, clicking elsewhere to blur the field, and clicking the exact
   matching entry in the dropdown — and report which of them go wrong.

**Real if** any commit path stores or sends `openai/gpt-4.1-mini` (or any id other than the one you typed).

**Not real if** all three paths keep `openai/gpt-4.1` exactly.

---

## Finding 4 (MEDIUM) — provider errors give the user no way forward

**The claim.** A bad key, a rate limit and a context overflow all rendered as the same plain red text, with no
Retry button, and none of them were visually distinguished from each other even though Cline has dedicated UI
components for some of these cases. This was only observed against a mock endpoint, so it may be an artifact of
that mock rather than real provider behaviour.

**Why it matters.** A 401 should route the user to the setting that caused it. If every failure looks identical,
nobody can act on any of them.

**Reproduce it.** Use real providers, which is exactly what the original report could not do.

1. **Bad key.** Configure Anthropic, then edit the key to a wrong-but-plausible value (take `$AnthropicKEy` and
   change the last four characters). Send a message. Record the exact error text, character for character, and
   screenshot it. Is there a Retry button? A link or button into settings? Does it name Anthropic?
2. Repeat with OpenAI and OpenRouter. Report whether the three read differently or all collapse into the same
   generic red text.
3. **Malformed key.** Set the key to `x` and send. Then set a key with a trailing newline and send — that should be
   trimmed, not produce a mysterious failure.
4. **Context overflow.** Pick a small-context model and paste a very large file into the chat until the request is
   too big. Report whether the message explains that the conversation is too long, whether compaction kicks in
   automatically, and whether the user is told.
5. **Rate limit**, if you can get one: send requests back to back on a free OpenRouter model until it refuses.
   Report the message, and whether Cline retried aggressively.

**Real if** the errors carry no Retry affordance and no route to settings, and a 401 is indistinguishable from a
context overflow apart from the text.

**Not real if** real providers produce differentiated, actionable error UI and only the mock collapsed them.

Mark any step you could not trigger as inconclusive and say why — do not guess.

---

## If you were given other findings to check

Verify them the same way: state the claim, reproduce it with real keys on a clean VS Code, and give a verdict with a
transcript. Apply the same two rules that matter most here — establish which model or provider was used from the
logs or from an error message rather than from the screen, and never call something confirmed without evidence
someone else could re-run.

## What to report

For each of the four findings:

- **Verdict**: real / not real / inconclusive.
- **What you did**: the actual steps, including which provider and model.
- **Evidence**: command output, exact error text, screenshots. Terminal output beats a description.
- **Severity you would give it** now that you have seen it, and whether you would change the reported severity.

Then, briefly: anything that got in your way, and anything you noticed that was not in these four claims but looks
wrong. New findings are welcome, but keep them clearly separate from the verdicts.
