# Provider QA D — Tool calling per provider

You are a QA agent. You drive a real VS Code window on `DISPLAY=:1` and report what you observe.

You are testing that each provider can actually *do* something, not just talk. A provider that streams text
correctly can still fail at tool calling, because tool calls travel a different part of the wire format and each
provider family encodes them differently.

Two symptoms are the priority because they have bitten before: **the same tool firing twice**, and **arguments
coming back mangled**. Both are most likely in the OpenAI / Responses-API family, where tool arguments stream as
incremental JSON fragments that have to be reassembled.

## Hard rules

Violating any of these invalidates the run.

1. **Launch and stop VS Code only through `qa-env.sh`.** Never type a `code` command. Two instances sharing a
   profile attach to each other and you will test a window you did not configure.
2. **Never `kill -9` VS Code.** Use `qa-env.sh stop`, and `qa-env.sh recover` if it will not die.
3. **Never edit source code, and never "fix" a failing tool call.** Capture it and move on.
4. **Never judge a file edit by looking at the diff in the UI.** The UI is what you are testing. Judge it with
   `git -C <workspace> diff` in the terminal. This is the single most important rule in this run — a double edit
   frequently renders as one row.
5. **Report only what you observed.** Mark anything you did not do as `blocked` or `skipped`.
6. **No bug report without a reproduction**, including the exact prompt and the resulting file contents.

Stop and report if `qa-env.sh start` fails twice after a `recover`, or if `qa-env.sh doctor` blames the
environment.

## Credentials

Save exactly this as `/tmp/qa-keys.json` with your keys filled in. You want at least one provider per protocol
family. The `openai-compatible` entry is pre-pointed at the local mock — leave it as it is.

```json
{
  "anthropic":         { "apiKey": "", "model": "claude-sonnet-4-5-20250929" },
  "openai-native":     { "apiKey": "", "model": "gpt-5.1" },
  "openrouter":        { "apiKey": "", "model": "anthropic/claude-sonnet-4.5" },
  "gemini":            { "apiKey": "", "model": "gemini-2.5-pro" },
  "cline":             { "apiKey": "", "model": "anthropic/claude-sonnet-4.5" },
  "deepseek":          { "apiKey": "", "model": "deepseek-chat" },
  "groq":              { "apiKey": "", "model": "llama-3.3-70b-versatile" },
  "xai":               { "apiKey": "", "model": "grok-4" },
  "mistral":           { "apiKey": "", "model": "mistral-large-latest" },
  "requesty":          { "apiKey": "", "model": "" },
  "together":          { "apiKey": "", "model": "" },
  "vercel-ai-gateway": { "apiKey": "", "model": "" },
  "openai-compatible": { "apiKey": "qa-test-key", "baseUrl": "http://127.0.0.1:8788/v1", "model": "fault/ok" },
  "litellm":           { "apiKey": "", "baseUrl": "", "model": "" },
  "ollama":            { "baseUrl": "http://127.0.0.1:11434", "model": "" },
  "bedrock":           { "awsAccessKey": "", "awsSecretKey": "", "awsRegion": "us-west-2", "model": "anthropic.claude-sonnet-4-20250514-v1:0" },
  "vertex":            { "vertexProjectId": "", "vertexRegion": "us-east5", "model": "claude-sonnet-4@20250514" }
}
```

## Protocol families — cover at least one each

`inferProtocol` in `sdk/packages/llms/src/providers/builtins.ts` routes each provider to one of these. A bug in one
family is invisible in the others, so coverage here matters more than provider count.

| Protocol | Reached by | Test with |
|----------|-----------|-----------|
| `openai-responses` | `client: "openai"`, or `protocol: "openai-responses"` | `openai-native`, `openai-codex`, `litellm` |
| `openai-chat` | the default for everything else | `openrouter`, `groq`, `deepseek`, `together` |
| `anthropic` | `family: "anthropic"` or `"bedrock"` | `anthropic`, `bedrock` |
| `gemini` | `family: "google"` or `"vertex"` | `gemini`, `vertex` |
| `openai-r1` | `protocol: "openai-r1"`, or a model with `apiFormat: "r1"` | a DeepSeek R1 model |

## Preflight

```bash
export QA=/workspace/.agents/test-prompts/provider-qa/fixtures
cd /workspace

bash $QA/qa-env.sh doctor
bash $QA/qa-env.sh proxy start
node $QA/apply-keys.mjs --keys /tmp/qa-keys.json --list
```

Smoke-test each real credential headlessly — a bad key wastes a lot of clicking:

```bash
rm -rf /tmp/cline-qa/smoke
node $QA/apply-keys.mjs --keys /tmp/qa-keys.json --dir /tmp/cline-qa/smoke/data --select anthropic
CLINE_DATA_DIR=/tmp/cline-qa/smoke/data timeout 120 bun run cli "Reply with exactly PONG."
```

Then start the run and put the workspace under git, which is how you get an exact record of what the tools did:

```bash
bash $QA/qa-env.sh start tools --keys /tmp/qa-keys.json --select anthropic
W=/tmp/cline-qa/tools/workspace
git -C $W init -q && git -C $W add -A && git -C $W -c user.email=qa@x -c user.name=qa commit -qm base
bash $QA/qa-env.sh status          # exactly ONE instance
```

Reset between providers with `git -C $W checkout -- .` and re-commit if you added files.

Reaching the UI: Cline icon in the Activity Bar → gear icon in the Cline navbar → **Done**. Dismiss any VS Code
welcome/Copilot/theme modal first. **Switch to Act mode** before running any task below.

`--disable-workspace-trust` is already in the launch line and is not optional here: without it VS Code opens in
Restricted Mode and blocks command execution, which looks exactly like a broken `run_commands` tool.

