import * as fs from "node:fs/promises"
import * as path from "node:path"
import { StringArray, type EmptyRequest } from "@shared/proto/cline/common"
import { getWorkspacePath } from "@/utils/path"
import type { Controller } from ".."

/**
 * Gets the list of currently applied prompt IDs by scanning workspace directories
 */
export async function getAppliedPrompts(_controller: Controller, _request: EmptyRequest): Promise<StringArray> {
	const appliedPromptIds: string[] = []

	try {
		const workspaceRoot = await getWorkspacePath()
		if (!workspaceRoot) {
			return { values: [] }
		}

		// Check .clinerules directory
		const clnerulesDir = path.join(workspaceRoot, ".clinerules")
		try {
			const clinerulesFiles = await fs.readdir(clnerulesDir)
			for (const file of clinerulesFiles) {
				if (file.endsWith(".md")) {
					// Extract prompt ID from filename (kebab-case name)
					const promptId = file.replace(".md", "")
					appliedPromptIds.push(promptId)
				}
			}
		} catch (error) {
			// Directory doesn't exist or can't be read, skip
		}

		// Check workflows directory
		const workflowsDir = path.join(workspaceRoot, "workflows")
		try {
			const workflowFiles = await fs.readdir(workflowsDir)
			for (const file of workflowFiles) {
				if (file.endsWith(".md")) {
					// Extract prompt ID from filename (kebab-case name)
					const promptId = file.replace(".md", "")
					appliedPromptIds.push(promptId)
				}
			}
		} catch (error) {
			// Directory doesn't exist or can't be read, skip
		}
	} catch (error) {
		console.error("Error getting applied prompts:", error)
	}

	return StringArray.create({ values: appliedPromptIds })
}
