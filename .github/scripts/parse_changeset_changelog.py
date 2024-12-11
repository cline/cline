"""
This script extracts the release notes section for a specific version from CHANGELOG.md.

The script:
1. Takes a version number and changelog path as input from environment variables
2. Finds the section in the changelog for the specified version
3. Extracts the content between the current version header and the next version header
   (or end of file if it's the latest version)
4. Outputs the extracted release notes to GITHUB_OUTPUT for use in creating GitHub releases

Environment Variables:
    GITHUB_OUTPUT: Path to GitHub Actions output file
    CHANGELOG_PATH: Path to the changelog file (defaults to 'CHANGELOG.md')
    VERSION: The version number to extract notes for
"""

#!/usr/bin/env python3

import sys
import os
import subprocess

GITHUB_OUTPUT = os.getenv("GITHUB_OUTPUT")
CHANGELOG_PATH = os.environ.get("CHANGELOG_PATH", "CHANGELOG.md")
VERSION = os.environ['VERSION']

def parse_changelog_section(content: str):
    """Parse a specific version section from the changelog content.
    
    Args:
        content: The full changelog content as a string
        
    Returns:
        The formatted content for this version, or None if version not found
        
    Example:
        >>> content = "## 1.2.0\\nChanges\\n## 1.1.0\\nOld changes"
        >>> parse_changelog_section(content)
        'Changes\\n'
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

# Write the extracted release notes to GITHUB_OUTPUT
with open(GITHUB_OUTPUT, "a") as gha_output:
    gha_output.write(f"release-notes<<EOF\n{formatted_content}\nEOF")
