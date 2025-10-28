# GitHub Root Cause Analysis

Automated GitHub issue analysis using Cline CLI. This script uses Cline's autonomous AI capabilities to fetch, analyze, and identify root causes of GitHub issues. It uses Cline's JSON output capability to filter for just the summary at the end for brevity.

**Full Tutorial:** See the [documentation](https://docs.cline.bot/cline-cli/samples/github-issue-rca)

## Getting the Script

**Option 1: Clone or view the repository**
- Script location: [`analyze-issue.sh`](./analyze-issue.sh)

**Option 2: Download directly with curl**
```bash
curl -O https://raw.githubusercontent.com/cline/cline/main/src/samples/cli/github-issue-rca/analyze-issue.sh
chmod +x analyze-issue.sh
```

## Quick Start

```bash
# Basic usage (default prompt analyzes root cause)
./analyze-issue.sh https://github.com/owner/repo/issues/123

# Custom analysis prompt
./analyze-issue.sh https://github.com/owner/repo/issues/123 "What is the security impact?"

# With specific Cline instance address
./analyze-issue.sh https://github.com/owner/repo/issues/123 "What is the root cause?" 127.0.0.1:46529
```

## Prerequisites

- Cline CLI installed and configured
- GitHub CLI (`gh`) installed (used by Cline to fetch issue details)
- `jq` installed (for parsing JSON output)

## How It Works

The script:
1. Accepts a GitHub issue URL and optional custom prompt
2. Uses Cline in act mode with yolo (fully autonomous, non-interactive)
3. Cline automatically:
   - Fetches the issue details
   - Explores relevant codebases if needed
   - Analyzes the issue to identify root causes
   - Provides a detailed analysis
4. Outputs JSON results, filtered to the summary output

### Command Breakdown

```bash
cline -y "$PROMPT: $ISSUE_URL" --mode act $ADDRESS -F json | \
    sed -n '/^{/,$p' | \
    jq -r 'select(.say == "completion_result") | .text' | \
    sed 's/\\n/\n/g'
```

**Flags:**
- `-y` / `--yolo` - Enable yolo mode (non-interactive, auto-approves actions)
- `--mode act` - Use act mode (actively uses tools to investigate)
- `$ADDRESS` - Optional `--address` flag to specify which Cline instance to use
- `-F json` - Output in JSON format for parsing

**Pipeline:**
- `sed -n '/^{/,$p'` - Extract JSON from output (skips any non-JSON prefix)
- `jq -r 'select(.say == "completion_result") | .text'` - Extract the completion result
- `sed 's/\\n/\n/g'` - Convert escaped newlines to actual newlines

## Sample Output

Here's an abbreviated example analyzing a real issue:

```
$ ./analyze-issue.sh https://github.com/csells/flutter_counter/issues/2

**Root Cause Analysis of Issue #2: "setState isn't cutting it"**

After examining the GitHub issue and analyzing the Flutter counter codebase, 
I've identified the root cause of why setState() is insufficient for this 
project's needs:

## Current Implementation Problems
[details elided]

## Recommended Solutions

The issue mentions "Provider or Bloc" - both are excellent alternatives:

1. **Provider**: Simple, lightweight state management using InheritedWidget
2. **Bloc**: More structured approach with clear separation between events, 
   states, and business logic
3. **Riverpod**: Modern alternative to Provider with better performance
4. **GetX**: Full-featured solution with state management, routing, and 
   dependency injection

The current codebase needs refactoring to implement proper state management 
architecture to handle more complex state scenarios effectively.
