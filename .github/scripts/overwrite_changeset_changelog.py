"""
This script updates a specific version's release notes section in CHANGELOG.md with new content
or reformats existing content.

The script:
1. Takes a version number, changelog path, and optionally new content as input from environment variables
2. Finds the section in the changelog for the specified version
3. Either:
   a) Replaces the content with new content if provided, or
   b) Reformats existing content by:
      - Removing the first two lines of the changeset format
      - Ensuring version numbers are wrapped in square brackets
4. Writes the updated changelog back to the file

Environment Variables:
    CHANGELOG_PATH: Path to the changelog file (defaults to 'CHANGELOG.md')
    VERSION: The version number to update/format
    PREV_VERSION: The previous version number (used to locate section boundaries)
    NEW_CONTENT: Optional new content to insert for this version
"""

#!/usr/bin/env python3

import os

CHANGELOG_PATH = os.environ.get("CHANGELOG_PATH", "CHANGELOG.md")
VERSION = os.environ['VERSION']
PREV_VERSION = os.environ.get("PREV_VERSION", "")
NEW_CONTENT = os.environ.get("NEW_CONTENT", "")

def overwrite_changelog_section(changelog_text: str, new_content: str):
    # Find the section for the specified version
    version_pattern = f"## {VERSION}\n"
    unformmatted_prev_version_pattern = f"## {PREV_VERSION}\n"
    prev_version_pattern = f"## [{PREV_VERSION}]\n"
    print(f"latest version: {VERSION}")
    print(f"prev_version: {PREV_VERSION}")

    notes_start_index = changelog_text.find(version_pattern) + len(version_pattern)
    notes_end_index = changelog_text.find(prev_version_pattern, notes_start_index) if PREV_VERSION and (prev_version_pattern in changelog_text or unformmatted_prev_version_pattern in changelog_text) else len(changelog_text)

    if new_content:
        return changelog_text[:notes_start_index] + f"{new_content}\n" + changelog_text[notes_end_index:]
    else:
        changeset_lines = changelog_text[notes_start_index:notes_end_index].split("\n")
        filtered_lines = []
        for line in changeset_lines:
            # If the previous line is a changeset format
            if len(filtered_lines) > 1 and filtered_lines[-1].startswith("### "):
                # Remove the last two lines from the filted_lines
                filtered_lines.pop()
                filtered_lines.pop()
            else:
                filtered_lines.append(line.strip())

        # Prepend a new line to the first line of filtered_lines
        if filtered_lines:
            filtered_lines[0] = "\n" + filtered_lines[0]

        # Print filted_lines wiht a "\n" at the end of each line
        for line in filtered_lines:
            print(line.strip())

        parsed_lines = "\n".join(line for line in filtered_lines)
        updated_changelog = changelog_text[:notes_start_index] + parsed_lines + changelog_text[notes_end_index:]
        return updated_changelog

with open(CHANGELOG_PATH, 'r') as f:
    changelog_content = f.read()

new_changelog = overwrite_changelog_section(changelog_content, NEW_CONTENT)
# print("----------------------------------------------------------------------------------")
# print(new_changelog)
# print("----------------------------------------------------------------------------------")
# Write back to CHANGELOG.md
with open(CHANGELOG_PATH, 'w') as f:
    f.write(new_changelog)

print(f"{CHANGELOG_PATH} updated successfully!")
