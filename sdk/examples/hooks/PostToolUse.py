#!/usr/bin/env python3
"""
Cline Hook: PostToolUse (Python)
Logs tool results after execution and enriches with environment context.
Copy to ~/.cline/hooks/PostToolUse.py and chmod +x
"""

import sys
import json
import os
import subprocess

def get_git_branch():
    """Get current git branch if in a repo."""
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True,
            text=True,
            timeout=2
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None

def main():
    # Read event payload from stdin
    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"errorMessage": f"Failed to parse hook input: {e}"}))
        return

    # Extract tool result information
    tool_result = event.get("tool_result", {})
    post_tool_use = event.get("postToolUse", {})
    tool_name = tool_result.get("name", "unknown")
    success = post_tool_use.get("success", False)
    duration_ms = post_tool_use.get("executionTimeMs", 0)

    # Log result
    status = "✅" if success else "❌"
    print(f"{status} Tool completed: {tool_name} ({duration_ms}ms)", file=sys.stderr)

    # For run_commands, inject environment context
    if tool_name == "run_commands":
        git_branch = get_git_branch()
        context_parts = []

        if git_branch:
            context_parts.append(f"git branch: {git_branch}")

        if context_parts:
            context = "Environment: " + ", ".join(context_parts)
            print(json.dumps({"context": context}))
            return

    # Return empty control object
    print(json.dumps({}))

if __name__ == "__main__":
    main()
