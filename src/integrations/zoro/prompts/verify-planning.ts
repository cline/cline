export function getPlanningVerificationPrompt(
	stepDescription: string,
	rules: Array<{ rule_id: string; name: string; description: string }>,
	chatHistory: string,
	planOutput: string,
): string {
	const rulesComplianceTemplate = rules.map((r) => `    "${r.rule_id}": "followed" | "violated" | "not_applicable"`).join(",\n")

	return `# Task: Verify Planning Step Completion

## STEP TO VERIFY:
${stepDescription}

## RECENT CHAT HISTORY:
${chatHistory}

## PLAN OUTPUT (from planning node):
${planOutput}

## 🔍 VERIFICATION STEPS - FOLLOW IN ORDER

**You MUST complete these steps before providing your verdict:**

1. **Check step-1 reference**: Did planner acknowledge what was learned in checking-with-user?
   - Look for: "Based on your clarification that X..."
   - Use read_file or search_files if needed to verify
   
2. **Verify file analysis**: Did they read relevant files before planning?
   - Look for: File reading activity in chat history
   - Check if they identified dependencies and structure
   
3. **Extract strategy**: Is there a HIGH-LEVEL approach explanation?
   - Look for: Architecture analysis, WHY this solution
   - NOT just: "Step 1: Edit file.ts, Step 2: Edit file2.ts"
   
4. **Verify reasoning**: Did they explain tradeoffs and alternatives?
   - Look for: Discussion of options, rationale for choices
   - Use tools if needed to verify claims about codebase
   
5. **Check step alignment**: Do proposed code-style steps implement the strategy?
   - Look for: Clear connection between strategy → steps
   
6. **Verify user approval**: Did planner present strategy and get approval?
   - Look for: User response approving the plan
   
7. **Check rule compliance**: For EACH rule below, verify if followed
   - Use evidence from chat history and plan output

**⚠️ CRITICAL: Use tools if you need to verify claims about the codebase. Don't skip investigation!**

## 📋 RULES TO CHECK (CHECK EVERY SINGLE ONE)

Apply these rules during step 7 above:

${rules.map((r, i) => `${i + 1}. [${r.rule_id}] ${r.name}: ${r.description}`).join("\n")}

**RULE VERIFICATION:**
- **followed**: Planner explicitly followed this rule
- **violated**: Planner ignored or contradicted this rule  
- **not_applicable**: This rule doesn't apply to planning

**CRITICAL:** You MUST check ALL ${rules.length} rules. No shortcuts!

## VERIFICATION CRITERIA:

### 1. STRATEGY QUALITY
Good planning = requirements → strategy → steps (not just steps)
- Referenced prior learnings
- Analyzed codebase first
- Explained WHY before WHAT
- Connected strategy to implementation steps

### 2. RULE COMPLIANCE
Check EVERY rule in the list above with concrete evidence

### 3. USER APPROVAL
Verify strategy was presented and approved

## 🛠️ AVAILABLE TOOLS

Use these tools if you need to verify claims:
- **read_file**: Read files to verify planner's analysis
- **search_files**: Search for patterns mentioned in strategy
- **execute_command**: Check git history if needed

## 📤 OUTPUT FORMAT

**CRITICAL**: The overview must extract the COMPLETE planning discussion from RECENT CHAT HISTORY. Show all files analyzed, the full strategy, rule-driven considerations (what rules made the planner think about that wouldn't have been considered otherwise), and user approval.

Return ONLY a JSON object with this exact structure:
{
  "verdict": "done" | "not_done" | "partial" | "unclear",
  "overview": "## Planning Discussion Summary\n\n### Files Analyzed\n[Extract from RECENT CHAT HISTORY which files the planner read]\n\n### Strategy Proposed\n[Extract the complete strategy explanation from RECENT CHAT HISTORY and PLAN OUTPUT]\n\n### Rule-Driven Considerations\n[For each rule that influenced planning, show:]\n**From Rule [rule-id] - [rule name]:**\n→ What consideration this rule forced\n→ What would have been missed without this rule\n\n[Example:]\n**From Rule [abc-123] - Always confirm UI placement:**\n→ Asked user where errors should display (inline vs modal)\n→ Without this rule, would have assumed inline by default\n\n### Implementation Steps\n[List all proposed steps from PLAN OUTPUT]\n\n### User Response\n[Extract user's approval or feedback from RECENT CHAT HISTORY]",
  "rules_analysis": [
    {
      "rule_id": "${rules[0]?.rule_id || "rule-id"}",
      "rule_text": "[planning] Full rule text here",
      "followed": true,
      "evidence": "Specific quote showing rule was followed, e.g. 'Planner said: Based on step-1...'"
    }
  ]
}

**CRITICAL:** Include ALL ${rules.length} rules in rules_analysis array.
Each rule MUST have:
- rule_id: exact ID from the rules list
- rule_text: full rule name + description
- followed: boolean (true/false)
- evidence: grounded proof (quotes from chat, file analysis, etc.)

Return ONLY the JSON. Focus on strategic thinking AND rule adherence.`
}
