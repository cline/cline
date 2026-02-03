export function getVerifySubstepRequirementsPrompt(
	stepDescription: string,
	substepDescription: string,
	requirements: Array<{ id: string; description: string; category: string; source: string }>,
	chatHistory: string,
): string {
	return `Verify ALL of these requirements for the substep.

## PARENT STEP:
${stepDescription}

## SUBSTEP TO VERIFY:
${substepDescription}

## REQUIREMENTS TO VERIFY:
${requirements
	.map(
		(r, i) => `${i + 1}. [${r.id}] ${r.description}
   Category: ${r.category}
   Source: ${r.source}`,
	)
	.join("\n\n")}

## CHAT HISTORY:
${chatHistory}

## YOUR TASK:
Use tools to investigate the code changes and determine if EACH requirement is satisfied.
For each requirement, gather concrete evidence from:
- Code snippets showing the requirement is implemented
- File changes that fulfill the requirement
- Specific examples from the codebase

Be thorough in your investigation before making your final assessment.`
}