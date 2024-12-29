import { ApiConfiguration } from "../shared/api"
import { buildApiHandler } from "../api"
import { OpenRouterHandler } from "../api/providers/openrouter"

/**
 * Enhances a prompt using the OpenRouter API without creating a full Cline instance or task history.
 * This is a lightweight alternative that only uses the API's completion functionality.
 */
export async function enhancePrompt(apiConfiguration: ApiConfiguration, promptText: string): Promise<string> {
    if (!promptText) {
        throw new Error("No prompt text provided")
    }
    if (apiConfiguration.apiProvider !== "openrouter") {
        throw new Error("Prompt enhancement is only available with OpenRouter")
    }
    
    const handler = buildApiHandler(apiConfiguration)
    
    // Type guard to check if handler is OpenRouterHandler
    if (!(handler instanceof OpenRouterHandler)) {
        throw new Error("Expected OpenRouter handler")
    }
    
    const prompt = `Generate an enhanced version of this prompt (reply with only the enhanced prompt, no other text or bullet points): ${promptText}`
    return handler.completePrompt(prompt)
}