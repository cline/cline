# Provider QA D — Tool calling per provider, not just chat

You are testing that each provider can actually *do* something rather than just talk. A provider that streams text
correctly can still fail at tool calling, because tool calls travel a different part of the wire format and each
provider family encodes them differently.

Two symptoms have bitten before and are the priority: **the same tool firing twice**, and **arguments coming back
mangled**. Both are most likely in the OpenAI / Responses-API family, where tool arguments stream as incremental
JSON fragments that must be reassembled.

Report using the template at the bottom. Record video.

## Your credentials

Save this as `/tmp/qa-keys.json` and fill in what you have. You want at least one provider per protocol family (see
the table below); more is better. Empty strings are skipped.

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
  "openai-compatible": { "apiKey": "", "baseUrl": "", "model": "" },
  "litellm":           { "apiKey": "", "baseUrl": "", "model": "" },
  "ollama":            { "baseUrl": "http://127.0.0.1:11434", "model": "" },
  "bedrock":           { "awsAccessKey": "", "awsSecretKey": "", "awsRegion": "us-west-2", "model": "anthropic.claude-sonnet-4-20250514-v1:0" },
  "vertex":            { "vertexProjectId": "", "vertexRegion": "us-east5", "model": "claude-sonnet-4@20250514" }
}
```

Confirm each key works before spending time in the UI — a bad key here wastes a lot of clicking:

```bash
cd /workspace
node .agents/test-prompts/provider-qa/fixtures/apply-keys.mjs --keys /tmp/qa-keys.json --list

export SMOKE=/tmp/cline-qa/smoke
rm -rf "$SMOKE" && node .agents/test-prompts/provider-qa/fixtures/apply-keys.mjs \
  --keys /tmp/qa-keys.json --dir "$SMOKE/data" --select anthropic
CLINE_DATA_DIR="$SMOKE/data" bun run cli "Reply with exactly PONG."
```

## Protocol families, and why the split matters

`inferProtocol` in `sdk/packages/llms/src/providers/builtins.ts` routes each provider to one of these. Test at
least one per family — a bug in one family is invisible in the others.

| Protocol | Reached by | Test with |
|----------|-----------|-----------|
| `openai-responses` | `client: "openai"`, or `protocol: "openai-responses"` | `openai-native`, `openai-codex`, `litellm` |
| `openai-chat` | the default for everything else | `openrouter`, `groq`, `deepseek`, `together` |
| `anthropic` | `family: "anthropic"` or `"bedrock"` | `anthropic`, `bedrock` |
| `gemini` | `family: "google"` or `"vertex"` | `gemini`, `vertex` |
| `openai-r1` | `protocol: "openai-r1"`, or a model with `apiFormat: "r1"` | a DeepSeek R1 model |

A custom provider can be forced onto the Responses path by setting `"protocol": "openai-responses"` in its
`providers.json` entry, which is useful for isolating whether a bug belongs to the protocol or the vendor.

Relevant code when you need to trace something: `sdk/packages/llms/src/providers/ai-sdk.ts` (`toAiSdkTools`, and
`experimental_repairToolCall` — a provider that frequently needs repair is a provider whose arguments arrive
broken), `compat.ts` (`resolveFactory`), `vendors/openai.ts` (the Responses path), and
`sdk/packages/core/src/extensions/tools/definitions.ts` (the `editor` and `run_commands` tools).

## Environment

```bash
export QA=/tmp/cline-qa/tools
rm -rf "$QA" && mkdir -p "$QA/workspace"
printf 'export const name = "john"\n' > "$QA/workspace/qa.txt"
git -C "$QA/workspace" init -q
git -C "$QA/workspace" add -A
git -C "$QA/workspace" -c user.email=qa@x -c user.name=qa commit -qm base

cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs   # only if dist/extension.js is stale

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s fault-proxy -- \
  node /workspace/.agents/test-prompts/provider-qa/fixtures/fault-proxy.mjs

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-qa -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --disable-workspace-trust --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

The git repo gives you `git -C "$QA/workspace" diff` as an exact record of what the tools did — which is how you
catch a double edit that the UI rendered only once. Reset between providers with
`git -C "$QA/workspace" checkout -- .`.

Operational rules, learned the hard way:

- **`--disable-workspace-trust` is not optional in this run.** Without it VS Code opens in Restricted Mode and
  blocks command execution, which looks exactly like a broken `run_commands` tool.
- **One VS Code instance at a time.** A second `code` with the same `--user-data-dir` attaches to the first.
  Check `ps -eo pid,args | grep [e]xtensionDevelopmentPath`.
