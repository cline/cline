#!/usr/bin/env python3

"""
Release Notes Generator

This script generates release notes using OpenRouter's API with the Claude 3.5 Sonnet model.
It takes the changesets and git information as input and produces formatted release notes
suitable for both GitHub releases and VSCode marketplace.

Process:
1. Read changesets from input
2. Get git diff and commit information
3. Generate release notes using OpenRouter API
4. Format and output the notes

Command line arguments:
    --github-output: Path to GitHub Actions output file
    --changesets: JSON string of changesets
    --version: Version being released
    --release-type: Either 'release' or 'pre-release'
    --api-key: OpenRouter API key for generating release notes
"""

import os
import sys
import json
import argparse
import subprocess
from typing import List, Dict, Optional
import requests

def parse_args():
    parser = argparse.ArgumentParser(description="Generate release notes using OpenRouter API")
    parser.add_argument(
        "--github-output",
        help="Path to GitHub Actions output file"
    )
    parser.add_argument(
        "--changesets",
        help="JSON string of changesets",
        required=True
    )
    parser.add_argument(
        "--version",
        help="Version being released",
        required=True
    )
    parser.add_argument(
        "--release-type",
        choices=["release", "pre-release"],
        default="release",
        help="Type of release"
    )
    parser.add_argument(
        "--api-key",
        help="OpenRouter API key",
        required=True
    )
    return parser.parse_args()

def get_git_info(version: str) -> Dict[str, str]:
    """Get git diff and commit information since the last release."""
    try:
        # Always get changes since last regular release, ignoring pre-releases
        tags = subprocess.check_output(
            ["git", "tag", "--sort=-v:refname"],
            text=True
        ).strip().split("\n")
        
        # Filter out pre-releases to get the last regular release
        regular_releases = [tag for tag in tags if not tag.endswith("-pre")]
        last_tag = regular_releases[0] if regular_releases else "v0.0.0"
        print(f"Generating release notes with changes since {last_tag}")
        
        # Get commit messages
        commit_log = subprocess.check_output(
            ["git", "log", f"{last_tag}...HEAD", "--pretty=format:%s"],
            text=True
        ).strip()
        
        # Get diff stats
        diff_stats = subprocess.check_output(
            ["git", "diff", "--stat", f"{last_tag}...HEAD"],
            text=True
        ).strip()
        
        return {
            "commit_log": commit_log,
            "diff_stats": diff_stats,
            "last_tag": last_tag
        }
    except subprocess.CalledProcessError as e:
        print(f"Error getting git info: {str(e)}")
        return {
            "commit_log": "",
            "diff_stats": "",
            "last_tag": "v0.0.0"
        }

def generate_prompt(changesets: List[Dict], git_info: Dict[str, str], version: str, is_prerelease: bool) -> str:
    """Generate the prompt for the OpenRouter API."""
    changes_by_type = {
        "major": [],
        "minor": [],
        "patch": []
    }
    
    for change in changesets:
        change_type = change["type"].lower()
        if "major" in change_type:
            changes_by_type["major"].append(change["content"])
        elif "minor" in change_type:
            changes_by_type["minor"].append(change["content"])
        elif "patch" in change_type:
            changes_by_type["patch"].append(change["content"])
    
    changes_text = "\n\n".join([
        f"Major Changes:\n{chr(10).join(changes_by_type['major'])}" if changes_by_type["major"] else "",
        f"Minor Changes:\n{chr(10).join(changes_by_type['minor'])}" if changes_by_type["minor"] else "",
        f"Patch Changes:\n{chr(10).join(changes_by_type['patch'])}" if changes_by_type["patch"] else ""
    ]).strip()
    
    return f"""Please generate release notes for version {version} of the Cline VSCode extension.

{'''IMPORTANT: This is a pre-release version. The release notes MUST include "(Pre-release)" in the title.
Example title: "## New Features Added (Pre-release)"''' if is_prerelease else ''}

Changesets:
{changes_text}

Git Information:
Commit Messages:
{git_info['commit_log']}

Changes Overview:
{git_info['diff_stats']}

Please format the release notes in markdown with:
1. A short, descriptive title (max 8 words) with heading level 2
2. A brief summary paragraph explaining the key changes and their impact
3. Optional sections (include only if relevant):
   - 🚀 New Features & Improvements (heading level 3)
   - 🐛 Bugs Fixed (heading level 3)
   - 🔧 Other Updates (heading level 3)

Focus on user-facing changes and their benefits. Ignore version bumps, dependency updates, and minor syntax changes.
Be concise but informative, highlighting the most important changes first."""

def generate_release_notes(prompt: str, api_key: str = None) -> str:
    """Generate release notes using OpenRouter API with Claude 3.5 Sonnet.
    
    Args:
        prompt: The prompt to send to the API
        api_key: OpenRouter API key.
    """
    if not api_key:
        raise Exception("API key not provided and OPENROUTER_API_KEY environment variable not set")
        
    headers = {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": "https://github.com/cline/cline",
        "Content-Type": "application/json"
    }
    
    data = {
        "model": "anthropic/claude-3.5-sonnet",
        "messages": [{
            "role": "user",
            "content": prompt
        }],
        "temperature": 0.7
    }
    
    try:
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=data
        )
        
        if response.status_code == 429:
            raise Exception("Rate limit exceeded")
        elif response.status_code == 401:
            raise Exception("Invalid API key")
            
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]
        
    except requests.exceptions.RequestException as e:
        error_msg = f"Error calling OpenRouter API: {str(e)}"
        if hasattr(e, 'response'):
            error_msg += f"\nResponse: {e.response.text}"
        raise Exception(error_msg)

def main():
    args = parse_args()
    
    # Parse changesets
    try:
        changesets = json.loads(args.changesets)
    except json.JSONDecodeError:
        print("Error: Invalid changesets JSON")
        sys.exit(1)
    
    # Get git information
    git_info = get_git_info(args.version)
    
    # Generate prompt
    prompt = generate_prompt(
        changesets,
        git_info,
        args.version,
        args.release_type == "pre-release"
    )
    
    # Generate release notes
    try:
        release_notes = generate_release_notes(prompt, api_key=args.api_key)
        print("Generated Release Notes:")
        print("-" * 80)
        print(release_notes)
        print("-" * 80)
        
        # Write outputs for GitHub Actions
        if args.github_output:
            with open(args.github_output, "a") as f:
                f.write(f"release_notes<<EOF\n{release_notes}\nEOF\n")
    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
