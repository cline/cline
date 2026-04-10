# Slack Bot Example (Chat SDK + Cline Agents SDK)

This example wires the [chat](https://www.npmjs.com/package/chat) Slack adapter to a Cline agent runtime.

It supports:

- Single-workspace Slack apps (`SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET`)
- Multi-workspace OAuth installs (`SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET`)
- Thread-level Cline conversation memory
- Optional Slack Assistants API suggested prompts
- `/clear` slash command to clear per-thread agent history

Code entrypoint:

- [src/index.ts](./apps/examples/slack-bot/src/index.ts)

## 1. Install Dependencies

From workspace root:

```bash
bun install
```

## 2. Create Your Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Create a new app from manifest
3. Paste this manifest (replace `https://your-domain.com`):

```yaml
display_information:
  name: Cline Slack Bot
  description: Slack bot powered by chat-sdk + Cline agents

features:
  bot_user:
    display_name: Cline Bot
    always_online: true

oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - groups:history
      - groups:read
      - im:history
      - im:read
      - mpim:history
      - mpim:read
      - reactions:read
      - reactions:write
      - users:read
      - assistant:write

settings:
  event_subscriptions:
    request_url: https://your-domain.com/api/webhooks/slack
    bot_events:
      - app_mention
      - message.channels
      - message.groups
      - message.im
      - message.mpim
      - assistant_thread_started
      - assistant_thread_context_changed
  interactivity:
    is_enabled: true
    request_url: https://your-domain.com/api/webhooks/slack
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

4. (Optional) Add slash command `/clear` with the same request URL (`/api/webhooks/slack`)

## 3. Configure Environment Variables

Create `apps/examples/slack-bot/.env` (or export in shell):

```bash
# Slack (single-workspace mode)
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# Slack (multi-workspace OAuth mode, optional)
# SLACK_CLIENT_ID=...
# SLACK_CLIENT_SECRET=...

# Server
PORT=8787
BASE_URL=http://localhost:8787

# Cline provider settings file (required)
CLINE_SLACK_BOT_PROVIDER_CONFIG=/absolute/path/to/providers.json

# Optional overrides
# CLINE_SYSTEM_PROMPT=You are a concise, practical Slack assistant.
# BOT_USERNAME=cline
# LOG_LEVEL=info
```

Notes:

- If both `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` are set, the bot runs in OAuth mode.
- Otherwise it runs in single-workspace mode with `SLACK_BOT_TOKEN`.
- The bot loads model/provider/auth from `CLINE_SLACK_BOT_PROVIDER_CONFIG` using the same provider settings schema used by Cline.
- For stored `providers.json` format, it uses `lastUsedProvider` when present; otherwise it falls back to the first provider entry.

### Provider config file format

The bot accepts any of these:

1. Stored `providers.json` shape (recommended):

```json
{
  "version": 1,
  "lastUsedProvider": "openai-native",
  "providers": {
    "openai-native": {
      "settings": {
        "provider": "openai-native",
        "model": "gpt-5-mini",
        "apiKey": "sk-..."
      },
      "updatedAt": "2026-03-06T00:00:00.000Z",
      "tokenSource": "manual"
    }
  }
}
```

2. Array of provider settings entries:

```json
[
  {
    "provider": "openai-native",
    "model": "gpt-5-mini",
    "apiKey": "sk-..."
  }
]
```

3. Single provider settings object:

```json
{
  "provider": "openai-native",
  "model": "gpt-5-mini",
  "apiKey": "sk-..."
}
```

## 4. Run The Bot

From workspace root:

```bash
bun --env-file apps/examples/slack-bot/.env apps/examples/slack-bot/src/index.ts
```

Endpoints exposed by this example:

- `POST /api/webhooks/slack`
- `GET /api/slack/install/callback` (OAuth mode only)
- `GET /health`

## 5. Point Slack To Your Webhook

For local development you need a public tunnel URL:

```bash
ngrok http 8787
```

Then update your Slack app URLs to:

- Event Subscriptions request URL: `https://<ngrok-host>/api/webhooks/slack`
- Interactivity request URL: `https://<ngrok-host>/api/webhooks/slack`
- OAuth Redirect URL (multi-workspace): `https://<ngrok-host>/api/slack/install/callback`

## 6. Install And Test

Single workspace:

1. Slack app settings -> OAuth & Permissions -> Install to Workspace
2. Invite bot to channel
3. Mention it: `@Cline Bot summarize this thread`

Multi-workspace:

1. Enable distribution and configure redirect URL
2. Start OAuth install flow for your app
3. Callback route stores installation automatically
4. Mention the bot in a channel

## Implementation Details

- Incoming messages are handled by `chat` webhook routing.
- The bot subscribes to threads when first mentioned, then continues on follow-ups.
- Each Slack thread gets one in-memory `Agent` instance from `@clinebot/agents`.
- Agent provider/model/auth are read from `CLINE_SLACK_BOT_PROVIDER_CONFIG`.
- The agent uses plain LLM calls (`tools: []`) by default.
- `/clear` clears thread memory by dropping that thread's agent runtime.

## Troubleshooting

- `Missing required environment variable: SLACK_SIGNING_SECRET`
  - Set `SLACK_SIGNING_SECRET` for webhook verification.
- `Missing required environment variable: CLINE_SLACK_BOT_PROVIDER_CONFIG`
  - Set it to an absolute path to your provider settings JSON.
- Provider config parse error
  - Ensure JSON matches `ProviderSettings` schema (`provider`, `model`, and auth fields like `apiKey` / `auth.accessToken`).
- Bot does not respond
  - Confirm request URL is reachable from Slack and app is installed.
  - Ensure bot is invited to the channel.
- OAuth callback returns 400 in single-workspace mode
  - This is expected unless `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` are set.
