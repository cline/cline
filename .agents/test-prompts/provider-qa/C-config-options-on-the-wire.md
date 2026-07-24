# Provider QA C — Config options on the wire

You are a QA agent. You drive a real VS Code window on `DISPLAY=:1` and report what you observe.

A settings field is only functional if it does three things: accepts input, survives a round trip through storage,
and changes the request sent to the provider. The bug this run exists to find is a field that does the first two
and not the third — it looks configured and it is being ignored, which is invisible to users.

So your method is never "type in the box and check the box still has the text". It is "type in the box, then read
the request the provider received". Almost none of this needs a real credential, because a local endpoint that logs
everything is a better oracle than a real provider.

## Hard rules

Violating any of these invalidates the run.

1. **Launch and stop VS Code only through `qa-env.sh`.** Never type a `code` command. Two instances sharing a
   profile attach to each other and you will test a window you did not configure.
2. **Never `kill -9` VS Code.** Use `qa-env.sh stop`, and `qa-env.sh recover` if it will not die.
3. **Never edit source code, and never "fix" anything.**
4. **Never read a value that matters off the screen.** Confirm settings with `qa-env.sh state` and requests with
   the proxy log. An agent on a previous run misread a model id on screen as `1autlok`.
5. **Report only what you observed.** Mark anything you did not do as `blocked` or `skipped`.
6. **No bug report without a reproduction.**

Stop and report if `qa-env.sh start` fails twice after a `recover`, or if `qa-env.sh doctor` blames the
environment.

## Credentials

Save exactly this as `/tmp/qa-keys.json`. Most cases need nothing filled in; the `openai-compatible` entry is
pre-pointed at the local mock and must be left as it is.

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

## Preflight

```bash
export QA=/workspace/.agents/test-prompts/provider-qa/fixtures
cd /workspace

bash $QA/qa-env.sh doctor                                  # must not report ENVIRONMENT FAILURE
bash $QA/qa-env.sh proxy start                             # wire observer on :8788
bash $QA/qa-env.sh start config --keys /tmp/qa-keys.json --select openai-compatible
bash $QA/qa-env.sh status                                  # exactly ONE instance
```

Reaching the UI: Cline icon in the Activity Bar → gear icon in the Cline navbar → **Done** to close. Dismiss any
VS Code welcome/Copilot/theme modal first.

Known UI trap: the **Model ID** field is an autocomplete that commits longer prefix matches — typing `fault/ok`
can leave you on `fault/ok-no-cache`. Confirm every model change with `qa-env.sh state config`.

## Reading the wire

```bash
bash $QA/qa-env.sh proxy reset     # before each case
# ... perform the UI action, then send a chat message ...
bash $QA/qa-env.sh proxy tail      # last request in full: path, headers, body
```

Confirmed-good baseline for a healthy request: `path` is `/v1/chat/completions`; `headers.authorization` is
`Bearer qa-test-key`; `body.model` is the model you selected; `body.tools` lists `read_files`, `search_codebase`,
`fetch_web_content`, `editor`, `ask_question`, `attempt_completion`, `run_commands`.

## The procedure every case follows

1. `bash $QA/qa-env.sh proxy reset`
2. Set the field in the UI to a distinctive value.
3. Confirm it persisted: `bash $QA/qa-env.sh state config`.
4. Send `Reply with exactly PONG.` in the chat.
5. `bash $QA/qa-env.sh proxy tail` — find your value in the request.
6. Close and reopen Settings; confirm the field still reads back.

Record three booleans per field: **accepted**, **persisted**, **on the wire**. A field that is persisted but never
on the wire is the highest-value finding in this run — flag it explicitly.

---

## Case group C1 — OpenAI Compatible

The richest form and the only one you can fully verify. Case ids as given.

