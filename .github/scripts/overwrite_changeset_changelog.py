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
import sys

CHANGELOG_PATH = os.environ.get("CHANGELOG_PATH", "CHANGELOG.md")
VERSION = os.environ['VERSION']
PREV_VERSION = os.environ.get("PREV_VERSION", "")
NEW_CONTENT = os.environ.get("NEW_CONTENT", "")

def overwrite_changelog_section(changelog_text: str, new_content: str):
    # Find the section for the specified version
    version_pattern = f"## {VERSION}\n"
    bracketed_version_pattern = f"## [{VERSION}]\n"
    prev_version_pattern = f"## [{PREV_VERSION}]\n"
    print(f"latest version: {VERSION}")
    print(f"prev_version: {PREV_VERSION}")

    # Try both unbracketed and bracketed version patterns
    version_index = changelog_text.find(version_pattern)
    if version_index == -1:
        version_index = changelog_text.find(bracketed_version_pattern)
        if version_index == -1:
            # If version not found, add it at the top (after the first line)
            first_newline = changelog_text.find('\n')
            if first_newline == -1:
                # If no newline found, just prepend
                return f"## [{VERSION}]\n\n{changelog_text}"
            return f"{changelog_text[:first_newline + 1]}## [{VERSION}]\n\n{changelog_text[first_newline + 1:]}"
        else:
            # Using bracketed version
            version_pattern = bracketed_version_pattern

    notes_start_index = version_index + len(version_pattern)
    notes_end_index = changelog_text.find(prev_version_pattern, notes_start_index) if PREV_VERSION and prev_version_pattern in changelog_text else len(changelog_text)

    if new_content:
        return changelog_text[:notes_start_index] + f"{new_content}\n" + changelog_text[notes_end_index:]
    else:
        changeset_lines = changelog_text[notes_start_index:notes_end_index].split("\n")
        # Ensure we have at least 2 lines before removing them
        if len(changeset_lines) < 2:
            print("Warning: Changeset content has fewer than 2 lines")
            parsed_lines = "\n".join(changeset_lines)
        else:
            # Remove the first two lines from the regular changeset format, ex: \n### Patch Changes
            parsed_lines = "\n".join(changeset_lines[2:])
        updated_changelog = changelog_text[:notes_start_index] + parsed_lines + changelog_text[notes_end_index:]
        # Ensure version number is bracketed
        updated_changelog = updated_changelog.replace(f"## {VERSION}", f"## [{VERSION}]")
        return updated_changelog

try:
    print(f"Reading changelog from: {CHANGELOG_PATH}")
    with open(CHANGELOG_PATH, 'r') as f:
        changelog_content = f.read()

    print(f"Changelog content length: {len(changelog_content)} characters")
    print("First 200 characters of changelog:")
    print(changelog_content[:200])
    print("----------------------------------------------------------------------------------")

    new_changelog = overwrite_changelog_section(changelog_content, NEW_CONTENT)
    
    print("New changelog content:")
    print("----------------------------------------------------------------------------------")
    print(new_changelog)
    print("----------------------------------------------------------------------------------")
    
    print(f"Writing updated changelog back to: {CHANGELOG_PATH}")
    with open(CHANGELOG_PATH, 'w') as f:
        f.write(new_changelog)

    print(f"{CHANGELOG_PATH} updated successfully!")

except FileNotFoundError:
    print(f"Error: Changelog file not found at {CHANGELOG_PATH}")
    sys.exit(1)
except Exception as e:
    print(f"Error updating changelog: {str(e)}")
    print(f"Current working directory: {os.getcwd()}")
    sys.exit(1)
