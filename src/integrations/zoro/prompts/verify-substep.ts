export function getSubstepVerificationPrompt(
	stepDescription: string,
	substepDescription: string,
	rules: Array<{ rule_id: string; name: string; description: string }>,
	chatHistory: string,
): string {
	return `# Task: Verify Substep Implementation

## PARENT STEP:
${stepDescription}

## SUBSTEP TO VERIFY:
${substepDescription}

## RECENT CHAT HISTORY:
${chatHistory}

## 🔍 VERIFICATION STEPS - FOLLOW IN ORDER

**You MUST complete these steps before providing your verdict:**

1. **Identify target files**: Based on the substep description and chat history, determine which files should have been modified
2. **Read those files**: Use read_file to check if the expected changes exist
3. **Search for patterns**: Use search_files to find specific code patterns mentioned in the substep
4. **Check git history**: Use execute_command with 'git log --oneline -5' or 'git diff HEAD~1' to see recent changes
5. **Verify rules**: Check if the code follows the specified rules below
6. **Build evidence**: Collect concrete examples from the code

**⚠️ CRITICAL: You MUST use tools in steps 2-4. Do NOT skip directly to the final verdict without investigating!**

## 📋 RULES TO CHECK

Apply these rules during step 5 above:

${rules.map((r, i) => `${i + 1}. [${r.rule_id}] ${r.name}: ${r.description}`).join("\n")}

## VERIFICATION CRITERIA:

### 1. IMPLEMENTATION DETAILS
✅ **Files Changed**: Which files were modified in this substep?
✅ **Code Changes**: What specific code changes were made?
✅ **Scope**: Did this substep stay focused on its stated goal?

### 2. RULE APPLICATION
For each rule that was applied in this substep:
- Identify the rule by ID
- Explain HOW it was used specifically in this substep
- Provide concrete evidence from the chat or code changes

## 🛠️ AVAILABLE TOOLS

Use these tools during your investigation:
- **read_file**: Read any file to check if changes were made
- **search_files**: Search the codebase for specific code patterns
- **execute_command**: Run git commands to check history (git log, git show, git diff HEAD~1)

## 📤 OUTPUT FORMAT

After using tools to investigate, return ONLY a JSON object with this exact structure:
{
  "substep_id": "substep-1",
  "description": "${substepDescription}",
  "files_changed": ["path/to/file1.ts", "path/to/file2.py"],
  "code_changes": "Brief description of what code was added/modified/removed in this substep",
  "rules_used": [
    {
      "rule_id": "rule-123",
      "rule_text": "[code-style] Full rule name and description",
      "how_used": "Specific explanation of how this rule was applied in THIS substep with concrete examples"
    }
  ]
}

**IMPORTANT:**
- Only include rules that were ACTUALLY used in this specific substep
- Be specific about file paths (extract from chat history)
- Keep code_changes concise but informative
- If no rules were used, rules_used should be an empty array []

Focus on WHAT CHANGED (files, code) and WHICH RULES were consciously applied.`
}
