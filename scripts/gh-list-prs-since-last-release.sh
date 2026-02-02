# Script for creating changelog list based on all PRs merged into the current repo since the last release tag.
# Auto-detects the latest vX.Y.Z tag.

# Get the most recent version tag (sorted by semantic version)
TAG=$(git tag --list 'v[0-9]*' --sort=-version:refname | head -1)

if [ -z "$TAG" ]; then
  echo "Error: No version tags found matching v* pattern" >&2
  exit 1
fi

echo "Generating changelog since $TAG..."

# Get repo owner and name from remote
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=$(echo "$REPO" | cut -d/ -f1)
NAME=$(echo "$REPO" | cut -d/ -f2)

# Build query body and execute in single request
QUERY_BODY=$(git log --first-parent --pretty=%s "$TAG..main" |
  grep -Eo '#[0-9]+' |
  tr -d '#' |
  sort -un |
  awk '{printf "pr%s: pullRequest(number: %s) { number title url } ", $1, $1}')

gh api graphql \
  -f query="query { repository(owner: \"$OWNER\", name: \"$NAME\") { $QUERY_BODY }}" 2>/dev/null |
  jq -r '.data.repository | to_entries | sort_by(.value.number // 999999) | .[] | select(.value != null) | "- #\(.value.number) \(.value.title | gsub("[\\r\\n]+"; " ") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")) (\(.value.url))"' |
  grep -v '^$'
