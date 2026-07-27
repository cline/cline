Paste this to an agent, with the findings you want checked appended at the bottom.

---

You're verifying bug reports about Cline's provider handling. The repo is at `/workspace` and real API keys are in
your environment — run `env | cut -d= -f1 | grep -iE 'key|token'` to see which you have (Anthropic is
`$AnthropicKEy`, OpenAI `$openAIKey`, OpenRouter `$OpenrouterAPIKey`, Cline `$clineApiKey`). Build the extension if
`apps/vscode/dist/extension.js` is missing, with `cd /workspace/apps/vscode && bun run build:webview && bun
esbuild.mjs`, then launch a clean instance:

```bash
rm -rf /tmp/v && mkdir -p /tmp/v/ws && printf 'export const name = "john"\n' > /tmp/v/ws/qa.txt
DISPLAY=:1 CLINE_DATA_DIR=/tmp/v/data code --no-sandbox --disable-dev-shm-usage \
  --disable-workspace-trust --user-data-dir=/tmp/v/ud \
  --extensionDevelopmentPath=/workspace/apps/vscode /tmp/v/ws
```

`--disable-dev-shm-usage` is required or the window dies at startup with "crashed, code: 133" and looks like a
broken extension; `--disable-workspace-trust` is required or Cline can't run terminal commands. Keep only one VS
Code window open at a time — a second one with the same `--user-data-dir` silently attaches to the first. Click the
Cline icon in the Activity Bar, choose "Bring my own API key", and configure a provider with one of the keys above.

Now reproduce each finding below against a real provider and tell me whether it's **real**, **not real**, or
**inconclusive**. Don't decide by reading model ids or provider names off the screen — several of these bugs are
about the UI disagreeing with what actually happens. Get the truth from
`grep -ao '"model":"[^"]*"' /tmp/v/data/logs/cline.log ~/.cline/data/logs/cline.log`, from
`cat /tmp/v/data/settings/providers.json`, or by setting a model id to something nonexistent like
`not-a-real-model-xyz` so the provider names it in the rejection. For each finding give the verdict, the steps you
actually ran, and the terminal output or exact error text that proves it. If you couldn't trigger something, say
inconclusive and why instead of guessing. Never put a key in your report.

FINDINGS TO VERIFY:

1. ...
2. ...