| id | Field | What to set | Expected on the wire |
|----|-------|-------------|----------------------|
| `C1-baseurl` | Base URL | `http://127.0.0.1:8788/v1` | request appears in the proxy log at all |
| `C1-baseurl-bad` | Base URL | `http://127.0.0.1:8788/wrong` | readable 404 in the UI, not a hang |
| `C1-headers` | Custom headers | `X-Tenant: qa` and `X-Trace: 12345` | both present in `headers` |
| `C1-headers-remove` | Custom headers | delete one of the two | the deleted one stops being sent |
| `C1-model` | Model ID | `fault/big-usage` | `body.model` matches exactly |
| `C1-timeout` | Request timeout | 3 seconds, model `fault/hang` | UI errors at roughly 3s, no indefinite spinner |
| `C1-azure` | Azure API version, if exposed | any value | appears in the request URL query string |
| `C1-params` | Any max-tokens / temperature / context override the form exposes | any value | appears in `body` |

---

## Case group C2 — Other providers

| id | What to test |
|----|--------------|
| `C2-reasoning` | Set thinking budget or reasoning effort on a provider that supports it; confirm it lands in `body`. Then switch provider away and back and confirm it did not silently reset. |
| `C2-local` | Point Ollama's base URL at `http://127.0.0.1:8788` and confirm the proxy sees the model-list poll (`proxy models` shows a `GET /v1/models`). Then point it somewhere dead and confirm the form says so rather than spinning. |
| `C2-regional` | The `china` / `international` toggles on Qwen, Moonshot, Z AI and MiniMax change the API base. Flip each; confirm the resolved base URL changes in the form **and** in `qa-env.sh state`. |
| `C2-sap-oca` | SAP AI Core orchestration-mode toggle and OCA internal/external mode: same check. |
| `C2-bedrock` | Region, the three authentication modes, cross-region inference, global inference, prompt cache, custom endpoint. Persistence and form behaviour are testable without AWS access — mark the on-the-wire half `skipped` if you have no credentials. |
| `C2-planact` | Enable *Use different models for Plan and Act modes*, set a different provider and model per tab, and confirm each mode's request goes where its tab said (`proxy models` after a message in each mode). Then disable the checkbox and record how the two configurations converge. |
| `C2-generic` | Pick three providers rendered by `GenericProviderSettings` — `deepseek`, `groq`, `together` — and confirm every field the generated form renders is actually wired. These are generated, so an unwired field is easy to miss. |

---

## Case group C3 — Cross-cutting traps

| id | Trap |
|----|------|
| `C3-roundtrip` | Switch provider A → B → A. Every field set on A must come back. This is the most commonly reported failure in this area. |
| `C3-reload` | Set a field, then reload the window without closing Settings. |
| `C3-uncommitted` | Leave a field focused and mid-edit, then navigate away. It must either commit or clearly discard — not commit on some paths only. |
| `C3-whitespace` | Paste a key with a trailing newline. It should be trimmed, not produce an undiagnosable auth failure. |
| `C3-invalid` | Enter a base URL with no scheme, and a negative timeout. Expect validation, not a failed request twenty seconds later. |

---

## Artifacts

- One video: setting a custom header and a base URL, sending a message, then the terminal showing
  `qa-env.sh proxy tail` with both on the wire. This is the headline artifact — the whole run is about that
  connection between UI and wire, so the video must show both.
- One screenshot of a fully populated provider form beside its `qa-env.sh state` output.

## Report

Return exactly this JSON, then a short prose summary.

```json
{
  "run": "C",
  "environment": { "doctorClean": true, "notes": "" },
  "cases": [
    { "id": "C1-headers", "status": "pass|fail|blocked|skipped",
      "accepted": true, "persisted": true, "onTheWire": true,
      "valueSet": "", "evidence": "", "artifact": "" }
  ],
  "persistedButNotSent": [],
  "findings": [
    { "id": "F1", "severity": "high|medium|low", "summary": "",
      "repro": [], "expected": "", "actual": "", "evidence": "", "suspectedFile": "" }
  ]
}
```

`persistedButNotSent` is the headline result of this run: every field that survived a settings round trip but never
appeared in the request. `evidence` must be a proxy-log snippet, never a recollection.
