# Telegram Connector

The Telegram connector bridges a Telegram Bot API bot into Cline CLI sessions. It is a polling connector, so it does not need a public webhook URL. The connector process must stay running while Telegram access is active.

## Setup

Create a bot with `@BotFather`:

1. Open Telegram and start a chat with `@BotFather`.
2. Send `/newbot` and follow the prompts.
3. Copy the bot username without the leading `@`.
4. Copy the bot token. Treat it like a password.

Start the connector:

```bash
cline connect telegram -m my_bot -k "$TELEGRAM_BOT_TOKEN"
```

Useful variants:

```bash
# Keep logs in the active terminal while debugging.
cline connect telegram -i -m my_bot -k "$TELEGRAM_BOT_TOKEN"

# Read credentials from env vars.
TELEGRAM_BOT_USERNAME=my_bot TELEGRAM_BOT_TOKEN=123456:ABCDEF... cline connect telegram

# Override the workspace and model used for Telegram sessions.
cline connect telegram -m my_bot -k "$TELEGRAM_BOT_TOKEN" --cwd /path/to/repo --provider cline --model openai/gpt-5.3-codex

# Disable tools for untrusted Telegram surfaces.
cline connect telegram -m my_bot -k "$TELEGRAM_BOT_TOKEN" --no-tools

# Stop Telegram connector processes and sessions.
cline connect --stop telegram
```

After the connector starts, send `/help` or `/start` to the bot in Telegram.

## What It Does

- Starts or reuses a Cline RPC-backed session for each Telegram thread.
- Keeps chat history and working-directory state separately per Telegram thread.
- Lets Telegram users ask questions, assign coding tasks, and, when tools are enabled, inspect files, edit files, run commands, and prepare PRs.
- Supports required tool approvals from Telegram with `Y` and `N` replies.
- Can deliver scheduled run results back to a Telegram thread when the connector is running.

## Chat Commands

The Telegram connector uses the shared connector command parser:

- `/help` or `/start` - show connector help
- `/new` or `/clear` - start a fresh session for the current thread
- `/whereami` - show thread, cwd, tools, and yolo state
- `/tools [on|off|toggle]` - allow or block repo/file/shell tools
- `/yolo [on|off|toggle]` - auto-approve tool use
- `/cwd <path>` - change working directory
- `/schedule create/list/trigger/delete` - manage scheduled workflows
- `/abort` - stop the current task
- `/exit` - stop the connector

In Telegram groups, bot-addressed commands such as `/help@my_bot` are normalized only when the suffix matches the configured bot username. Commands addressed to another bot are left unmatched.

## Tools And Access

Tools are enabled by default for Telegram sessions. That means anyone who can successfully message the bot may be able to ask it to inspect or change the configured workspace.

Use `--no-tools` when the Telegram surface is not trusted:

```bash
cline connect telegram -m my_bot -k "$TELEGRAM_BOT_TOKEN" --no-tools
```

When the connector starts with `--no-tools`, chat commands such as `/tools on` and `/yolo on` cannot re-enable tools for that connector run.

For participant restrictions, run the interactive connector wizard with `cline connect` or pass a `--hook-command` that returns `{"action":"deny"}` for unauthorized `session.authorize` events. If no hook is configured, messages are allowed.

## Message Delivery

Telegram final assistant replies are sent directly through Telegram `sendMessage` payloads with message entities. This avoids Telegram markdown parse failures for raw model text. If entity sending fails, the connector falls back to raw text.

Long final assistant replies are split across Telegram messages. Tool/status updates and scheduled delivery messages use the adapter's raw thread posting path.

Telegram final assistant replies are sent after the runtime turn completes. Google Chat and WhatsApp use the shared connector runtime streaming path for incremental assistant text.

## Scheduled Delivery

To deliver a scheduled run result back to Telegram, create the schedule from the Telegram chat when possible:

1. Start the Telegram connector.
2. Send a schedule command in Telegram:

```text
/schedule create "Daily summary" --cron "0 9 * * *" --prompt "Summarize yesterday's activity in this workspace."
```

Schedules created this way automatically target the current Telegram thread for delivery. You can also use `/schedule list`, `/schedule trigger <schedule-id>`, and `/schedule delete <schedule-id>` from Telegram.

If you are creating the schedule outside Telegram, first send `/whereami` in Telegram to get the thread id, then pass the delivery metadata to the CLI:

```bash
cline schedule create "Daily summary" \
  --cron "0 9 * * *" \
  --prompt "Summarize yesterday's activity in this workspace." \
  --workspace /path/to/repo \
  --delivery-adapter telegram \
  --delivery-bot my_bot \
  --delivery-thread telegram:123456789
```

The connector must be running when the scheduled result is delivered, and the target thread must have an existing thread binding.

## Limitations

- The connector is not hosted by Telegram. It is a local CLI process polling Telegram, so it stops working if the machine or connector process is offline.
- The current documented surface is text prompts and command replies. Media-specific Telegram workflows are not part of this connector contract.
- Telegram group message delivery still depends on Telegram bot settings and which events the Bot API delivers to the adapter.
