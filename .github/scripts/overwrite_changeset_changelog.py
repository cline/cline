#!/usr/bin/env python3

import os

GITHUB_OUTPUT = os.getenv("GITHUB_OUTPUT")
CHANGELOG_PATH = os.environ.get("CHANGELOG_PATH", "CHANGELOG.md")
VERSION = os.environ['VERSION']
PREV_VERSION = os.environ.get("PREV_VERSION", "")
NEW_CONTENT = os.environ['NEW_CONTENT']

def overwrite_changelog_section(content: str):    
    # Find the section for the specified version
    version_pattern = f"## {VERSION}\n"
    print(f"latest version: {VERSION}")
    notes_start_index = content.find(version_pattern) + len(version_pattern)
    print(f"prev_version: {PREV_VERSION}")
    prev_version_pattern = f"## {PREV_VERSION}\n"
    notes_end_index = content.find(prev_version_pattern, notes_start_index) if PREV_VERSION and prev_version_pattern in content else len(content)
    return content[:notes_start_index] + f"{NEW_CONTENT}\n" + content[notes_end_index:]

with open(CHANGELOG_PATH, 'r') as f:
    content = f.read()

new_changelog = overwrite_changelog_section(content)

print(new_changelog)

# Write back to CHANGELOG.md
with open(CHANGELOG_PATH, 'w') as f:
    f.write(new_changelog)
