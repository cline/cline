export function getGenerateSubstepRequirementsPrompt(
	stepDescription: string,
	substepDescription: string,
	rules: Array<{ rule_id: string; name: string; description: string }>,
): string {
	return `You are generating a requirement checklist for verifying a substep implementation.

## PARENT STEP:
${stepDescription}

## SUBSTEP TO VERIFY:
${substepDescription}

## AVAILABLE RULES:
${rules.map((r, i) => `${i + 1}. [${r.rule_id}] ${r.name}: ${r.description}`).join("\n")}

## YOUR TASK:
Generate a comprehensive checklist of requirements that need to be verified for this substep.
Categorize each requirement into one of these types:

1. **feature** - Core functionality that must work (e.g., "JSON response returned", "Button clicks trigger action")
2. **rule** - Code quality/style rules from the rules list above (e.g., "No inline imports", "Consistent naming")
3. **integration** - How this substep integrates with existing code (e.g., "Visible on screen", "Endpoint is callable")
4. **edge** - Edge cases and error handling (e.g., "Handles missing parameters", "Returns 400 on invalid input")

## GUIDELINES:
- Be specific and testable (avoid vague requirements like "code works")
- Include 3-10 requirements per substep (don't overdo it). There should be 2-4 feature requirements, 2-4 rule requirements, 1-3 integration requirements, and 1-2 edge requirements. 
- Focus on what's ACTUALLY part of this substep (not the whole step or whole system)
- For rules: only include rules that are RELEVANT to this specific substep
- Each requirement should be independently verifiable

## OUTPUT FORMAT:
Return ONLY a JSON array of requirements. Do NOT include IDs (backend will assign them).

[
  {
    "description": "Specific, testable requirement",
    "category": "feature"
  },
  {
    "description": "Another requirement",
    "category": "rule"
  }
]

**IMPORTANT:**
- DO NOT include "id" field - backend assigns IDs
- DO NOT include "source" field - backend sets this to "auto"
- Each description should be a clear, actionable statement
- Focus on THIS substep only, not the entire project

Generate the requirements now:`
}
