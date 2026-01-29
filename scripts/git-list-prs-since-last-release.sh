#!/bin/bash
# Script for creating changelog list based on all PRs merged since the last release tag.
# Uses only git - no GitHub CLI required.

# Get the most recent version tag (sorted by semantic version)
TAG=$(git tag --list 'v[0-9]*' --sort=-version:refname | head -1)

if [ -z "$TAG" ]; then
  echo "Error: No version tags found matching v* pattern" >&2
  exit 1
fi

echo "Generating changelog since $TAG..."

# Get repo URL from git remote (handles both SSH and HTTPS formats)
REPO_URL=$(git remote get-url origin | sed -E 's|git@github.com:|https://github.com/|' | sed 's|\.git$||')

# Extract PR info from merge commit messages and format as changelog entries
git log --first-parent --pretty=format:"%s" "$TAG..main" |
  grep -oE '.+ \(#[0-9]+\)$' |
  while IFS= read -r line; do
    pr=$(echo "$line" | grep -oE '#[0-9]+\)$' | tr -d '#)')
    title=$(echo "$line" | sed -E 's| \(#[0-9]+\)$||')
    echo "$pr|$title"
  done |
  sort -t'|' -k1 -n -u |
  while IFS='|' read -r pr title; do
    echo "- #$pr $title ($REPO_URL/pull/$pr)"
  done

