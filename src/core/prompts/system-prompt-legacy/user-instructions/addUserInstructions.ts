export function addUserInstructions(
	globalClineRulesFileInstructions?: string,
	localClineRulesFileInstructions?: string,
	localCursorRulesFileInstructions?: string,
	localCursorRulesDirInstructions?: string,
	localWindsurfRulesFileInstructions?: string,
	clineIgnoreInstructions?: string,
	preferredLanguageInstructions?: string,
) {
	let customInstructions = ""
	if (preferredLanguageInstructions) {
		customInstructions += preferredLanguageInstructions + "\n\n"
	}
	if (globalClineRulesFileInstructions) {
		customInstructions += globalClineRulesFileInstructions + "\n\n"
	}
	if (localClineRulesFileInstructions) {
		customInstructions += localClineRulesFileInstructions + "\n\n"
	}
	if (localCursorRulesFileInstructions) {
		customInstructions += localCursorRulesFileInstructions + "\n\n"
	}
	if (localCursorRulesDirInstructions) {
		customInstructions += localCursorRulesDirInstructions + "\n\n"
	}
	if (localWindsurfRulesFileInstructions) {
		customInstructions += localWindsurfRulesFileInstructions + "\n\n"
	}
	if (clineIgnoreInstructions) {
		customInstructions += clineIgnoreInstructions
	}

	return `
====

USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user, and should be followed to the best of your ability without interfering with the TOOL USE guidelines.

${customInstructions.trim()}`
}