- **Never `kill -9` VS Code**; it poisons the profile and later launches die with *"The window terminated
  unexpectedly (reason: 'crashed', code: '133')"*. Use `kill -TERM`. On crash 133, kill, `rm -rf
  "$QA/vscode-userdata"`, relaunch. If a plain `code` with no `--extensionDevelopmentPath` also crashes, the
  display is degraded — an environment failure, not a Cline bug.

Reaching the settings: Cline icon in the Activity Bar → gear icon in the Cline navbar → **Done**. Switch to **Act**
mode before running any task below.

## The canonical task

Use the same prompt on every provider so results are comparable.

```
In qa.txt, replace the word john with cline. Then run `cat qa.txt` and tell me what it printed.
```

That is one `editor` call and one `run_commands` call, in a fixed order, with a verifiable end state. For each
provider record:

1. Whether both tools were called, and in what order.
2. Whether the diff shown in the UI matches `git -C "$QA/workspace" diff`.
3. Whether the command ran exactly once and its output was fed back to the model.
4. Whether the final message correctly reports what `cat` printed — this proves the tool *result* made it back, not
   just that the tool ran.
5. Approval behaviour: buttons appear, approve works, reject actually stops the tool.

## What to watch for

**Duplicate firing.** Count the edits in `git diff` and the tool rows in the UI. A single logical edit applied
twice may produce `clinecline`, or a second edit that fails with "old_text not found" and gets swallowed. Also look
for two UI rows representing one execution, and one row representing two.

**Mangled arguments.** This is the highest-yield single check here. Give the model a payload that stresses JSON
encoding:

```
Replace the contents of qa.txt with exactly this, preserving every character:
line one with "double quotes" and 'single quotes'
line two with a backslash \ and a brace }
line three with an em dash — and an emoji 🚀
	line four starts with a tab
```

Diff the result byte for byte. Truncation at the first quote, lost newlines, double-escaped backslashes and
mangled non-ASCII are all findings. Do this on at least one provider per protocol family.

**Streaming reassembly.** Some providers emit tool arguments across many small deltas; a reassembly bug shows up as
truncated or invalid-JSON arguments. If a turn fails with a schema validation error on tool input, capture the raw
request and response before retrying.

**Multi-tool turns.** Ask for three edits to three different files in one turn. All three applied, exactly once
each, each result reported.

**Long payloads.** Ask for an edit whose `new_text` is a few hundred lines, and watch for truncation at a chunk
boundary.

**Rejection and interruption.** Reject a tool call and confirm the model is told, and does not retry in a loop.
Cancel a turn mid-tool-execution and confirm the session recovers.

## Deterministic reproductions

The fault proxy emits the pathological shapes on demand, so you can verify Cline's *handling* independently of
whether any real provider misbehaves today. Configure OpenAI Compatible against `http://127.0.0.1:8788/v1` and
switch model ids:

- `fault/tool-edit` — one clean `editor` call; the baseline.
- `fault/tool-edit-and-run` — `editor` and `run_commands` in one response.
- `fault/tool-duplicate` — the identical edit emitted twice with different call ids. Applying it once, or applying
  twice and surfacing the second failure, are both defensible; silently applying it twice is the bug.
- `fault/tool-mangled-args` — invalid JSON arguments. Expect a readable error, not a crash and not a silent no-op.
- `fault/tool-split-args` — arguments streamed one character per delta.
- `fault/tool-unicode-args` — quotes, newlines, tabs, backslash, em dash and emoji in `new_text`. Compare the file
  byte for byte.

`tail -1 /tmp/fault-proxy.jsonl` shows the exact tool schemas Cline advertised. A confirmed-good baseline for
`body.tools` is `read_files`, `search_codebase`, `fetch_web_content`, `editor`, `ask_question`,
`attempt_completion`, `run_commands`. Check this first when a provider misbehaves — a tool missing from the request
is a different bug from a tool the model called wrongly.

The proxy speaks chat-completions faithfully. Its `/v1/responses` support is deliberately minimal, so use **real**
OpenAI or Codex credentials for Responses-API tool-calling semantics; that is precisely the surface that should not
be validated against a mock.

## Artifacts

- One video per protocol family: the canonical task end to end, finishing on the terminal output and the final
  message.
- One video of the unicode/quotes payload, ending on a byte-for-byte diff in the terminal.
- Screenshots of any duplicated tool row or mangled argument, with the matching `git diff`.

## Report

A table of provider, protocol family, edit correct, command ran once, result fed back, args intact. Then a section
per finding with the provider, model, exact prompt, what the file should contain, what it contains, and the raw
tool arguments if you could capture them.
