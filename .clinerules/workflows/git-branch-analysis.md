# Git Diff Analysis Workflow

## Objective
Analyze the current branch's changes against main to provide informed insights and context for development decisions.

## Step 1: Gather Git Information
<important>Do not return any text or conversation other than what is necessary to run these commands</important>

**First, check the expected output size:**
   ```shell
   (git branch --show-current && echo "=== STATUS ===" && git status --porcelain | cat && echo "=== COMMIT MESSAGES ===" && git log main..HEAD --oneline | cat && echo "=== CHANGED FILES ===" && git diff main --name-only | cat && echo "=== FULL DIFF ===" && git diff main | cat) | wc -l
   ```

**If the expected line count is greater than 500 lines, use the file-based approach:**
   ```shell
   git branch --show-current > cline-git-analysis.temp && echo "=== STATUS ===" >> cline-git-analysis.temp && git status --porcelain >> cline-git-analysis.temp && echo "=== COMMIT MESSAGES ===" >> cline-git-analysis.temp && git log main..HEAD --oneline >> cline-git-analysis.temp && echo "=== CHANGED FILES ===" >> cline-git-analysis.temp && git diff main --name-only >> cline-git-analysis.temp && echo "=== FULL DIFF ===" >> cline-git-analysis.temp && git diff main >> cline-git-analysis.temp
   ```

   Then, read the file using the read_file tool. After you have read the file but before you proceed with subsequent steps, delete it:
   ```shell
   rm cline-git-analysis.temp
   ```

**If the expected line count is 500 lines or fewer, use the direct approach:**
   ```shell
   git branch --show-current && echo "=== STATUS ===" && git status --porcelain | cat && echo "=== COMMIT MESSAGES ===" && git log main..HEAD --oneline | cat && echo "=== CHANGED FILES ===" && git diff main --name-only | cat && echo "=== FULL DIFF ===" && git diff main | cat
   ```

<important>If using the direct approach, pipe outputs through `cat` to avoid interactive terminals. If the user's shell is not bash/zsh, adjust the command and chaining
 syntax accordingly.</important>

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
