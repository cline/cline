#!/bin/bash

# Create a directory to store the diff results
mkdir -p ~/cline-pr-prep/diffs

# List of files to compare
files=(
  "src/core/webview/ClineProvider.ts"
  "src/utils/fs.ts"
  "webview-ui/src/components/chat/TaskHeader.tsx"
  "src/shared/ChatSettings.ts"
)

# Compare each file and save the diff
for file in "${files[@]}"; do
  echo "Comparing $file..."
  
  # Create directory structure if needed
  mkdir -p "$(dirname ~/cline-pr-prep/diffs/$file)"
  
  # Compare the files and save the diff
  diff -u "/Users/ant/unchanged-cline-clone/$file" "/Users/ant/cline/$file" > ~/cline-pr-prep/diffs/$file.diff
  
  # Check if there are differences
  if [ $? -eq 0 ]; then
    echo "No differences found in $file"
  else
    echo "Differences found in $file"
  fi
  
  echo "------------------------"
done

# Find all modified files using git diff
echo "Finding all modified files..."
cd /Users/ant/cline
git diff --name-only /Users/ant/unchanged-cline-clone /Users/ant/cline > ~/cline-pr-prep/all_modified_files.txt

echo "Comparison complete. Results saved to ~/cline-pr-prep/diffs/"
