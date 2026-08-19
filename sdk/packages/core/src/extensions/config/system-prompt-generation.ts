import { createHandlerAsync } from "@cline/llms";
import type { BasicLogger } from "@cline/shared";
import type { ProviderConfig } from "../../types/provider-settings";

const SYSTEM_PROMPT_GENERATION_INSTRUCTION =
	"Write a clear, effective system prompt for an AI coding agent, based on " +
	"the following description of what it should do. Return only the system " +
	"prompt itself - no preamble, no markdown code fences, no explanation of " +
	"what you wrote.";

/**
 * One-off "ask the model, get text back" call that turns a plain-English
 * description of a bot's purpose into a system prompt - modeled directly on
 * `generateSummary` in `../context/agentic-compaction.ts`, the closest
 * existing precedent for this shape of call (create a handler, stream a
 * single completion, collect the text).
 */
export async function generateSystemPromptFromDescription(options: {
	providerConfig: ProviderConfig;
	description: string;
	logger?: BasicLogger;
}): Promise<string> {
	const handler = await createHandlerAsync(options.providerConfig);
	let text = "";
	for await (const chunk of handler.createMessage(
		SYSTEM_PROMPT_GENERATION_INSTRUCTION,
		[{ role: "user", content: options.description }],
	)) {
		if (chunk.type === "text") {
			text += chunk.text;
			continue;
		}
		if (chunk.type === "done" && !chunk.success && chunk.error) {
			throw new Error(chunk.error);
		}
	}
	options.logger?.debug("Generated bot system prompt", {
		outputChars: text.length,
		modelId: options.providerConfig.modelId,
		providerId: options.providerConfig.providerId,
	});
	return text.trim();
}
