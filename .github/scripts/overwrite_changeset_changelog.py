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
VERSION = os.environ["VERSION"]
PREV_VERSION = os.environ.get("PREV_VERSION", "")
NEW_CONTENT = os.environ.get("NEW_CONTENT", "")


def overwrite_changelog_section(changelog_text: str, new_content: str):
    # Find the section for the specified version
    version_pattern = f"## {VERSION}\n"
    prev_version_pattern = f"## [{PREV_VERSION}]\n"
    print(f"latest version: {VERSION}")
    print(f"prev_version: {PREV_VERSION}")

    notes_start_index = changelog_text.find(version_pattern) + len(version_pattern)
    notes_end_index = (
        changelog_text.find(prev_version_pattern, notes_start_index)
        if PREV_VERSION and prev_version_pattern in changelog_text
        else len(changelog_text)
    )

    if new_content:
        return (
            changelog_text[:notes_start_index]
            + f"{new_content}\n"
            + changelog_text[notes_end_index:]
        )
    else:
        changeset_lines = changelog_text[notes_start_index:notes_end_index].split("\n")
        # Remove the first two lines from the regular changeset format, ex: \n### Patch Changes
        parsed_lines = "\n".join(changeset_lines[2:])
        updated_changelog = (
            changelog_text[:notes_start_index]
            + parsed_lines
            + changelog_text[notes_end_index:]
        )
        updated_changelog = updated_changelog.replace(
            f"## {VERSION}", f"## [{VERSION}]"
        )
        return updated_changelog


with open(CHANGELOG_PATH, "r") as f:
    changelog_content = f.read()

new_changelog = overwrite_changelog_section(changelog_content, NEW_CONTENT)
print(
    "----------------------------------------------------------------------------------"
)
print(new_changelog)
print(
    "----------------------------------------------------------------------------------"
)
# Write back to CHANGELOG.md
with open(CHANGELOG_PATH, "w") as f:
    f.write(new_changelog)

print(f"{CHANGELOG_PATH} updated successfully!")
