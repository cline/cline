"""
This script updates CHANGELOG.md with new release notes.

The script:
1. Takes version number, release notes content, and changelog path as input
2. Inserts the new release section at the top of the changelog (after the title)
3. Ensures proper formatting and spacing

Command line arguments:
    --version: Version number being released
    --content: Release notes content to insert
    --changelog-path: Path to changelog file (defaults to CHANGELOG.md)
"""

#!/usr/bin/env python3

import os
import sys
import argparse

def parse_args():
    parser = argparse.ArgumentParser(description="Update CHANGELOG.md with new release notes")
    parser.add_argument(
        "--version",
        required=True,
        help="Version number being released"
    )
    parser.add_argument(
        "--content",
        required=True,
        help="Release notes content to insert"
    )
    parser.add_argument(
        "--changelog-path",
        default="CHANGELOG.md",
        help="Path to changelog file"
    )
    return parser.parse_args()

def update_changelog(version: str, content: str, changelog_path: str):
    """Update changelog with new release notes at the top."""
    try:
        try:
            with open(changelog_path, 'r') as f:
                changelog_content = f.read()
        except FileNotFoundError:
            changelog_content = "# Changelog\n"
        
        # Ensure changelog has title
        if not changelog_content.startswith("# Changelog"):
            changelog_content = f"# Changelog\n\n{changelog_content}"
        
        # Find the first line break after the title
        first_newline = changelog_content.find('\n')
        if first_newline == -1:
            # If no newline found, just append
            new_changelog = f"{changelog_content}\n\n## [{version}]\n\n{content}\n"
        else:
            # Insert after the title
            new_changelog = (
                f"{changelog_content[:first_newline + 1]}"
                f"\n## [{version}]\n\n{content}\n\n"
                f"{changelog_content[first_newline + 1:]}"
            )
        
        # Ensure parent directory exists
        os.makedirs(os.path.dirname(changelog_path), exist_ok=True)
        
        with open(changelog_path, 'w') as f:
            f.write(new_changelog)
            
        print(f"Successfully updated {changelog_path}")
        
    except Exception as e:
        print(f"Error updating changelog: {str(e)}")
        raise  # Re-raise for tests instead of sys.exit(1)

def main():
    args = parse_args()
    update_changelog(args.version, args.content, args.changelog_path)

if __name__ == "__main__":
    main()
