#!/usr/bin/env python3
"""
Claude Code to Cline Message Sender

Sends messages from Claude Code CLI to Cline via file-based message queue.
"""

import json
import sys
import os
from datetime import datetime, timezone
from pathlib import Path
import uuid

# Fix Windows console encoding
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Message queue paths
SCRIPT_DIR = Path(__file__).parent
QUEUE_DIR = SCRIPT_DIR / ".message-queue"
INBOX_DIR = QUEUE_DIR / "inbox"
RESPONSES_DIR = QUEUE_DIR / "responses"


def ensure_directories():
    """Ensure message queue directories exist."""
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    RESPONSES_DIR.mkdir(parents=True, exist_ok=True)


def send_message(content, message_type="command", reply_to=None):
    """
    Send a message to Cline.

    Args:
        content: Message content (string)
        message_type: Type of message (command, notification, etc.)
        reply_to: Optional message ID this is replying to

    Returns:
        Message ID
    """
    ensure_directories()

    message_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

    message = {
        "id": message_id,
        "from": "claude-code",
        "to": "cline",
        "timestamp": timestamp,
        "type": message_type,
        "content": content,
        "metadata": {}
    }

    if reply_to:
        message["metadata"]["replyTo"] = reply_to

    # Write message to inbox with timestamp as filename
    filename = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S_%f')}_{message_id[:8]}.json"
    filepath = INBOX_DIR / filename

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(message, f, indent=2)

    print(f"✅ Message sent to Cline")
    print(f"   ID: {message_id}")
    print(f"   File: {filepath.name}")
    print(f"   Content: {content[:100]}{'...' if len(content) > 100 else ''}")

    return message_id


def wait_for_response(message_id, timeout=30):
    """
    Wait for a response to a specific message.

    Args:
        message_id: ID of the message to wait for response to
        timeout: Maximum seconds to wait

    Returns:
        Response content or None
    """
    import time

    start_time = time.time()
    print(f"\n⏳ Waiting for response (timeout: {timeout}s)...")

    while time.time() - start_time < timeout:
        # Check for response files
        for response_file in RESPONSES_DIR.glob("*.json"):
            try:
                with open(response_file, 'r', encoding='utf-8') as f:
                    response = json.load(f)

                if response.get("metadata", {}).get("replyTo") == message_id:
                    content = response.get("content", "")
                    print(f"\n✅ Received response from Cline:")
                    print(f"   {content}")

                    # Clean up response file
                    response_file.unlink()
                    return content
            except (json.JSONDecodeError, IOError):
                continue

        time.sleep(0.5)

    print(f"\n⏱️  No response received within {timeout}s")
    return None


def main():
    if len(sys.argv) < 2:
        print("Usage: python message_sender.py <message> [--wait]")
        print("       python message_sender.py 'Hello Cline!'")
        print("       python message_sender.py 'What files are in this project?' --wait")
        sys.exit(1)

    content = " ".join(arg for arg in sys.argv[1:] if not arg.startswith("--"))
    wait = "--wait" in sys.argv or "-w" in sys.argv

    message_id = send_message(content)

    if wait:
        wait_for_response(message_id, timeout=30)


if __name__ == "__main__":
    main()
