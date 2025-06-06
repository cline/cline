You have access to the `gh` terminal command. I already authenticated it for you. Please review it to use the PR that I asked you to review. You're already in the `cline` repo.

<detailed_sequence_of_steps>
# GitHub PR Review Process - Detailed Sequence of Steps

## 1. Gather PR Information
1. Get the PR title, description, and comments:
   ```bash
   gh pr view <PR-number> --json title,body,comments
   ```

2. Get the full diff of the PR:
   ```bash
   gh pr diff <PR-number>
   ```

## 2. Understand the Context
1. Identify which files were modified in the PR:
   ```bash
   gh pr view <PR-number> --json files
   ```

2. Examine the original files in the main branch to understand the context:
   ```xml
   <read_file>
   <path>path/to/file</path>
   </read_file>
   ```

3. For specific sections of a file, you can use search_files:
   ```xml
   <search_files>
   <path>path/to/directory</path>
   <regex>search term</regex>
   <file_pattern>*.ts</file_pattern>
   </search_files>
   ```

## 3. Analyze the Changes
1. For each modified file, understand:
   - What was changed
   - Why it was changed (based on PR description)
   - How it affects the codebase
   - Potential side effects

2. Look for:
   - Code quality issues
   - Potential bugs
   - Performance implications
   - Security concerns
   - Test coverage

## 4. Ask for User Confirmation
1. Before making a decision, ask the user if you should approve the PR, providing your assessment and justification:
   ```xml
   <ask_followup_question>
   <question>Based on my review of PR #<PR-number>, I recommend [approving/requesting changes]. Here's my justification:
   
   [Detailed justification with key points about the PR quality, implementation, and any concerns]
   
   Would you like me to proceed with this recommendation?</question>
   <options>["Yes, approve the PR", "Yes, request changes", "No, I'd like to discuss further"]</options>
   </ask_followup_question>
   ```

## 5. Ask if User Wants a Comment Drafted
1. After the user decides on approval/rejection, ask if they would like a comment drafted:
   ```xml
   <ask_followup_question>
   <question>Would you like me to draft a comment for this PR that you can copy and paste?</question>
   <options>["Yes, please draft a comment", "No, I'll handle the comment myself"]</options>
   </ask_followup_question>
   ```

2. If the user wants a comment drafted, provide a well-structured comment they can copy:
   ```
   Thank you for this PR! Here's my assessment:

   [Detailed assessment with key points about the PR quality, implementation, and any suggestions]

   [Include specific feedback on code quality, functionality, and testing]
   ```

## 6. Make a Decision
1. Approve the PR if it meets quality standards:
   ```bash
   # For single-line comments:
   gh pr review <PR-number> --approve --body "Your approval message"
   
   # For multi-line comments with proper whitespace formatting:
   cat << EOF | gh pr review <PR-number> --approve --body-file -
   Thanks @username for this PR! The implementation looks good.

   I particularly like how you've handled X and Y.

   Great work!
   EOF
   ```

2. Request changes if improvements are needed:
   ```bash
   # For single-line comments:
   gh pr review <PR-number> --request-changes --body "Your feedback message"
   
   # For multi-line comments with proper whitespace formatting:
   cat << EOF | gh pr review <PR-number> --request-changes --body-file -
   Thanks @username for this PR!

   The implementation looks promising, but there are a few things to address:

   1. Issue one
   2. Issue two

   Please make these changes and we can merge this.
   EOF
   ```

   Note: The `cat << EOF | ... --body-file -` approach preserves all whitespace and formatting without requiring temporary files. The `-` parameter tells the command to read from standard input.
</detailed_sequence_of_steps>

<example_review_process>
# Example PR Review Process

Let's walk through a real example of reviewing PR #3627 which fixes the thinking mode calculation for Claude 3.7 models.

## Step 1: Gather PR Information

```bash
# Get PR details
gh pr view 3627 --json title,body,comments

# Get the full diff
gh pr diff 3627
```

## Step 2: Understand the Context

```xml
# Examine the original files to understand what's being changed
<read_file>
<path>src/shared/api.ts</path>
</read_file>

# Look at the ThinkingBudgetSlider component implementation
<read_file>
<path>webview-ui/src/components/settings/ThinkingBudgetSlider.tsx</path>
</read_file>

# Check how thinking mode is currently handled in API providers
<search_files>
<path>src/api/providers</path>
<regex>reasoningOn</regex>
<file_pattern>*.ts</file_pattern>
</search_files>
```

## Step 3: Analyze the Changes

From the PR information and code examination, we can see that:

1. The PR fixes an issue with the thinking mode budget calculation for Claude 3.7 models
2. Currently, the thinking budget is incorrectly calculated as 80% of maxTokens (8192), resulting in 6553 tokens
3. Claude 3.7 actually supports a much larger thinking budget (up to 64000 tokens)
4. The PR adds a `thinkingConfig` property with `maxBudget: 64000` to model definitions
5. It updates API handlers to use this value when reasoning mode is enabled
6. It enhances the slider component to calculate max values based on model-specific percentages
7. Comprehensive tests were added to verify the calculations

## Step 4: Ask for User Confirmation

```xml
<ask_followup_question>
<question>Based on my review of PR #3627, I recommend approving this PR. Here's my justification:

1. The PR correctly fixes the thinking mode budget calculation for Claude 3.7 models
2. It properly implements the thinkingConfig.maxBudget property (64000) for Claude 3.7 models
3. It applies the appropriate percentage (50%) for the slider calculation
4. The changes are well-tested with comprehensive unit tests
5. The implementation is clean and follows the project's coding standards
6. The PR includes helpful screenshots demonstrating the fix

Would you like me to proceed with approving this PR?</question>
<options>["Yes, approve the PR", "No, I'd like to discuss further", "Let me review it myself first"]</options>
</ask_followup_question>
```

