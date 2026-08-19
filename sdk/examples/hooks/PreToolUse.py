#!/usr/bin/env python3
"""
Cline Hook: PreToolUse (Python)
Logs every tool call before it executes.
Copy to ~/.cline/hooks/PreToolUse.py and chmod +x
"""

import sys
import json

def main():
    # Read event payload from stdin
    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"errorMessage": f"Failed to parse hook input: {e}"}))
        return

    # Extract tool information
    tool_call = event.get("tool_call", {})
    tool_name = tool_call.get("name", "unknown")
    parameters = event.get("preToolUse", {}).get("parameters", {})

    # Log to stderr
    print(f"🔧 Tool: {tool_name}", file=sys.stderr)
    if parameters:
        param_str = ", ".join(f"{k}={v}" for k, v in parameters.items())
        print(f"   Args: {param_str}", file=sys.stderr)

    # Return empty control object (allow the tool to execute)
    print(json.dumps({}))

if __name__ == "__main__":
    main()
