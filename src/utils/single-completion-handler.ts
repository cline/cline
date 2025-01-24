import { ApiConfiguration } from "../shared/api"
import { buildApiHandler, SingleCompletionHandler } from "../api"

/**
 * Enhances a prompt using the configured API without creating a full Cline instance or task history.
 * This is a lightweight alternative that only uses the API's completion functionality.
 */
export async function singleCompletionHandler(apiConfiguration: ApiConfiguration, promptText: string): Promise<string> {
	if (!promptText) {
		throw new Error("No prompt text provided")
	}
	if (!apiConfiguration || !apiConfiguration.apiProvider) {
		throw new Error("No valid API configuration provided")
	}

	const handler = buildApiHandler(apiConfiguration)

	// Check if handler supports single completions
	if (!("completePrompt" in handler)) {
		throw new Error("The selected API provider does not support prompt enhancement")
	}

	return (handler as SingleCompletionHandler).completePrompt(promptText)
}
