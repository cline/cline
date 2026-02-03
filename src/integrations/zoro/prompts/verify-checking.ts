export function getCheckingWithUserVerificationPrompt(
	stepDescription: string,
	rules: Array<{ rule_id: string; name: string; description: string }>,
	chatHistory: string,
): string {
	return `# Task: Verify Checking-With-User Step Completion

## STEP TO VERIFY:
${stepDescription}

## RECENT CHAT HISTORY:
${chatHistory}

## 🔍 VERIFICATION STEPS - FOLLOW IN ORDER

**You MUST complete these steps before providing your verdict:**

1. **Extract all Q&A rounds**: Go through RECENT CHAT HISTORY and identify each round of questions
   - Count how many questions were asked per round
   - Extract exact questions and user responses
   
2. **Check question quality**: Were questions clarifying and meaningful?
   - Did they address ambiguities in requirements?
   - Were there 2-3 questions per round?
   
3. **Verify user engagement**: Did user provide substantive answers?
   - Were answers complete or partial?
   - Did user express satisfaction or confusion?
   
4. **Check explicit approval**: Was final confirmation obtained?
   - Look for: "Sounds good", "Yes", "Approved", etc.
   - NOT: Assumed approval without confirmation
   
5. **Verify requirements capture**: Was a final requirements checklist created?
   - Check if requirements were saved to node.output
   
6. **Check rule compliance**: For EACH rule below, verify if followed
   - Use evidence from chat history

**⚠️ CRITICAL: Extract ALL questions and answers from chat history. Don't summarize - show the actual conversation!**

## 📋 RULES TO CHECK (CHECK EVERY SINGLE ONE)

Apply these rules during step 6 above:

${rules.map((r, i) => `${i + 1}. [${r.rule_id}] ${r.name}: ${r.description}`).join("\n")}

**RULE VERIFICATION:**
- **followed**: Assistant explicitly followed this rule during checking-in
- **violated**: Assistant ignored or contradicted this rule  
- **not_applicable**: This rule doesn't apply to checking-with-user

**CRITICAL:** You MUST check ALL ${rules.length} rules. No shortcuts!

## VERIFICATION CRITERIA:

### 1. COMMUNICATION QUALITY
Good checking = iterative clarification until confident
- Asked 2-3 clarifying questions per round
- Sought explicit user confirmation
- Resolved ambiguities iteratively
- Obtained user satisfaction

### 2. RULE COMPLIANCE
Check EVERY rule in the list above with concrete evidence from chat

## 🛠️ AVAILABLE TOOLS

Tools are less relevant for this node type, but available if needed:
- **read_file**: Read plan or requirements files if referenced
- **search_files**: Search for related conversations

## Instructions - EXTRACT FROM CHAT HISTORY

⚠️ **DO NOT JUST RESPOND - EXTRACT THE ACTUAL Q&A**

### Phase 1: Extract Q&A Rounds

Go through the chat history and extract ALL rounds of questions and answers:
- Identify each round where Cline asked questions
- Extract the exact questions asked
- Extract the user's exact responses

### Phase 2: Build Verdict

After extracting the complete conversation, provide your JSON verdict.

**START NOW by extracting all Q&A rounds from the chat history!**

## 📤 OUTPUT FORMAT

**CRITICAL**: The overview must extract ALL clarifying questions asked by Cline and ALL user responses from RECENT CHAT HISTORY. Show the complete conversation flow round-by-round, then include the final requirements output.

Return ONLY a JSON object with this exact structure:
{
  "verdict": "done" | "not_done" | "partial" | "unclear",
  "overview": "## Requirements Clarification Summary\n\n[Extract ALL rounds of Q&A from RECENT CHAT HISTORY]\n\n### Round 1\n**Cline asked:**\n- Question 1?\n- Question 2?\n- Question 3?\n\n**User answered:**\n- Answer 1\n- Answer 2\n- Answer 3\n\n### Round 2\n**Cline asked:**\n- Question 4?\n\n**User answered:**\n- Answer 4\n\n[Continue for all rounds...]\n\n### Final Requirements\n[Show the complete requirements checklist + user story saved to node.output]",
  "rules_analysis": [
    {
      "rule_id": "${rules[0]?.rule_id || "rule-id"}",
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
