import * as path from "path"
import * as vscode from "vscode"
import { promises as fs } from "fs"
import { ModeConfig, getAllModesWithPrompts } from "../../../shared/modes"
import { GlobalFileNames } from "../../../shared/globalFileNames"

export async function getModesSection(context: vscode.ExtensionContext): Promise<string> {
	const settingsDir = path.join(context.globalStorageUri.fsPath, "settings")
	await fs.mkdir(settingsDir, { recursive: true })

	// Get all modes with their overrides from extension state
	const allModes = await getAllModesWithPrompts(context)

	// Get enableCustomModeCreation setting from extension state
	const shouldEnableCustomModeCreation = (await context.globalState.get<boolean>("enableCustomModeCreation")) ?? true

	let modesContent = `====

MODES

- These are the currently available modes:
${allModes.map((mode: ModeConfig) => `  * "${mode.name}" mode (${mode.slug}) - ${mode.roleDefinition.split(".")[0]}`).join("\n")}`

	// Only include custom modes documentation if the feature is enabled
	if (shouldEnableCustomModeCreation) {
		modesContent += `
If the user asks you to create or edit a new mode for this project, you can get instructions using the fetch_instructions tool, like this:
<fetch_instructions>
<task>create_mode</task>
</fetch_instructions>
`
	}

	return modesContent
}
