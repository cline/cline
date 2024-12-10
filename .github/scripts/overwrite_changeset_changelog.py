"""
This script updates a specific version's release notes section in CHANGELOG.md with new content.

The script:
1. Takes a version number, changelog path, and new content as input from environment variables
2. Finds the section in the changelog for the specified version
3. Replaces the content between the current version header and the next version header
   (or end of file if it's the latest version) with the new content
4. Writes the updated changelog back to the file

Environment Variables:
    CHANGELOG_PATH: Path to the changelog file (defaults to 'CHANGELOG.md')
    VERSION: The version number to update notes for
    PREV_VERSION: The previous version number (optional)
    NEW_CONTENT: The new content to insert for this version
"""

#!/usr/bin/env python3

import os

CHANGELOG_PATH = os.environ.get("CHANGELOG_PATH", "CHANGELOG.md")
VERSION = os.environ['VERSION']
PREV_VERSION = os.environ.get("PREV_VERSION", "")
NEW_CONTENT = os.environ['NEW_CONTENT']

def overwrite_changelog_section(content: str):    
    """Replace a specific version section in the changelog content.
    
    Args:
        content: The full changelog content as a string
        
    Returns:
        The updated changelog content with the new section
        
    Example:
        >>> content = "## 1.2.0\\nOld changes\\n## 1.1.0\\nOld changes"
        >>> NEW_CONTENT = "New changes"
        >>> overwrite_changelog_section(content)
        '## 1.2.0\\nNew changes\\n## 1.1.0\\nOld changes'
    """
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
