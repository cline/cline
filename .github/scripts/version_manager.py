#!/usr/bin/env python3

"""
Version Manager Script

This script analyzes changesets since the last release to determine the appropriate version bump.
It follows semantic versioning rules and determines the minimum version bump needed based on
all accumulated changes.

Process:
1. Find the last release tag
2. Collect all changesets since that tag
3. Determine minimum version bump needed (major, minor, or patch)
4. Compare with pre-release version if in release mode

Environment Variables:
    GITHUB_OUTPUT: Path to GitHub output file
    RELEASE_TYPE: Either 'release' or 'pre-release'
"""

import os
import sys
import json
import subprocess
from typing import List, Tuple, Literal

import argparse

ChangeType = Literal["major", "minor", "patch"]

def parse_args():
    parser = argparse.ArgumentParser(description="Determine version bump from changesets")
    parser.add_argument(
        "--release-type",
        choices=["release", "pre-release"],
        default="release",
        help="Type of release to create"
    )
    parser.add_argument(
        "--github-output",
        help="Path to GitHub Actions output file"
    )
    return parser.parse_args()

def get_last_release_tag(include_pre: bool = False) -> tuple[str, bool]:
    """
    Get the most recent release tag.
    
    Args:
        include_pre: Whether to consider pre-release tags
        
    Returns:
        Tuple of (tag, is_prerelease)
    """
    try:
        # Get all tags sorted by version
        output = subprocess.check_output(
            ["git", "tag", "--sort=-v:refname"]
        ).decode().strip()
        
        tags = output.split("\n") if output else []
        if not tags:
            return "v0.0.0", False
        
        # First try to find a pre-release tag if we're looking for one
        if include_pre:
            pre_tags = [tag for tag in tags if tag.endswith("-pre")]
            if pre_tags:
                return pre_tags[0], True
        
        # Then look for regular release tags
        release_tags = [tag for tag in tags if not tag.endswith("-pre")]
        if release_tags:
            return release_tags[0], False
        
        return "v0.0.0", False
    
    except subprocess.CalledProcessError:
        print("Error: Failed to get git tags")
        return "v0.0.0", False

def get_changesets_since_tag(tag: str) -> List[dict]:
    """Get all changeset files added since the specified tag."""
    try:
        # Get list of changeset files
        changeset_files = subprocess.check_output(
            ["git", "diff", "--name-only", f"{tag}...HEAD", ".changeset"]
        ).decode().strip().split("\n")
        
        changesets = []
        for file_path in changeset_files:
            if file_path.endswith(".md") and not file_path.endswith("README.md"):
                try:
                    with open(file_path, 'r') as f:
                        content = f.read()
                        # Parse changeset format
                        # First line is ---, second line has type, rest is content
                        lines = content.split("\n")
                        if len(lines) >= 3:
                            change_type = lines[1].strip().lower()
                            if any(t in change_type for t in ["major", "minor", "patch"]):
                                changesets.append({
                                    "file": file_path,
                                    "type": change_type,
                                    "content": "\n".join(lines[2:]).strip()
                                })
                except Exception as e:
                    print(f"Error reading changeset {file_path}: {str(e)}")
                    continue
        
        return changesets
    except subprocess.CalledProcessError:
        print("Error: Failed to get changeset files")
        return []

def determine_version_bump(changesets: List[dict]) -> Tuple[ChangeType, int]:
    """
    Determine the minimum version bump needed based on all changesets.
    Returns the bump type and count of changes.
    """
    has_major = any("major" in c["type"].lower() for c in changesets)
    has_minor = any("minor" in c["type"].lower() for c in changesets)
    has_patch = any("patch" in c["type"].lower() for c in changesets)
    
    if has_major:
        return "major", len(changesets)
    elif has_minor:
        return "minor", len(changesets)
    elif has_patch:
        return "patch", len(changesets)
    else:
        return "patch", 0

def bump_version(current: str, bump_type: ChangeType) -> str:
    """
    Bump the version number according to semver rules.
    Example: 3.2.1 with minor bump becomes 3.3.0
    """
    # Strip v prefix if present
    version = current[1:] if current.startswith("v") else current
    
    major, minor, patch = map(int, version.split("."))
    
    if bump_type == "major":
        return f"v{major + 1}.0.0"
    elif bump_type == "minor":
        return f"v{major}.{minor + 1}.0"
    else:  # patch
        return f"v{major}.{minor}.{patch + 1}"

def main():
    args = parse_args()
    
    # For releases, first check if there's a recent pre-release
    if args.release_type == "release":
        last_tag, is_pre = get_last_release_tag(include_pre=True)
        if is_pre:
            # If the most recent tag is a pre-release, check for changes since then
            changesets = get_changesets_since_tag(last_tag)
            if not changesets:
                # No changes since pre-release, use it as the release
                new_version = last_tag.replace("-pre", "")
                print(f"No changes since pre-release {last_tag}, using {new_version}")
                if args.github_output:
                    with open(args.github_output, "a") as f:
                        f.write(f"new_version={new_version}\n")
                        f.write("has_changes=false\n")
                        f.write("change_count=0\n")
                        f.write("changesets<<EOF\n[]\nEOF\n")
                return
    
    # Get last regular release tag
    last_tag, _ = get_last_release_tag(include_pre=False)
    print(f"Last release tag: {last_tag}")
    
    # Get changesets since last release
    changesets = get_changesets_since_tag(last_tag)
    print(f"Found {len(changesets)} changesets")
    
    # Determine version bump
    bump_type, change_count = determine_version_bump(changesets)
    print(f"Determined version bump: {bump_type}")
    
    # Calculate new version
    new_version = bump_version(last_tag, bump_type)
    print(f"New version: {new_version}")
    
    # Add pre-release suffix if needed
    if args.release_type == "pre-release":
        new_version = f"{new_version}-pre"
    
    # Write outputs for GitHub Actions
    if args.github_output:
        with open(args.github_output, "a") as f:
            f.write(f"new_version={new_version}\n")
            f.write(f"has_changes={'true' if change_count > 0 else 'false'}\n")
            f.write(f"change_count={change_count}\n")
            # Write changesets as JSON for use in release notes
            changesets_json = json.dumps([{
                "type": c["type"],
                "content": c["content"]
            } for c in changesets])
            f.write(f"changesets<<EOF\n{changesets_json}\nEOF\n")

if __name__ == "__main__":
    main()