## Step 5: Ask if User Wants a Comment Drafted

```xml
<ask_followup_question>
<question>Would you like me to draft a comment for this PR that you can copy and paste?</question>
<options>["Yes, please draft a comment", "No, I'll handle the comment myself"]</options>
</ask_followup_question>
```

## Step 6: Make a Decision

```bash
# Option 1: Simple one-line comment
gh pr review 3627 --approve --body "This PR looks good! It correctly fixes the thinking mode budget calculation for Claude 3.7 models."

# Option 2: Multi-line comment with proper whitespace formatting
cat << EOF | gh pr review 3627 --approve --body-file -
This PR looks good! It correctly fixes the thinking mode budget calculation for Claude 3.7 models.

I particularly like:
1. The proper implementation of thinkingConfig.maxBudget property (64000)
2. The appropriate percentage (50%) for the slider calculation
3. The comprehensive unit tests
4. The clean implementation that follows project coding standards

Great work!
EOF
```
</example_review_process>

<common_gh_commands>
# Common GitHub CLI Commands for PR Review

## Basic PR Commands
```bash
# List open PRs
gh pr list

# View a specific PR
gh pr view <PR-number>

# View PR with specific fields
gh pr view <PR-number> --json title,body,comments,files,commits

# Check PR status
gh pr status
```

## Diff and File Commands
```bash
# Get the full diff of a PR
gh pr diff <PR-number>

# List files changed in a PR
gh pr view <PR-number> --json files

# Check out a PR locally
gh pr checkout <PR-number>
```

## Review Commands
```bash
# Approve a PR (single-line comment)
gh pr review <PR-number> --approve --body "Your approval message"

# Approve a PR (multi-line comment with proper whitespace)
cat << EOF | gh pr review <PR-number> --approve --body-file -
Your multi-line
approval message with

proper whitespace formatting
EOF

# Request changes on a PR (single-line comment)
gh pr review <PR-number> --request-changes --body "Your feedback message"

# Request changes on a PR (multi-line comment with proper whitespace)
cat << EOF | gh pr review <PR-number> --request-changes --body-file -
Your multi-line
change request with

proper whitespace formatting
EOF

# Add a comment review (without approval/rejection)
gh pr review <PR-number> --comment --body "Your comment message"

# Add a comment review with proper whitespace
cat << EOF | gh pr review <PR-number> --comment --body-file -
Your multi-line
comment with

proper whitespace formatting
EOF
```

## Additional Commands
```bash
# View PR checks status
gh pr checks <PR-number>

# View PR commits
gh pr view <PR-number> --json commits

# Merge a PR (if you have permission)
gh pr merge <PR-number> --merge
```
</common_gh_commands>

<general_guidelines_for_commenting>
When reviewing a PR, please talk normally and like a friendly reviwer. You should keep it short, and start out by thanking the author of the pr and @ mentioning them. 

Whether or not you approve the PR, you should then give a quick summary of the changes without being too verbose or definitive, staying humble like that this is your understanding of the changes. Kind of how I'm talking to you right now.

If you have any suggestions, or things that need to be changed, request changes instead of approving the PR.

Leaving inline comments in code is good, but only do so if you have something specific to say about the code. And make sure you leave those comments first, and then request changes in the PR with a short comment explaining the overall theme of what you're asking them to change.
</general_guidelines_for_commenting>

<example_comments_that_i_have_written_before>
<brief_approve_comment>
Looks good, though we should make this generic for all providers & models at some point
</brief_approve_comment>
<brief_approve_comment>
Will this work for models that may not match across OR/Gemini? Like the thinking models?
</brief_approve_comment>
<approve_comment>
This looks great! I like how you've handled the global endpoint support - adding it to the ModelInfo interface makes total sense since it's just another capability flag, similar to how we handle other model features.

The filtered model list approach is clean and will be easier to maintain than hardcoding which models work with global endpoints. And bumping the genai library was obviously needed for this to work.

Thanks for adding the docs about the limitations too - good for users to know they can't use context caches with global endpoints but might get fewer 429 errors.
</approve_comment>
<requesst_changes_comment>
This is awesome. Thanks @scottsus.

My main concern though - does this work for all the possible VS Code themes? We struggled with this initially which is why it's not super styled currently. Please test and share screenshots with the different themes to make sure before we can merge
</request_changes_comment>
<request_changes_comment>
Hey, the PR looks good overall but I'm concerned about removing those timeouts. Those were probably there for a reason - VSCode's UI can be finicky with timing.

Could you add back the timeouts after focusing the sidebar? Something like:

```typescript
await vscode.commands.executeCommand("claude-dev.SidebarProvider.focus")
await setTimeoutPromise(100)  // Give UI time to update
visibleWebview = WebviewProvider.getSidebarInstance()
```
</request_changes_comment>
<request_changes_comment>
Heya @alejandropta thanks for working on this! 

A few notes:
1 - Adding additional info to the environment variables is fairly problematic because env variables get appended to **every single message**. I don't think this is justifiable for a somewhat niche use case. 
2 - Adding this option to settings to include that could be an option, but we want our options to be simple and straightforward for new users
3 - We're working on revisualizing the way our settings page is displayed/organized, and this could potentially be reconciled once that is in and our settings page is more clearly delineated. 

So until the settings page is update, and this is added to settings in a way that's clean and doesn't confuse new users, I don't think we can merge this. Please bear with us.
</request_changes_comment>
<request_changes_comment>
Also, don't forget to add a changeset since this fixes a user-facing bug.

The architectural change is solid - moving the focus logic to the command handlers makes sense. Just don't want to introduce subtle timing issues by removing those timeouts.
</request_changes_comment>
</example_comments_that_i_have_written_before>
