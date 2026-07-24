# QA prompt 4 — Tool calling per provider (not just chat)

You are doing **manual QA on the Cline VS Code extension**. Chat working does not mean tools work.
Your job: for each provider in your slice, make the model **edit a file** and **run a command** in
one task, and watch for two specific failure modes:

- the **same tool firing twice** (one intent, two executions)
- **arguments coming back mangled** (truncated JSON, doubled JSON, escaped-string-in-a-string,
  missing fields, whole patch bodies landing in the wrong key)

The OpenAI / Responses-API family is the prime suspect, so it must be in every run.

## Ground rules (do not negotiate these)

1. Every UI action goes through the `computerUse` subagent, driving a real VS Code window on
   `DISPLAY=:1`. Real clicks — you click **Approve** / **Run Command** yourself.
2. Banned as substitutes: Playwright / `bun run e2e`, the mock API server at `localhost:7777`
   (`apps/vscode/src/test/e2e/fixtures/server`), `page.evaluate`, direct gRPC calls, invoking a
   tool from a unit test instead of from a real model turn. Reading logs and session records
   afterwards to *verify* is required.
3. Real network, real keys, real models.
4. PASS requires seeing it on screen **and** filesystem/log corroboration. Statuses: PASS / FAIL /
   BLOCKED / SKIPPED. Never write "should work".
5. Do not edit product code. Record bugs and keep going.
6. Record video of at least one full edit+command task per provider family.

## Environment setup

```bash
cd /workspace/apps/vscode
bun run build:webview && bun esbuild.mjs

export LANE=/tmp/cline-qa/p4
mkdir -p $LANE/clinedir $LANE/userdata $LANE/workspace
cd $LANE/workspace
git init -q .
printf 'export function add(a: number, b: number) {\n\treturn a + b\n}\n' > math.ts
printf 'line one\nline two\nline three\n' > notes.txt
: > counter.txt
git add -A && git commit -qm baseline
```

```bash
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-p4 -c /workspace -- bash -l
tmux -f /exec-daemon/tmux.portal.conf send-keys -t vscode-p4:0.0 \
  'DISPLAY=:1 CLINE_DIR=/tmp/cline-qa/p4/clinedir \
   code --no-sandbox --disable-gpu --disable-workspace-trust \
   --user-data-dir=/tmp/cline-qa/p4/userdata --extensions-dir=/tmp/cline-qa/p4/userdata/exts \
   --extensionDevelopmentPath=/workspace/apps/vscode /tmp/cline-qa/p4/workspace 2>&1 | tee -a /tmp/cline-qa/p4/vscode.log' C-m
```

The git repo in the workspace is the point: `git diff` after each task is your ground truth for
what the edit tool actually did. Reset with `git checkout -- . && : > counter.txt` between cases.

## What you are exercising

Runtime tool names (`sdk/packages/core/src/extensions/tools/definitions.ts`) are **not** the old
XML names:

| Old name you may see in docs | Actual tool |
|------------------------------|-------------|
| `write_to_file` / `replace_in_file` | `editor` (or `apply_patch`) |
| `execute_command` | `run_commands` |
| `read_file` | `read_files` |

Which edit tool a model gets is routed by provider/model
(`sdk/packages/core/src/extensions/tools/model-tool-routing.ts`): `openai-native`, and any model id
containing `codex` or `gpt`, get **`apply_patch`** and have `editor` disabled; everything else gets
`editor`. Confirm the routing matches what you observe, and note any provider where the model
appears to be offered the wrong one.

## Providers to cover

At minimum one per row; include the Responses-API row always.

| Family | Providers | Why |
|--------|-----------|-----|
| OpenAI Responses API | `openai-native` (GPT-5-class), `openai-codex` | Prime suspect for duplicate/mangled tool calls; uses `apply_patch` |
| Anthropic native | `anthropic` | Reference implementation |
| OpenAI-compatible chat completions | `openrouter`, `requesty`, `groq` | Index-based streaming of argument fragments |
| Google | `gemini` / `vertex` | Different tool block format |
| Cline gateway | `cline` | First-party routing |
| Local | `ollama` with a tool-capable model | Weak models produce the worst arguments |

