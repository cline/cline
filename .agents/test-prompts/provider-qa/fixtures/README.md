# Provider QA fixtures

Harness for the provider QA runs: it owns the VS Code instance under test, a
fault-injection mock provider, and the read-backs that tell you what the
extension actually had configured and what actually went out on the wire.

## Files

| file | purpose |
|------|---------|
| `qa-env.sh` | the only way a QA run should start or stop VS Code; also runs the mock and reports request counts |
| `fault-proxy.mjs` | OpenAI-compatible mock whose behaviour is selected by the request's `model` field |
| `apply-keys.mjs` | seeds an isolated Cline profile from a key file, and prints what a profile has configured |

## Usage

```bash
export QA=.agents/test-prompts/provider-qa/fixtures

bash $QA/qa-env.sh doctor
bash $QA/qa-env.sh proxy start
node $QA/apply-keys.mjs --keys /tmp/qa-keys.json --list
bash $QA/qa-env.sh start costerr --keys /tmp/qa-keys.json --select openai-compatible
bash $QA/qa-env.sh status          # must report exactly one instance

bash $QA/qa-env.sh state costerr   # provider, model id, base url, prices, key digests
bash $QA/qa-env.sh proxy models    # model id per request, as seen by the server
bash $QA/qa-env.sh proxy count     # request totals per model (retry storms show up here)

bash $QA/qa-env.sh stop            # or: recover, if it will not die
```

Profiles live under `/tmp/qa-profiles/<name>`: a VS Code `--user-data-dir`, an
isolated `CLINE_DIR`, and a scratch workspace containing a ~900 KB
`large-file.txt` for context-overflow cases. Nothing touches the developer's
own `~/.cline`.

`--price` seeds per-1M prices for the OpenAI-compatible model so cost
arithmetic is checkable by hand. Note that the extension rewrites
`*OpenAiModelInfo` when the model id changes, so prices generally have to be
entered through the settings UI to stick.

## Fault models

Behaviour is keyed by model id, which means a fault can be selected from the
settings UI without restarting anything.

| model | behaviour |
|-------|-----------|
| `fault/ok` | 4213 in / 118 out, 3072 cache read, 1024 cache write (reported both top-level and nested) |
| `fault/ok-no-cache` | 4213 in / 118 out, no cache fields |
| `fault/big-usage` | 1.2M in / 90k out |
| `fault/zero-usage` | all counters zero |
| `fault/no-usage` | no usage block at all |
| `fault/nested-cache-write` | cache write reported **only** under `prompt_tokens_details` |
| `fault/completion-tool` | reply ends by calling the host's completion tool |
| `fault/401` | 401 `invalid_api_key` |
| `fault/402` | 402 `insufficient_credits` |
| `fault/429` | 429 with `Retry-After: 20` |
| `fault/context-overflow` | 400 `context_length_exceeded` |
| `fault/500` | 500 with an HTML body |
| `fault/hang` | accepts the request and never responds |
| `fault/truncated-stream` | stream cut mid-chunk |
| `fault/slow-stream` | one token every 3 s |

Every reply except `fault/completion-tool` omits tool calls, so each user
message is exactly one upstream request and per-turn token accounting stays
checkable.

The request log (`/tmp/qa-proxy/requests.jsonl`) records the model, message and
tool counts, prompt size, and a digest of the `Authorization` value plus
whether it carried surrounding whitespace — never the key itself.
