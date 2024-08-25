import { Anthropic } from "@anthropic-ai/sdk"
import { countTokens } from "@anthropic-ai/tokenizer"

export function slidingWindowContextManagement(
	contextWindow: number,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	tools: Anthropic.Messages.Tool[]
): Anthropic.Messages.MessageParam[] {
	const adjustedContextWindow = contextWindow - 10000 // Buffer to account for tokenizer differences
	const systemPromptTokens = countTokens(systemPrompt)
	const toolsTokens = countTokens(JSON.stringify(tools))
	let availableTokens = adjustedContextWindow - systemPromptTokens - toolsTokens
	let totalMessageTokens = messages.reduce((sum, message) => sum + countMessageTokens(message), 0)

	if (totalMessageTokens <= availableTokens) {
		return messages
	}

	// If over limit, remove messages starting from the third message onwards (task and claude's step-by-step thought process are important to keep in context)
	const newMessages = [...messages]
	while (totalMessageTokens > availableTokens && newMessages.length > 2) {
		const removedMessage = newMessages.splice(2, 1)[0]
		const removedTokens = countMessageTokens(removedMessage)
		totalMessageTokens -= removedTokens
	}

	if (totalMessageTokens > availableTokens) {
		// Over the limit due to the first two messages
		throw new Error("Task exceeds available context window")
	}

	return newMessages
}

function countMessageTokens(message: Anthropic.Messages.MessageParam): number {
	if (typeof message.content === "string") {
		return countTokens(message.content)
	} else {
		return countTokens(JSON.stringify(message.content))
	}
}
