# GitHub Root Cause Analysis

Automated GitHub issue analysis using Cline CLI. This script uses Cline's
autonomous AI capabilities to fetch, analyze, and identify root causes of GitHub
issues.

## Usage

```bash
# Basic usage (default prompt analyzes root cause)
./analyze-issue.sh https://github.com/owner/repo/issues/123

# Custom analysis prompt
./analyze-issue.sh https://github.com/owner/repo/issues/123 "What is the security impact?"
```

## Prerequisites

- Cline CLI installed and configured (`cline auth`)
- GitHub CLI (`gh`) installed (used by Cline to fetch issue details)

## How It Works

The script:
1. Accepts a GitHub issue URL and optional custom prompt
2. Uses Cline in **act mode with yolo** (fully autonomous, non-interactive)
3. Cline automatically:
   - Fetches the issue details using `gh` CLI
   - Explores relevant codebases if needed
   - Analyzes the issue to identify root causes
   - Provides a detailed analysis
4. Outputs plain text results and exits automatically

### Command Used

```bash
cline -y "$PROMPT: $ISSUE_URL" --mode act
```

**Flags explained:**
- `-y` - Enable yolo mode (non-interactive, auto-approves all actions)
- `--mode act` - Use act mode (actively uses tools to investigate)

## Sample Output

Here's an abbreviated example analyzing a real Cline issue:

```
$ ./analyze-issue.sh https://github.com/cline/cline/issues/6881
Following task conversation until completion... (Press Ctrl+C to exit)

Conversation history (1 messages)

 What is the root cause of this issue: https://github.com/cline/cline/issues/6881 

### Cline is thinking
The user is asking me to analyze a GitHub issue...
I need to fetch the GitHub issue to understand what it's about...

### Cline responds
I'll help you investigate the root cause of GitHub issue #6881...

### Cline is running  gh issue view 6881 --repo cline/cline --json title,body,comments...

## API request completed  ↑ 13.7k ↓ 307 $0.0586 

[Issue details fetched]

### Cline is thinking
Let me analyze the issue I just fetched:
• Title: "L'estensione Cline diventa grigia e smette di funzionare su macOS"
• The Cline UI becomes completely gray and unresponsive on macOS
• Happens randomly during tasks, particularly after API requests to LLM...

[Analysis continues - Cline explores codebase, searches for related code]

### Task completed
## Root Cause Analysis Complete for GitHub Issue #6881

Issue: Cline VSCode extension UI becomes gray and unresponsive on macOS

### Root Cause: Webview State Update Overload

The primary root cause is excessive state updates overwhelming the webview 
rendering process. The analysis revealed:

1. Volume of State Updates: The postStateToWebview() method is called from 
   96+ locations throughout the codebase
2. Large State Payload: Each update includes complete task history, all messages,
   API configuration...
3. Critical Timing: Freezes occur during file saves and task completions
4. Platform-Specific: macOS has stricter resource management for webview processes

[Full analysis with recommended solutions]

## API request completed  ↑ 1.3k ↓ 643 → 47.7k $0.0301 
```