---

## Case group D1 — The canonical task, per provider

Use the identical prompt everywhere so results are comparable. Case id is `D1-<provider>`.

**Prompt to send:**

```
In qa.txt, replace the word john with cline. Then run `cat qa.txt` and tell me what it printed.
```

That is one `editor` call and one `run_commands` call, in a fixed order, with a verifiable end state.

**Steps**

1. `git -C $W checkout -- .`
2. Switch the provider in Settings; confirm with `bash $QA/qa-env.sh state tools`.
3. `bash $QA/qa-env.sh proxy reset` (only meaningful when pointed at the proxy).
4. Send the prompt. Approve tool calls as they appear.
5. `git -C $W diff` — this, not the UI, tells you what happened to the file.
6. Record the final assistant message verbatim.

**Record per provider:** both tools called and in what order; whether `git diff` matches the UI's rendered diff;
whether the command ran exactly once and its output was fed back; whether the final message correctly reports what
`cat` printed (this proves the tool *result* returned, not just that the tool ran); and whether approve and reject
both work.

**PASS IF** `qa.txt` contains exactly `export const name = "cline"`, the diff shows exactly one change, the command
ran once, and the final message quotes the file contents correctly.

**FAIL IF** the edit was applied twice (look for `clinecline`, or a second edit failing with "old_text not found"
and being swallowed); the UI shows two rows for one execution or one row for two; the command ran more than once;
the tool result never reached the model; or a tool call sits pending forever.

---

## Case group D2 — Argument integrity

`D2-unicode-<provider>` — the highest-yield single check in this run. Run on at least one provider per protocol
family.

Send:

```
Replace the contents of qa.txt with exactly this, preserving every character:
line one with "double quotes" and 'single quotes'
line two with a backslash \ and a brace }
line three with an em dash — and an emoji 🚀
	line four starts with a tab
```

Then compare byte for byte in the terminal:

```bash
cat -A $W/qa.txt        # shows tabs as ^I and line ends as $
git -C $W diff
```

Truncation at the first quote, lost newlines, double-escaped backslashes, and mangled non-ASCII are all findings.

`D2-multitool-<provider>` — ask for three edits to three different files in one turn. All three applied, exactly
once each, each result reported.

`D2-long-<provider>` — ask for an edit whose new content is a few hundred lines. Watch for truncation at a chunk
boundary.

`D2-reject-<provider>` — reject a tool call. The model must be told it was rejected and must not retry in a loop.

`D2-cancel-<provider>` — cancel a turn while a tool is executing. The session must stay usable.

---

## Case group D3 — Deterministic pathological shapes

These need no credentials. Point Settings at OpenAI Compatible (`http://127.0.0.1:8788/v1`) and switch the model
id. They test Cline's *handling*, independently of whether any real provider misbehaves today.

Confirm each model id with `qa-env.sh state tools` before sending — the Model ID field commits longer prefix
matches.

| id | Model | What the server sends | What Cline must do |
|----|-------|----------------------|--------------------|
| `D3-baseline` | `fault/tool-edit` | one clean `editor` call | the edit applied once |
| `D3-multi` | `fault/tool-edit-and-run` | `editor` and `run_commands` in one response | both executed, both results returned |
| `D3-duplicate` | `fault/tool-duplicate` | the identical edit twice, different call ids | apply once, **or** apply twice and surface the second failure. Silently applying twice is the bug |
| `D3-mangled` | `fault/tool-mangled-args` | invalid JSON arguments | a readable error — not a crash, not a silent no-op |
| `D3-split` | `fault/tool-split-args` | arguments streamed one character per delta | reassembled correctly and applied once |
| `D3-unicode` | `fault/tool-unicode-args` | quotes, newlines, tabs, backslash, em dash, emoji | file matches byte for byte |

`bash $QA/qa-env.sh proxy tail` shows the tool schemas Cline advertised. Baseline `body.tools`: `read_files`,
`search_codebase`, `fetch_web_content`, `editor`, `ask_question`, `attempt_completion`, `run_commands`. Check this
first when a provider misbehaves — a tool missing from the request is a different bug from a tool the model called
wrongly.

The proxy speaks chat-completions faithfully. Its `/v1/responses` support is deliberately minimal, so use **real**
OpenAI or Codex credentials for Responses-API tool-calling semantics; that surface must not be validated against a
mock.

---

## Artifacts

- One video per protocol family: the canonical task end to end, finishing on a terminal showing `git diff`.
- One video of `D2-unicode`, ending on `cat -A` output.
- Screenshots of any duplicated tool row or mangled argument, paired with the `git diff` that proves it.

## Report

Return exactly this JSON, then a short prose summary.

```json
{
  "run": "D",
  "environment": { "doctorClean": true, "notes": "" },
  "credentials": { "usable": [], "unusable": [], "notProvided": [] },
  "protocolCoverage": { "openai-responses": "", "openai-chat": "", "anthropic": "", "gemini": "", "openai-r1": "" },
  "cases": [
    { "id": "D1-anthropic", "provider": "anthropic", "protocol": "anthropic",
      "status": "pass|fail|blocked|skipped",
      "editCorrect": true, "ranOnce": true, "resultFedBack": true, "argsIntact": true,
      "gitDiff": "", "finalMessage": "", "evidence": "", "artifact": "" }
  ],
  "findings": [
    { "id": "F1", "severity": "high|medium|low", "summary": "",
      "repro": [], "expected": "", "actual": "", "evidence": "", "suspectedFile": "" }
  ]
}
```

`protocolCoverage` must name the provider you used for each family, or `"untested"`. `gitDiff` is required on every
`D1-*` case — a case without it is not a result.
