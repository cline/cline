export function getCheckingWithUserVerificationPrompt(
	stepDescription: string,
	rules: Array<{ rule_id: string; name: string; description: string }>,
	chatHistory: string
): string {
	const rulesComplianceTemplate = rules.map(r => `    "${r.rule_id}": "followed" | "violated" | "not_applicable"`).join(',\n')
	
	return `You are verifying whether a checking-with-user step was completed correctly.

## STEP TO VERIFY:
${stepDescription}

## RULES TO FOLLOW (CRITICAL - MUST CHECK EACH ONE):
${rules.map((r, i) => `${i + 1}. [${r.rule_id}] ${r.name}: ${r.description}`).join('\n')}

## RECENT CHAT HISTORY:
${chatHistory}

## VERIFICATION CRITERIA:

### 1. COMMUNICATION QUALITY
✅ **Clarifying Questions**: Did assistant ask 2-3 clarifying questions per round?
✅ **Explicit Approval**: Was explicit user confirmation sought before proceeding?
✅ **Ambiguities Resolved**: Were unclear requirements clarified iteratively?
✅ **User Satisfied**: Did user provide final approval/confirmation?

### 2. RULE COMPLIANCE (MUST CHECK EVERY RULE)
For EACH rule in the list above, verify:
- **followed**: Assistant explicitly followed this rule during checking-in
- **violated**: Assistant ignored or contradicted this rule  
- **not_applicable**: This rule doesn't apply to checking-with-user

## CRITICAL VERIFICATION RULES:
1. **NO SHORTCUTS**: Status flags mean nothing - verify actual chat messages
2. **RULES FIRST**: Check EVERY rule for compliance - this is non-negotiable
3. **BE THOROUGH**: Good checking = iterative clarification until confident

## OUTPUT FORMAT:

**CRITICAL**: The overview must extract ALL clarifying questions asked by Cline and ALL user responses from RECENT CHAT HISTORY. Show the complete conversation flow round-by-round, then include the final requirements output.

Return ONLY a JSON object with this exact structure:
{
  "verdict": "done" | "not_done" | "partial" | "unclear",
  "overview": "## Requirements Clarification Summary\n\n[Extract ALL rounds of Q&A from RECENT CHAT HISTORY]\n\n### Round 1\n**Cline asked:**\n- Question 1?\n- Question 2?\n- Question 3?\n\n**User answered:**\n- Answer 1\n- Answer 2\n- Answer 3\n\n### Round 2\n**Cline asked:**\n- Question 4?\n\n**User answered:**\n- Answer 4\n\n[Continue for all rounds...]\n\n### Final Requirements\n[Show the complete requirements checklist + user story saved to node.output]",
  "rules_analysis": [
    {
      "rule_id": "${rules[0]?.rule_id || 'rule-id'}",
      "rule_text": "[checking-with-user] Full rule text here",
      "followed": true,
      "evidence": "Specific quote or line reference showing the rule was followed"
    }
  ]
}

**CRITICAL:** Include ALL ${rules.length} rules in rules_analysis array.
Each rule MUST have:
- rule_id: exact ID from the rules list
- rule_text: full rule name + description
- followed: boolean (true/false)
- evidence: grounded proof (quotes, line numbers, actions)

Focus on communication patterns, not code. Evaluate whether checking-in followed best practices AND rules.`
}
