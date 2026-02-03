export function getCodeStyleVerificationPrompt(
	stepDescription: string,
	substeps: Array<{ id: string; text: string; completed: boolean }>,
	rules: Array<{ rule_id: string; name: string; description: string }>,
	chatHistory: string,
): string {
	return `# Task: Verify Code-Style Step Implementation

## STEP TO VERIFY:
${stepDescription}

## SUBSTEPS:
${substeps.map((s, i) => `${i + 1}. [${s.completed ? "x" : " "}] ${s.text}`).join("\n")}

## RECENT CHAT HISTORY:
${chatHistory}

## 🔍 VERIFICATION STEPS - FOLLOW IN ORDER

**You MUST complete these steps before providing your verdict:**

1. **Identify target files**: Based on the step description and substeps, determine which files should have been modified
2. **Read those files**: Use read_file to check if the expected changes exist for each substep
3. **Search for patterns**: Use search_files to find specific code patterns, imports, or structures mentioned
4. **Check git history**: Use execute_command with 'git log --oneline -10' or 'git diff HEAD~1' to see recent changes
5. **Verify substep completion**: Match each substep to actual code changes you found
6. **Check rule compliance**: For EACH rule below, verify if the code follows it
7. **Build evidence**: Collect concrete examples from the code for each rule

**⚠️ CRITICAL: You MUST use tools in steps 2-4. Do NOT skip directly to the final verdict without investigating!**

## 📋 RULES TO CHECK (CHECK EVERY SINGLE ONE)

Apply these rules during step 6 above:

${rules.map((r, i) => `${i + 1}. [${r.rule_id}] ${r.name}: ${r.description}`).join("\n")}

**RULE VERIFICATION:**
- **followed**: Code explicitly follows this rule (confirmed by tools)
- **violated**: Code ignores or contradicts this rule  
- **not_applicable**: This rule doesn't apply to code-style

**CRITICAL:** You MUST check ALL ${rules.length} rules. No shortcuts!

## VERIFICATION CRITERIA:

### 1. SUBSTEP COMPLETION
For each substep, actively investigate:
- Use **read_file** to check actual implementation
- Use **search_files** to find patterns/imports
- Map each substep to specific code changes
- Mark as: done, partial, or not_done

### 2. RULE COMPLIANCE
For EACH rule in the list above:
- Use tools to verify actual code
- Provide concrete evidence from code inspection
- Don't rely on chat history alone

## 🛠️ AVAILABLE TOOLS

Use these tools during your investigation:
- **read_file**: Read any file to confirm implementation
- **search_files**: Search for patterns, imports, or structures
- **list_files**: Check directory structure
- **list_code_definition_names**: See what functions/classes exist
- **execute_command**: Run git commands to check history

## Instructions - YOU MUST USE TOOLS

⚠️ **DO NOT JUST RESPOND - YOU MUST USE TOOLS TO COMPLETE THIS TASK**

### Phase 1: Investigate Implementation (use tools!)

Before making any verdict, you MUST:
- Use **read_file** to read files mentioned in substeps
- Use **search_files** to find where features are implemented
- Use **execute_command** to check git history if needed
- Build concrete understanding of what was implemented

### Phase 2: Build Verdict (after investigation)

After using tools to investigate, provide your JSON verdict.

**START NOW by using read_file or search_files to investigate the substeps!**

## 📤 OUTPUT FORMAT

After using tools to verify, return ONLY a JSON object with this exact structure:

**NOTE:** Detailed file changes and code are captured in individual substep verifications. This step verification focuses on overall completion and rule compliance across all substeps.

{
  "verdict": "done" | "not_done" | "partial" | "unclear",
  "overview": "## Implementation Summary\n\n### Substeps Completed\n- Substep 1: [description] - VERIFIED ✅\n- Substep 2: [description] - VERIFIED ✅\n- Substep 3: [description] - PARTIAL ⚠️\n\nSee individual substep verifications for detailed file changes and code modifications.\n\n### Overall Assessment\n[High-level summary of whether the implementation achieved the step's goal]",
  "rules_analysis": [
    {
      "rule_id": "${rules[0]?.rule_id || "rule-id"}",
      "rule_text": "[code-style] Full rule text here",
      "followed": true,
      "evidence": "Aggregated evidence across substeps showing how the rule was followed",
      "used_in_substeps": ["substep-1", "substep-3"]
    }
  ]
}

**CRITICAL:** Include ALL ${rules.length} rules in rules_analysis array.
Each rule MUST have:
- rule_id: exact ID from the rules list
- rule_text: full rule name + description
- followed: boolean (true/false)
- evidence: grounded proof aggregated across substeps
- used_in_substeps: array of substep IDs where this rule was applied

**REQUIREMENTS:**
1. The overview should summarize substep completion status
2. Reference individual substep verifications for file/code details
3. Rules_analysis shows which substeps used each rule
4. Focus on high-level assessment, not low-level code details

Be thorough and use your tools. Focus on verifiable facts from actual code inspection.`
}
