# provider QA fixtures

Harness for the provider tool-calling QA runs. Nothing here is product code; it
exists so a QA run never has to hand-launch an editor or hand-craft provider
config, and so every case leaves behind reproducible evidence.

## Pieces

| File | Purpose |
|------|---------|
| `qa-env.sh` | Owns the lifecycle of the VS Code instance under test, the mock provider, and the per-instance workspace/data dirs. |
| `apply-keys.mjs` | Turns a flat QA key file into `<data-dir>/settings/providers.json`, the single source of truth both the CLI and the VS Code extension read. |
| `mock-provider.mjs` | Fault-injecting OpenAI-compatible server. The model id selects the wire-level pathology. |
| `run-case.sh` | Runs one headless case and captures prompt, transcript, `git diff`, `cat -A`, and the recorded wire traffic. |

## Key file

`apply-keys.mjs` reads a flat JSON object keyed by provider id:

```json
{
  "anthropic":         { "apiKey": "", "model": "claude-sonnet-4-5-20250929" },
  "openai-compatible": { "apiKey": "qa-test-key", "baseUrl": "http://127.0.0.1:8788/v1", "model": "fault/ok" },
  "bedrock":           { "awsAccessKey": "", "awsSecretKey": "", "awsRegion": "us-west-2", "model": "…" },
  "vertex":            { "vertexProjectId": "", "vertexRegion": "us-east5", "model": "…" }
}
```

An optional `"protocol"` field is passed straight through, which is the only way
to reach `openai-r1` — `inferProtocol` in
`sdk/packages/llms/src/providers/builtins.ts` never returns it.

## Typical run

```bash
export QA=/workspace/.agents/test-prompts/provider-qa/fixtures

bash $QA/qa-env.sh doctor
bash $QA/qa-env.sh proxy start
node $QA/apply-keys.mjs --keys /tmp/qa-keys.json --list

# GUI instance (exactly one at a time, always via this script)
bash $QA/qa-env.sh start tools --keys /tmp/qa-keys.json --select anthropic
bash $QA/qa-env.sh status
bash $QA/qa-env.sh state tools

# headless instance (no editor launched)
bash $QA/qa-env.sh prepare cli --keys /tmp/qa-keys.json --select anthropic
bash $QA/run-case.sh --instance cli --id D1-anthropic --provider anthropic \
  --model claude-sonnet-4-5-20250929 \
  --prompt 'In qa.txt, replace the word john with cline. Then run `cat qa.txt` and tell me what it printed.'

bash $QA/qa-env.sh stop           # graceful only
bash $QA/qa-env.sh recover        # escalation path when SIGTERM is ignored
```

`stop` never uses `SIGKILL`; `recover` is the only place escalation happens, and
only against pids this script started.

## Mock provider models

Point Settings at OpenAI Compatible (`http://127.0.0.1:8788/v1`) and switch the
model id. Phase is derived from how many tool results the request already
carries, so each model drives a complete multi-turn agent loop.

| Model | Wire behaviour |
|-------|----------------|
| `fault/ok` | Performs the canonical task correctly: `editor`, then `run_commands`, then quotes the observed command output. |
| `fault/tool-edit` | One clean `editor` call. |
| `fault/tool-edit-and-run` | `editor` and `run_commands` in one response. |
| `fault/tool-duplicate` | The identical edit twice, different call ids. |
| `fault/tool-duplicate-insert` | A duplicated `insert_line` edit — unlike a replace, applying it twice succeeds twice and is visible in the file. |
| `fault/tool-mangled-args` | Syntactically invalid JSON arguments. |
| `fault/tool-split-args` | Arguments streamed one character per delta. |
| `fault/tool-unicode-args` | Quotes, newlines, tabs, backslash, em dash, emoji. |
| `fault/tool-long-args` | A few hundred lines of new content. |
| `fault/text-only` | Plain text, for connectivity smoke tests. |

`/v1/chat/completions` is faithful. `/v1/responses` is a deliberately minimal
subset (`response.created`, `output_item.added`, `function_call_arguments.delta`,
`output_item.done`, `response.completed`) — enough to exercise argument
reassembly, but Responses-API semantics should still be validated against real
OpenAI or Codex credentials.

Inspect what Cline advertised with `bash $QA/qa-env.sh proxy tail`. A tool
missing from the request is a different bug from a tool the model called wrongly.
