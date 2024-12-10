#!/usr/bin/env python3

import sys
import os
import subprocess

GITHUB_OUTPUT = os.getenv("GITHUB_OUTPUT")
CHANGELOG_PATH = os.environ.get("CHANGELOG_PATH", "CHANGELOG.md")
VERSION = os.environ['VERSION']

def parse_changelog_section(content: str):
    """Parse a specific version section from the changelog content.
        
    Returns: The formatted content for this version, or None if version not found
    """
    # Find the section for the specified version
    version_pattern = f"## {VERSION}\n"
    print(f"latest version: {VERSION}")
    notes_start_index = content.find(version_pattern) + len(version_pattern)
    prev_version = subprocess.getoutput("git show origin/main:package.json | grep '\"version\":' | cut -d'\"' -f4")
    print(f"prev_version: {prev_version}")
    prev_version_pattern = f"## {prev_version}\n"
    notes_end_index = content.find(prev_version_pattern, notes_start_index) if prev_version_pattern in content else len(content)

    return content[notes_start_index:notes_end_index]

with open(CHANGELOG_PATH, 'r') as f:
    content = f.read()

formatted_content = parse_changelog_section(content)
if not formatted_content:
    print(f"Version {VERSION} not found in changelog", file=sys.stderr)
    sys.exit(1)

print(formatted_content)

with open(GITHUB_OUTPUT, "a") as gha_output:
    gha_output.write(f"release-notes<<EOF\n{formatted_content}\nEOF")