# Git Diff Analysis Workflow

## Objective
Analyze the current branch's changes against main to provide informed insights and context for development decisions.

## Step 1: Gather Git Information
<important>Do not return any text or conversation other than what is necessary to run these commands</important>

**Run the following command to get the latest changes (bash):**
```bash
B=$(for c in main master origin/main origin/master; do git rev-parse --verify -q "$c" >/dev/null && echo "$c" && break; done); B=${B:-HEAD}; r(){ git branch --show-current; printf "=== STATUS ===\n"; git status --porcelain | cat; printf "=== COMMIT MESSAGES ===\n"; git log "$B"..HEAD --oneline | cat; printf "=== CHANGED FILES ===\n"; git diff "$B" --name-only | cat; printf "=== FULL DIFF ===\n"; git diff "$B" | cat; }; L=$(r | wc -l); if [ "$L" -gt 500 ]; then r > cline-git-analysis.temp && echo "::OUTPUT_FILE=cline-git-analysis.temp"; else r; fi
```

```powershell
$B=$null;foreach($c in 'main','master','origin/main','origin/master'){git rev-parse --verify -q $c *> $null;if($LASTEXITCODE -eq 0){$B=$c;break}};if(-not $B){$B='HEAD'};function r([string]$b){git rev-parse --abbrev-ref HEAD; '=== STATUS ==='; git status --porcelain | cat; '=== COMMIT MESSAGES ==='; git log "$b"..HEAD --oneline | cat; '=== CHANGED FILES ==='; git diff "$b" --name-only | cat; '=== FULL DIFF ==='; git diff "$b" | cat};$out=r $B|Out-String;$lines=($out -split "`r?`n").Count;if($lines -gt 500){$out|Set-Content -NoNewline cline-git-analysis.temp; '::OUTPUT_FILE=cline-git-analysis.temp'}else{$out}
```

## Step 2: Silent, Structured Analysis Phase
- Analyze all git output without providing commentary or narration
- Read the full diff to understand the scope and nature of changes
- Identify patterns, architectural modifications, or potential impacts
- Use `read_file` to examine any related files providing additional context on the changes you have observed

## Step 3: Context Gathering
- Analyze related code without providing commentary or narration
- Read relevant related source files if needed for complete understanding
- Check dependencies, imports, or cross-references spanning the changes
- Understand the broader codebase context around modifications
- This additional context gathering should include related backend code, as well as related ui/frontend code
- You will typically need to analyze at least several files, potentially many, in order to fully complete this step
- You should not continue reading additional context if you have exhausted more than 60% of your available context window
- If you have exhausted less than 40% of your context window, you should continue reviewing additional context

## Step 4: Ready for User Interaction
**Only after completing the full analysis:**
- Engage with the user based on comprehensive understanding
- Provide insights about specific modifications and their impacts
- If you are certain they exist, note potential breaking changes or compatibility issues
- Answer questions with informed context from the complete change set and context gathering
- If the user has not provided a question, or the question is insufficient to provide a quality response, ask brief (one sentence) clarifying questions.
- Only offer recommendations if they are applicable to the user's request and relevant to the changes that you have observed 

## Key Rules
- **No prose or conversation during git research phase**
- **No prose or conversation during context gathering phase**
- **Complete all analysis before any user interaction**
- **Use gathered information for all subsequent questions and insights**
- **Focus on understanding the complete picture before discussing**

## Optional: Additional Analysis Commands
For deeper investigation when needed:

```shell
# Detailed commit history with author info
git log main..HEAD --format="%h %s (%an)" | cat

# Change statistics
git diff main --stat | cat

# Specific file type changes
git diff main --name-only | grep -E '\.(ts|js|tsx|jsx|py|md)$' | cat
