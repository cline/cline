export function getPlanningVerificationPrompt(
	stepDescription: string,
	rules: Array<{ rule_id: string; name: string; description: string }>,
	chatHistory: string,
	planOutput: string
): string {
	const rulesComplianceTemplate = rules.map(r => `    "${r.rule_id}": "followed" | "violated" | "not_applicable"`).join(',\n')
	
	return `You are verifying whether a planning step was completed correctly.

## STEP TO VERIFY:
${stepDescription}

## RULES TO FOLLOW (CRITICAL - MUST CHECK EACH ONE):
${rules.map((r, i) => `${i + 1}. [${r.rule_id}] ${r.name}: ${r.description}`).join('\n')}

## RECENT CHAT HISTORY:
${chatHistory}

## PLAN OUTPUT (from planning node):
${planOutput}

## VERIFICATION CRITERIA:

### 1. STRATEGY QUALITY (Did they think before coding?)
✅ **Referenced step-1**: Did planner acknowledge what was learned in checking-with-user?
   - Look for: "Based on your clarification that X..."
   - NOT just jumping straight to implementation

✅ **Global Approach**: Is there a HIGH-LEVEL strategy before code steps?
   - Look for: Architecture analysis, approach explanation, WHY this solution
   - NOT just: "Step 1: Edit file.ts, Step 2: Edit file2.ts"

✅ **Analyzed Codebase**: Did they read relevant files first?
   - Look for: File analysis, dependencies identified
   - NOT: Assuming file structure without checking

✅ **Explained Reasoning**: Did they explain WHY, not just WHAT?
   - Look for: Tradeoffs discussed, alternatives considered
   - NOT: Just task lists

✅ **Steps Match Strategy**: Do code-style steps implement the stated approach?
   - Look for: Clear connection between strategy → steps
   - NOT: Disconnected or contradictory steps

### 2. RULE COMPLIANCE (MUST CHECK EVERY RULE)
For EACH rule in the list above, verify:
- **followed**: Planner explicitly followed this rule
- **violated**: Planner ignored or contradicted this rule  
- **not_applicable**: This rule doesn't apply to planning

### 3. USER APPROVAL
✅ Did planner present strategy to user?
✅ Did user approve before proceeding?

## CRITICAL VERIFICATION RULES:
1. **NO SHORTCUTS**: Status flags mean nothing - verify actual chat content
2. **RULES FIRST**: Check EVERY rule for compliance - this is non-negotiable
3. **BE THOROUGH**: Good planning = requirements → strategy → steps (not just steps)

## OUTPUT FORMAT:

**CRITICAL**: The overview must extract the COMPLETE planning discussion from RECENT CHAT HISTORY. Show all files analyzed, the full strategy, rule-driven considerations (what rules made the planner think about that wouldn't have been considered otherwise), and user approval.

Return ONLY a JSON object with this exact structure:
{
  "verdict": "done" | "not_done" | "partial" | "unclear",
  "overview": "## Planning Discussion Summary\n\n### Files Analyzed\n[Extract from RECENT CHAT HISTORY which files the planner read]\n\n### Strategy Proposed\n[Extract the complete strategy explanation from RECENT CHAT HISTORY and PLAN OUTPUT]\n\n### Rule-Driven Considerations\n[For each rule that influenced planning, show:]\n**From Rule [rule-id] - [rule name]:**\n→ What consideration this rule forced\n→ What would have been missed without this rule\n\n[Example:]\n**From Rule [abc-123] - Always confirm UI placement:**\n→ Asked user where errors should display (inline vs modal)\n→ Without this rule, would have assumed inline by default\n\n### Implementation Steps\n[List all proposed steps from PLAN OUTPUT]\n\n### User Response\n[Extract user's approval or feedback from RECENT CHAT HISTORY]",
  "rules_analysis": [
    {
      "rule_id": "${rules[0]?.rule_id || 'rule-id'}",
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
