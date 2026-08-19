#!/usr/bin/env bash
# Cline Hook: PreToolUse (Require Review)
# Pauses for review before writing to critical files
# Copy to ~/.cline/hooks/PreToolUse.sh and chmod +x

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_call.name // ""')
file=$(echo "$input" | jq -r '.tool_call.input.filePath // ""')

# Require review for critical files
if [ "$tool" = "editor" ] || [ "$tool" = "write_file" ]; then
  if [[ $file =~ (package\.json|tsconfig|\.env|secrets|config\.(ts|js)|\.cline) ]]; then
    jq -n --arg file "$file" '{review: true, context: "This will modify a critical file: \($file)"}'
    exit 0
  fi
fi

# Allow everything else
echo '{}'
