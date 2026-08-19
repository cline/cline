#!/usr/bin/env bash
# Cline Hook: PreToolUse (Inject File Context)
# Extracts and injects file context before tool execution
# Copy to ~/.cline/hooks/PreToolUse.sh and chmod +x

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_call.name // ""')
filePath=$(echo "$input" | jq -r '.tool_call.input.filePath // ""')

# When reading a file, check for related files to provide context
if [ "$tool" = "read_files" ] && [ -n "$filePath" ]; then
  # Extract directory and filename
  dir=$(dirname "$filePath")
  name=$(basename "$filePath")

  # Check for related files (e.g., if reading .ts, mention .test.ts)
  context_files=""

  # For TypeScript files, check for test files
  if [[ $filePath == *.ts || $filePath == *.tsx ]]; then
    test_file="${filePath%.ts*}.test.ts"
    if [ -f "$test_file" ]; then
      context_files="Associated test file exists: $test_file"
    fi
  fi

  # For package.json, suggest related files
  if [ "$name" = "package.json" ]; then
    related=""
    [ -f "$dir/package-lock.json" ] && related="$related package-lock.json"
    [ -f "$dir/yarn.lock" ] && related="$related yarn.lock"
    [ -f "$dir/pnpm-lock.yaml" ] && related="$related pnpm-lock.yaml"
    if [ -n "$related" ]; then
      context_files="Related lock files:$related"
    fi
  fi

  if [ -n "$context_files" ]; then
    jq -n --arg ctx "$context_files" '{context: $ctx}'
    exit 0
  fi
fi

# For run_commands, inject environment info
if [ "$tool" = "run_commands" ]; then
  node_version=$(node --version 2>/dev/null || echo "not installed")
  git_branch=$(git branch --show-current 2>/dev/null || echo "")

  context="Environment: node $node_version"
  [ -n "$git_branch" ] && context="$context, branch: $git_branch"

  jq -n --arg ctx "$context" '{context: $ctx}'
  exit 0
fi

# Allow other tools to proceed without modification
echo '{}'