## Test cases

Run T1–T7 per provider.

### T1 — File edit, exact content

Prompt: `In math.ts, add an exported function "sub" that subtracts b from a. Change nothing else.`

Expected: one edit tool call, a diff preview in chat, you click Approve, the file contains exactly
one new function. Verify with `git diff`. **FAIL conditions:** the function added twice, the file
truncated, unrelated lines reformatted, or the diff shown in chat not matching the diff on disk.

### T2 — Command execution, counted

Prompt: `Run exactly this command once: echo QA_MARKER >> counter.txt`

Expected: one `run_commands` approval, you click Run Command, and `wc -l counter.txt` is exactly
**1**. A count of 2 is the duplicate-tool-call bug and is the single most important finding in this
plan — capture the chat transcript and the session record immediately.

### T3 — Edit and command in one task

Prompt: `Add a "mul" function to math.ts, then run: echo BUILT >> counter.txt`

Expected: both tools fire once each, in order, each with its own approval. Check `git diff` and
`counter.txt`.

### T4 — Argument stress: large and awkward payloads

Prompt the model to write a file whose content contains characters that break naive JSON handling:
embedded quotes, backslashes, `{}`/`[]`, a literal `\n` sequence, a long (≥200 line) body, and a
non-ASCII line.

Expected: the file content on disk matches what the chat said it would write, byte for byte where
you can check it. Watch for: escaped sequences written literally, content truncated at a chunk
boundary, or the tail of one argument leaking into another field. This is where streamed argument
fragments get merged wrong, so it is worth repeating a few times per provider — intermittent is
still a FAIL.

### T5 — Multiple tools in sequence

Prompt: `Read notes.txt, then append a fourth line "line four" to it, then run: wc -l notes.txt`

Expected: three distinct tool calls, correct order, `notes.txt` has exactly four lines, and the
command output shown in chat matches reality.

### T6 — Rejection path

Repeat T2 but click **Reject**.

Expected: the command does not run (`counter.txt` unchanged), the model is told it was rejected,
and the task continues coherently rather than hanging or retrying the same command in a loop.

### T7 — Auto-approve

Enable auto-approve for edits and safe commands in the auto-approve bar, then rerun T3.

Expected: no approval prompts, still exactly one execution per tool. Auto-approve is a common place
for double-firing to appear, so re-check `counter.txt` carefully.

## How to detect duplicates and mangling reliably

Do not rely on scrolling the chat. For every task:

- `git diff` and `wc -l counter.txt` in the workspace — the only unfakeable record of what ran
- the session's message record — count tool-call entries and compare their ids; two entries with
  the same intent, or two different ids carrying identical arguments, is a duplicate:

  ```bash
  jq '.messages[] | {role, modelInfo, content}' \
    /tmp/cline-qa/p4/clinedir/data/sessions/<id>/<id>.messages.json
  ```

  `content` is an array of blocks; tool calls appear as their own blocks carrying the tool name and
  the arguments the model actually sent, which is where mangling is visible in raw form
- the Cline output channel (VS Code → Output → Cline) around the tool call
- watch for the "loop detection" nudge in chat (soft warning at 3 identical consecutive calls,
  hard stop at 5) — if you see it during a normal task, the model is being fed something wrong

Also note whether any tool call shows up in chat with empty (`{}`) arguments — the runtime
substitutes an empty input when it cannot parse the model's JSON
(`sdk/packages/agents/src/agent-runtime.ts`), so an empty-args tool call in the UI is a strong
signal that arguments were mangled upstream.

## Report format

A matrix of `provider × T1–T7`. For every FAIL: the exact prompt, the model id, the chat
transcript excerpt, `git diff` / `counter.txt` output, the session-record tool entries, and
whether it reproduces on retry (state how many attempts out of how many). Call out separately, in
one paragraph at the top, whether you saw any duplicate execution or mangled arguments at all and
on which providers.
