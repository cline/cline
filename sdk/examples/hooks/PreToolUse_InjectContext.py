#!/usr/bin/env python3
"""
Cline Hook: PreToolUse (Inject Context)
Injects file context and environment info before tool execution.
Copy to ~/.cline/hooks/PreToolUse.py and chmod +x
"""

import sys
import json
import os
import subprocess
from pathlib import Path

def get_git_branch() -> str | None:
    """Get current git branch."""
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True,
            text=True,
            timeout=2
        )
        branch = result.stdout.strip()
        return branch if branch else None
    except Exception:
        return None

def get_node_version() -> str | None:
    """Get Node.js version."""
    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True,
            text=True,
            timeout=2
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None

def get_file_context(file_path: str) -> str | None:
    """Get context about related files."""
    path = Path(file_path)

    # For TypeScript files, check for test files
    if path.suffix in [".ts", ".tsx"]:
        test_file = path.with_stem(path.stem).with_suffix(".test.ts")
        if test_file.exists():
            return f"Associated test file exists: {test_file}"

    # For package.json, mention lock files
    if path.name == "package.json":
        lock_files = []
        for lock in ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]:
            if (path.parent / lock).exists():
                lock_files.append(lock)

        if lock_files:
            return f"Related lock files: {', '.join(lock_files)}"

    # For config files, mention related configs
    if path.name.endswith(".config.ts") or path.name.endswith(".config.js"):
        basename = path.stem.replace(".config", "")
        parent = path.parent
        related = []
        for ext in [".ts", ".js", ".json"]:
            env_file = parent / f"{basename}.env{ext}"
            if env_file.exists():
                related.append(f"{env_file.name}")
        if related:
            return f"Related config files: {', '.join(related)}"

    return None

def main():
    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"errorMessage": f"Failed to parse: {e}"}))
        return

    tool_call = event.get("tool_call", {})
    tool_name = tool_call.get("name", "")
    tool_input = tool_call.get("input", {})

    # Inject file context when reading files
    if tool_name == "read_files":
        file_path = tool_input.get("filePath", "")
        if file_path:
            context = get_file_context(file_path)
            if context:
                print(json.dumps({"context": context}))
                return

    # Inject environment context for run_commands
    if tool_name == "run_commands":
        context_parts = []

        node_version = get_node_version()
        if node_version:
            context_parts.append(f"node {node_version}")

        git_branch = get_git_branch()
        if git_branch:
            context_parts.append(f"git branch: {git_branch}")

        if context_parts:
            context = "Environment: " + ", ".join(context_parts)
            print(json.dumps({"context": context}))
            return

    # Allow other tools without modification
    print(json.dumps({}))

if __name__ == "__main__":
    main()
