# QA 05 — Tool calling per provider, not just chat

You are testing that each provider can actually *do* something, not just talk. A provider that streams text
correctly can still fail at tool calling, because tool calls travel a different part of the wire format and each
provider family encodes them differently.

Two symptoms have bitten before and are the priority: **the same tool firing twice**, and **arguments coming back
mangled**. Both are most likely in the OpenAI / Responses-API family, where tool arguments stream as incremental
JSON fragments that have to be reassembled.

Owning code:

- `sdk/packages/llms/src/providers/ai-sdk.ts` — `toAiSdkTools`, and `experimental_repairToolCall`. That repair hook
  is itself a signal: if a provider frequently needs repair, its arguments are arriving broken.
- `sdk/packages/llms/src/providers/compat.ts` — `resolveFactory`, which decides Responses vs. chat-completions vs.
  Anthropic messages
- `sdk/packages/core/src/extensions/tools/definitions.ts` — the `editor` and `run_commands` tools
- `sdk/packages/llms/src/providers/vendors/openai.ts` — the Responses API path specifically

## Protocol families, and why the split matters

`inferProtocol` in `sdk/packages/llms/src/providers/builtins.ts` routes each provider to one of these. Test at
least one provider per family, because a bug in one family is invisible in the others.

| Protocol | Reached by | Test with |
|----------|-----------|-----------|
| `openai-responses` | `client: "openai"`, or `protocol: "openai-responses"` | `openai-native`, `openai-codex`, `litellm` |
| `openai-chat` | the default for everything else | `openrouter`, `groq`, `deepseek`, `together` |
| `anthropic` | `family: "anthropic"` or `"bedrock"` | `anthropic`, `bedrock` |
| `gemini` | `family: "google"` or `"vertex"` | `gemini`, `vertex` |
| `openai-r1` | `protocol: "openai-r1"`, or a model with `apiFormat: "r1"` | a DeepSeek R1 model |

A custom provider can be forced onto the Responses path by setting `"protocol": "openai-responses"` in its
`providers.json` entry — useful for isolating whether a bug belongs to the protocol or the vendor.

## Setup

```bash
export QA=/tmp/cline-qa/tools
rm -rf "$QA" && mkdir -p "$QA/data/settings" "$QA/workspace"
printf 'export const name = "john"\n' > "$QA/workspace/qa.txt"
git -C "$QA/workspace" init -q && git -C "$QA/workspace" add -A && git -C "$QA/workspace" -c user.email=qa@x -c user.name=qa commit -qm base

cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-tools -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --disable-workspace-trust --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

The git repo gives you `git -C "$QA/workspace" diff` as an exact record of what the tools did to the file — which
is how you catch a double edit that the UI rendered only once.

## The canonical task

Use the same prompt on every provider so results are comparable. Switch to **Act** mode first.

```
In qa.txt, replace the word john with cline. Then run `cat qa.txt` and tell me what it printed.
```

That is one `editor` call and one `run_commands` call, in a fixed order, with a verifiable end state.

For each provider, record:

1. Whether both tools were called, and in what order.
2. Whether the diff shown in the UI matches `git -C "$QA/workspace" diff`.
3. Whether the command ran once and its output was fed back to the model.
4. Whether the final assistant message correctly reports what `cat` printed — this proves the tool *result* made it
   back, not just that the tool ran.
5. Approval behaviour: the approve/reject buttons appear, approve works, reject actually stops the tool.

Then reset with `git -C "$QA/workspace" checkout -- qa.txt` before the next provider.

## The specific things to watch for

**Duplicate firing.** After the turn, count the edits in `git diff` and count the tool rows in the UI. A single
logical edit applied twice may produce `clinecline`, or a second edit that fails with "old_text not found" and gets
silently swallowed. Also check for two rows in the UI representing one execution, and one row representing two.

**Mangled arguments.** Give the model a payload that stresses JSON encoding:

```
Replace the contents of qa.txt with exactly this, preserving every character:
line one with "double quotes" and 'single quotes'
line two with a backslash \ and a brace }
line three with an em dash — and an emoji 🚀
	line four starts with a tab
```

Then diff the file against what you asked for, byte for byte. Truncation at the first quote, lost newlines,
double-escaped backslashes, and mangled non-ASCII are all findings. Do this on at least one provider from each
protocol family; it is the highest-yield single check in this prompt.

**Streaming reassembly.** Some providers emit tool arguments across many small deltas. A reassembly bug shows up as
a truncated or invalid-JSON argument. If a turn fails with a schema/validation error on the tool input, capture the
raw request/response before retrying.

**Multi-tool turns.** Ask for three edits to three different files in one turn. All three must be applied, exactly
once each, and each result reported back.

**Long payloads.** Ask for an edit whose `new_text` is a few hundred lines. Watch for truncation at a chunk
boundary.

**Rejection and interruption.** Reject a tool call and confirm the model is told it was rejected and does not
retry it in a loop. Cancel a turn while a tool is executing and confirm the session recovers.

## Deterministic reproductions

The fault proxy can emit the pathological tool-call shapes on demand, so you can verify Cline's *handling*
independently of whether any real provider happens to misbehave today. Configure OpenAI Compatible against
`http://127.0.0.1:8788/v1` after starting:

```bash
node /workspace/.agents/test-prompts/provider-qa/fixtures/fault-proxy.mjs
```

- `fault/tool-edit` — one clean `editor` call; the baseline.
- `fault/tool-edit-and-run` — `editor` and `run_commands` in one response.
- `fault/tool-duplicate` — the identical edit emitted twice with different call ids. Cline should apply it once, or
  apply it twice and surface the second failure clearly. Silently applying it twice is the bug.
- `fault/tool-mangled-args` — arguments that are invalid JSON. Expect a readable error, not a crash and not a
  silent no-op.
- `fault/tool-split-args` — arguments streamed one character per delta, to exercise reassembly.
- `fault/tool-unicode-args` — quotes, newlines, tabs, a backslash, an em dash and an emoji in `new_text`. Compare
  the resulting file byte for byte.

The proxy also logs the outbound request, so `tail -1 /tmp/fault-proxy.jsonl` shows you the exact tool schemas
Cline advertised. A confirmed-good baseline for `body.tools` is `read_files`, `search_codebase`,
`fetch_web_content`, `editor`, `ask_question`, `attempt_completion`, `run_commands`. If a provider misbehaves,
check this first — a tool missing from the request is a different bug from a tool the model called wrongly.

The proxy speaks chat-completions faithfully. Its `/v1/responses` support is deliberately minimal, so use **real**
OpenAI or Codex credentials for Responses-API tool-calling semantics — that is precisely the surface that should
not be validated against a mock.

## Artifacts

- One video per protocol family: the canonical task running end to end, ending on the terminal output and the final
  message.
- One video of the unicode/quotes payload, ending on a byte-for-byte diff in the terminal.
- Screenshots of any duplicated tool row or mangled argument, with the matching `git diff`.

## Report

A table of provider, protocol family, edit correct, command ran once, result fed back, args intact. Then a section
per finding with the provider, model, the exact prompt, what the file should contain, what it contains, and the raw
tool arguments if you could capture them.
