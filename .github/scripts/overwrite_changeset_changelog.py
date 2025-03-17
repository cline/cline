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
NEW_CONTENT = os.environ.get("NEW_CONTENT", "")

# Find the section for the specified version
version_index = -1
version_pattern = f"## {VERSION}\n"
bracketed_version_pattern = f"## [{VERSION}]\n"
header_end_index = 0
print(f"latest version: {VERSION}")


def fetch_changelog_header(changelog_text: str):
    global version_pattern, version_index, bracketed_version_pattern, header_end_index
    header = ""
    print(f"Starting fetch_changelog_header")
    # Try both unbracketed and bracketed version patterns
    version_index = changelog_text.find(version_pattern)
    if version_index == -1:
        print("Version not found, trying bracketed version pattern")
        version_index = changelog_text.find(bracketed_version_pattern)
        if version_index == -1:
            print("Bracketed version not found, adding new version header")
            # If version not found, add it at the top (after the first line)
            first_newline = changelog_text.find('\n')
            print(f"First newline index: {first_newline}")
            if first_newline == -1:
                print("No newline found, prepending new version header")
                # If no newline found, just prepend
                header = f"## [{VERSION}]\n\n"
            header = f"{changelog_text[:first_newline + 1]}\n## [{VERSION}]\n\n"
        else:
            # Using bracketed version
            version_pattern = bracketed_version_pattern
            header = changelog_text[:version_index]
    else:
        header = changelog_text[:version_index]
    
    header_end_index = len(header)
    return header


def generate_changelog_section(changelog_text: str, new_content: str):

    global version_pattern, version_index, header_end_index
    print(f"Starting generate_changelog_section")
    print(f"Version index: {version_index}")
    print(f"Version pattern: {version_pattern} {len(version_pattern)}")
    print(f"Header end index: {header_end_index}")

    prev_version_pattern = "## ["
    prev_version_index = changelog_text[header_end_index:].find(prev_version_pattern)
    print(f"Previous version index: {prev_version_index}")

    if new_content:
        print("Detected new content, overwriting existing changeset")
        return f"{new_content}\n" + changelog_text[prev_version_index:]
    else:
        print("No new content provided, reformatting existing changeset")
        changeset_lines = changelog_text[header_end_index:prev_version_index].split("\n")
        print(f"Changeset lines: {changeset_lines}")
        # Ensure we have at least 2 lines before removing them
        if len(changeset_lines) < 2:
            print("Warning: Changeset content has fewer than 2 lines")
            parsed_lines = "\n".join(changeset_lines)
        else:
            # Remove the first two lines from the regular changeset format, ex: \n### Patch Changes
            parsed_lines = "\n".join(changeset_lines[2:])
        
        # Reconstruct the changelog with the new content
        updated_changelog = parsed_lines + changelog_text[prev_version_index:]
        # Ensure version number is bracketed
        updated_changelog = updated_changelog.replace(f"## {VERSION}", f"## [{VERSION}]")
        return updated_changelog


def overwrite_changelog_section(changelog_text: str, new_content: str):
    print(f"Starting overwrite_changelog_section")
    header = fetch_changelog_header(changelog_text)
    body = generate_changelog_section(changelog_text, new_content)
    print(f"Header: {header}")
    return header + body


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
    # print(new_changelog)
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
