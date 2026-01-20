/**
 * Prompt string builder for chat REPL
 *
 * Builds the CLI prompt that shows current mode, provider, and model.
 */

import type { ApiProvider } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import chalk from "chalk"

/**
 * Build the CLI prompt string with mode, provider, and model
 * Format: [mode] provider/model >
 */
export function buildPromptString(mode: Mode, provider: ApiProvider | undefined, modelId: string | undefined): string {
	const modeStr = mode === "plan" ? chalk.magenta("[plan]") : chalk.cyan("[act]")
	const providerStr = provider || "unknown"

	// Shorten very long model IDs for display (keep last part after last /)
	let modelStr = modelId || "unknown"
	if (modelStr.length > 40) {
		const lastSlash = modelStr.lastIndexOf("/")
		if (lastSlash > 0 && lastSlash < modelStr.length - 1) {
			modelStr = "..." + modelStr.substring(lastSlash)
		} else {
			modelStr = modelStr.substring(0, 37) + "..."
		}
	}

	const providerModelStr = chalk.dim(`${providerStr}/${modelStr}`)

	return `${modeStr} ${providerModelStr} ${chalk.white(">")} `
}
