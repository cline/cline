#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Interactive CLI for communicating with Cline
Sends commands and monitors for completion responses
"""

import json
import os
import time
import sys
from pathlib import Path
from datetime import datetime, timezone

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

QUEUE_DIR = Path(".message-queue")
INBOX_DIR = QUEUE_DIR / "inbox"
RESPONSES_DIR = QUEUE_DIR / "responses"

def send_command(command_text):
    """Send a command to Cline and return the message ID"""
    import uuid

    message_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

    message = {
        "id": message_id,
        "from": "claude-code-cli",
        "to": "cline",
        "timestamp": timestamp,
        "type": "command",
        "content": command_text,
        "metadata": {}
    }

    filename = f"{int(time.time() * 1000000)}_{message_id[:8]}.json"
    filepath = INBOX_DIR / filename

    with open(filepath, 'w') as f:
        json.dump(message, f, indent=2)

    print(f"✅ Command sent: {command_text}")
    print(f"   Message ID: {message_id}")
    return message_id

def wait_for_response(message_id, timeout=60):
    """Wait for a response with the given replyTo ID"""
    print(f"⏳ Waiting for response (timeout: {timeout}s)...")

    start_time = time.time()
    last_check_time = 0

    while time.time() - start_time < timeout:
        # Check for new response files
        if RESPONSES_DIR.exists():
            for response_file in RESPONSES_DIR.glob("*.json"):
                # Skip if we've already checked files older than this
                file_time = response_file.stat().st_mtime
                if file_time <= last_check_time:
                    continue

                try:
                    with open(response_file, 'r') as f:
                        response = json.load(f)

                    # Check if this response is for our command
                    if response.get("metadata", {}).get("replyTo") == message_id:
                        content = response.get("content", "")

                        # Check if it's a completion notification
                        if content.startswith("Task completed:"):
                            print(f"\n✅ Task completed!")
                            print(f"   {content}")
                            return True
                        elif content.startswith("Task started:"):
                            print(f"   Task started acknowledgment received")

                except (json.JSONDecodeError, IOError):
                    pass

            last_check_time = time.time()

        time.sleep(0.5)

    print(f"⏱️  Timeout waiting for response")
    return False

def interactive_mode():
    """Run interactive command loop"""
    print("=" * 60)
    print("Interactive Cline CLI")
    print("=" * 60)
    print("Type commands to send to Cline, or 'quit' to exit")
    print("")

    while True:
        try:
            command = input("Command> ").strip()

            if not command:
                continue

            if command.lower() in ['quit', 'exit', 'q']:
                print("Goodbye!")
                break

            # Send command
            msg_id = send_command(command)

            # Wait for completion
            wait_for_response(msg_id, timeout=60)
            print("")

        except KeyboardInterrupt:
            print("\n\nInterrupted. Goodbye!")
            break
        except Exception as e:
            print(f"❌ Error: {e}")

def main():
    if len(sys.argv) > 1:
        # Single command mode
        command = " ".join(sys.argv[1:])
        msg_id = send_command(command)
        wait_for_response(msg_id, timeout=60)
    else:
        # Interactive mode
        interactive_mode()

if __name__ == "__main__":
    main()
