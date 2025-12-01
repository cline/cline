# Message Queue System

## Overview

Bidirectional file-based messaging system enabling external processes (CLI tools, automation scripts) to communicate with Cline and receive task completion notifications.

## Features

- **Command Sending**: External processes can send commands to Cline via JSON files
- **Task Start Notifications**: Cline acknowledges when it begins processing a command
- **Task Completion Notifications**: Cline sends detailed completion notifications when tasks finish
- **Reply Tracking**: All responses include `replyTo` field linking back to original commands

## Architecture

### Directory Structure

```
.message-queue/
├── inbox/          # Commands sent TO Cline
├── responses/      # Responses FROM Cline (task started/completed)
└── outbox/         # (Reserved for future use)
```

### Message Format

All messages are JSON files with this structure:

```json
{
  "id": "uuid",
  "from": "sender-id",
  "to": "recipient-id",
  "timestamp": "ISO-8601",
  "type": "command|response|notification",
  "content": "message text",
  "metadata": {
    "replyTo": "original-message-id"
  }
}
```

## Implementation Details

### Core Components

1. **MessageQueueService** (`src/services/MessageQueueService.ts`)
   - Watches `inbox/` for new command files
   - Sends responses to `responses/` directory
   - Manages message lifecycle

2. **Extension Integration** (`src/extension.ts`)
   - Initializes MessageQueueService on startup
   - Forwards commands to Cline controller
   - Sets up task completion callback

3. **Task Completion Hook** (`src/core/task/tools/handlers/AttemptCompletionHandler.ts`)
   - Triggers callback when Cline calls `attempt_completion`
   - Passes completion result text to message queue

4. **Type Definitions** (`src/core/task/tools/types/TaskConfig.ts`)
   - Added `onTaskComplete` callback to `TaskCallbacks` interface

## Usage

### Python CLI Example

```python
#!/usr/bin/env python3
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

INBOX = Path(".message-queue/inbox")

def send_command(command_text):
    message = {
        "id": str(uuid.uuid4()),
        "from": "my-cli-tool",
        "to": "cline",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": "command",
        "content": command_text,
        "metadata": {}
    }

    filename = f"{int(time.time() * 1000000)}_{message['id'][:8]}.json"
    filepath = INBOX / filename

    with open(filepath, 'w') as f:
        json.dump(message, f, indent=2)

    return message["id"]

# Send a command
msg_id = send_command("Create a file named hello.txt")
```

### Monitoring Responses

```python
import time
from pathlib import Path

RESPONSES = Path(".message-queue/responses")

def wait_for_completion(message_id, timeout=60):
    start = time.time()
    while time.time() - start < timeout:
        for response_file in RESPONSES.glob("*.json"):
            with open(response_file) as f:
                response = json.load(f)

            if response.get("metadata", {}).get("replyTo") == message_id:
                content = response.get("content", "")
                if content.startswith("Task completed:"):
                    print(f"Completed: {content}")
                    return True

        time.sleep(0.5)

    return False
```

## Message Flow

1. **Command Sent**: CLI tool writes JSON file to `.message-queue/inbox/`
2. **Task Started**: Cline sends response: `"Task started: <command>"`
3. **Processing**: Cline executes the requested task
4. **Completion**: Cline calls `attempt_completion` tool
5. **Callback Triggered**: `onTaskComplete` callback executes
6. **Notification Sent**: Response written to `.message-queue/responses/`: `"Task completed: <result>"`

## Example Response

```json
{
  "id": "27623884-d54a-44ad-852c-242c1ad0811c",
  "from": "cline",
  "to": "claude-code",
  "timestamp": "2025-12-01T08:00:03.692Z",
  "type": "response",
  "content": "Task completed: Successfully created the test file...",
  "metadata": {
    "replyTo": "89c17757-7fdc-4e20-8474-bcb634d5ff0e"
  }
}
```

## Tools Included

### interactive_cli.py

Interactive Python CLI for sending commands to Cline and waiting for completion.

**Usage:**
```bash
# Single command
python interactive_cli.py "Create a file named test.txt"

# Interactive mode
python interactive_cli.py
Command> List all Python files
Command> Create a README
Command> quit
```

### message_sender.py

Simple command sender with optional wait for response.

**Usage:**
```bash
python message_sender.py "Your command here" --wait
```

### message_listener.py

Background service that listens for incoming commands.

**Usage:**
```bash
python message_listener.py
```

## Technical Notes

### Callback Chain

1. **Extension** sets `controller.onTaskComplete` callback
2. **Task** passes callback to `ToolExecutor` via constructor
3. **ToolExecutor** includes callback in `TaskConfig.callbacks`
4. **AttemptCompletionHandler** calls `config.callbacks.onTaskComplete(result)`
5. **Extension callback** calls `messageQueue.sendTaskCompletion()`
6. **MessageQueueService** writes response file

### File Naming Convention

Files use timestamp + UUID prefix for uniqueness and chronological ordering:
```
1764576003692_27623884.json
└─────┬─────┘ └───┬────┘
   timestamp    uuid-prefix
```

### Thread Safety

- File system operations are atomic
- Each message has unique ID
- No shared state between processes

## Testing

```bash
# Test complete workflow
python interactive_cli.py "Create a test file called demo.txt with content 'Hello'"

# Check responses
ls -lt .message-queue/responses/ | head -3

# Verify file was created
cat demo.txt
```

## Future Enhancements

- Stream progress updates during long-running tasks
- Support for file attachments in messages
- Message prioritization
- Retry logic for failed operations
- Web dashboard for monitoring message queue
