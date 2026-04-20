# Cline Spend-Limit Hook

A minimal `UserPromptSubmit` hook that blocks a user's turn when they are over their budget. Runs *before* any LLM call, so no tokens are spent when blocked.

## Install

```bash
mkdir -p ~/Documents/Cline/Hooks
cp UserPromptSubmit ~/Documents/Cline/Hooks/UserPromptSubmit
chmod +x ~/Documents/Cline/Hooks/UserPromptSubmit
```

Then open Cline → Hooks tab → enable `UserPromptSubmit`.

## Requirements

- `bash`, `curl`, `jq` on your `PATH`
- Backend endpoint live at:
  ```
  GET <apiBaseUrl>/api/v1/users/{userId}/budget/overbudget
  → 200 { "data": { "overbudget": bool, ... } }
  ```

## Environment (dev / staging / prod)

The hook picks its `apiBaseUrl` the same way the extension does:

1. If `~/.cline/endpoints.json` exists with an `apiBaseUrl` field, use it.
2. Otherwise, default to prod (`https://api.cline.bot`).

To point a single developer at staging, create `~/.cline/endpoints.json`:

```json
{
  "appBaseUrl":  "https://staging-app.cline.bot",
  "apiBaseUrl":  "https://core-api.staging.int.cline.bot",
  "mcpBaseUrl":  "https://core-api.staging.int.cline.bot/v1/mcp"
}
```

Local dev: replace `apiBaseUrl` with `http://localhost:7777`.

No extra config system needed — the extension already reads this file at
startup, so the hook and the extension stay in sync automatically.


## Behavior

| Situation | Result |
|---|---|
| Endpoint returns `overbudget: true` | Turn is blocked, user sees "Spend limit reached" |
| Endpoint returns `overbudget: false` | Turn proceeds normally |
| Endpoint unreachable / 4xx / 5xx / timeout | Turn proceeds (fails open — a broken endpoint won't lock users out) |

## Test it

```bash
echo '{"userId":"YOUR_USER_ID"}' | ~/Documents/Cline/Hooks/UserPromptSubmit
```

Expected output is one line of JSON: either `{"cancel":false}` or `{"cancel":true,"errorMessage":"Spend limit reached"}`.

## Uninstall

```bash
rm ~/Documents/Cline/Hooks/UserPromptSubmit
```

---

## Option B — Auto-install via Remote Config

If you're an org admin and want Cline to install this hook automatically on
every enrolled developer's machine, use `spend-limit-hook-install.md` in this
folder. Push it via Remote Config as a `globalRules` entry with
`alwaysEnabled: true`:

```jsonc
{
  "globalRules": [
    {
      "name": "spend-limit-hook-install.md",
      "alwaysEnabled": true,
      "contents": "<entire contents of spend-limit-hook-install.md>"
    }
  ]
}
```

**What happens on the developer's first task:**
1. The rule is injected into the system prompt.
2. Cline tries to `read_file` the hook. Missing → asks user to approve
   `write_to_file` + `chmod +x` (2 prompts). YOLO users see nothing.
3. The hook is now on disk; Cline's `HookDiscoveryCache` picks it up via its
   file watcher.
4. Subsequent `UserPromptSubmit` turns run the hook → pre-LLM spend block.

**On subsequent tasks:** the rule is a single `read_file` existence check
(~few hundred tokens). No installation overhead.

**Self-healing:** if the user deletes the hook, the next task reinstalls it.

