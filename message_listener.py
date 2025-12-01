#!/usr/bin/env python3
"""
Claude Code Message Listener

Listens for messages from Cline via the file-based message queue.
"""

import json
import sys
import os
import time
from datetime import datetime, timezone
from pathlib import Path

# Fix Windows console encoding
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Message queue paths
SCRIPT_DIR = Path(__file__).parent
QUEUE_DIR = SCRIPT_DIR / ".message-queue"
OUTBOX_DIR = QUEUE_DIR / "outbox"

def ensure_directories():
    """Ensure message queue directories exist."""
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)

def process_message(filepath):
    """Process a message from Cline."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            message = json.load(f)
        
        print(f"\n📨 Message from Cline:")
        print(f"   ID: {message['id']}")
        print(f"   Type: {message['type']}")
        print(f"   Content: {message['content']}")
        print(f"   Timestamp: {message['timestamp']}")
        
        # Delete processed message
        filepath.unlink()
        
    except Exception as e:
        print(f"❌ Error processing {filepath.name}: {e}")

def watch_outbox():
    """Watch the outbox directory for messages from Cline."""
    ensure_directories()
    
    print("👂 Listening for messages from Cline...")
    print(f"   Watching: {OUTBOX_DIR}")
    print("   Press Ctrl+C to stop\n")
    
    # Track processed files
    seen_files = set()
    
    try:
        while True:
            # Check for new messages
            message_files = list(OUTBOX_DIR.glob("*.json"))
            
            for filepath in message_files:
                if filepath.name not in seen_files:
                    seen_files.add(filepath.name)
                    process_message(filepath)
            
            # Clean up old tracked files
            if len(seen_files) > 100:
                current_files = {f.name for f in message_files}
                seen_files &= current_files
            
            time.sleep(0.5)  # Check every 500ms
            
    except KeyboardInterrupt:
        print("\n\n👋 Stopped listening")

if __name__ == "__main__":
    watch_outbox()
