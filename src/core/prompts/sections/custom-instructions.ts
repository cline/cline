import fs from "fs/promises"
import path from "path"

export async function loadRuleFiles(cwd: string): Promise<string> {
	const ruleFiles = [".clinerules", ".cursorrules", ".windsurfrules"]
	let combinedRules = ""

	for (const file of ruleFiles) {
		try {
			const content = await fs.readFile(path.join(cwd, file), "utf-8")
			if (content.trim()) {
				combinedRules += `\n# Rules from ${file}:\n${content.trim()}\n`
			}
		} catch (err) {
			// Silently skip if file doesn't exist
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				throw err
			}
		}
	}

	return combinedRules
}

export async function addCustomInstructions(
	modeCustomInstructions: string,
	globalCustomInstructions: string,
	cwd: string,
	mode: string,
	options: { preferredLanguage?: string } = {},
): Promise<string> {
	const sections = []

	// Load mode-specific rules if mode is provided
	let modeRuleContent = ""
	if (mode) {
		try {
			const modeRuleFile = `.clinerules-${mode}`
			const content = await fs.readFile(path.join(cwd, modeRuleFile), "utf-8")
			if (content.trim()) {
				modeRuleContent = content.trim()
			}
		} catch (err) {
			// Silently skip if file doesn't exist
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				throw err
			}
		}
	}

	// Add language preference if provided
	if (options.preferredLanguage) {
		sections.push(
			`Language Preference:\nYou should always speak and think in the ${options.preferredLanguage} language.`,
		)
	}

	// Add global instructions first
	if (typeof globalCustomInstructions === "string" && globalCustomInstructions.trim()) {
		sections.push(`Global Instructions:\n${globalCustomInstructions.trim()}`)
	}

	// Add mode-specific instructions after
	if (typeof modeCustomInstructions === "string" && modeCustomInstructions.trim()) {
		sections.push(`Mode-specific Instructions:\n${modeCustomInstructions.trim()}`)
	}

	// Add rules - include both mode-specific and generic rules if they exist
	const rules = []

	// Add mode-specific rules first if they exist
	if (modeRuleContent && modeRuleContent.trim()) {
		const modeRuleFile = `.clinerules-${mode}`
		rules.push(`# Rules from ${modeRuleFile}:\n${modeRuleContent}`)
	}

	// Add generic rules
	const genericRuleContent = await loadRuleFiles(cwd)
	if (genericRuleContent && genericRuleContent.trim()) {
		rules.push(genericRuleContent.trim())
	}

	if (rules.length > 0) {
		sections.push(`Rules:\n\n${rules.join("\n\n")}`)
	}

	const joinedSections = sections.join("\n\n")

	return joinedSections
		? `
====

USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user, and should be followed to the best of your ability without interfering with the TOOL USE guidelines.

${joinedSections}`
		: ""
}
