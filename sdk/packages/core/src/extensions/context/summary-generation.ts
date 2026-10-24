import { createHandlerAsync } from "@cline/llms";
import type { ProviderConfig } from "../../types/provider-settings";

export async function generateSummary(options: {
	providerConfig: ProviderConfig;
	systemPrompt: string;
	request: string;
	maxOutputChars?: number;
	signal?: AbortSignal;
}) {
	options.signal?.throwIfAborted();
	const handler = await createHandlerAsync(
		options.signal
			? { ...options.providerConfig, abortSignal: options.signal }
			: options.providerConfig,
	);
	options.signal?.throwIfAborted();
	let text = "";
	let reasoningChars = 0;
	let failed = false;
	let usedTools = false;
	let incompleteReason: string | undefined;
	for await (const chunk of handler.createMessage(options.systemPrompt, [
		{ role: "user", content: options.request },
	])) {
		options.signal?.throwIfAborted();
		if (chunk.type === "text") {
			text += chunk.text;
			if (options.maxOutputChars && text.length > options.maxOutputChars) {
				throw new Error("Summary exceeded its output limit.");
			}
		} else if (chunk.type === "reasoning") {
			reasoningChars += chunk.reasoning?.length ?? 0;
		} else if (chunk.type === "done") {
			if (!chunk.success && chunk.error) throw new Error(chunk.error);
			incompleteReason = chunk.incompleteReason ?? incompleteReason;
			failed ||= !chunk.success;
		} else if (chunk.type === "tool_calls") {
			usedTools = true;
		}
	}
	options.signal?.throwIfAborted();
	// Handlers may finish normally without emitting an optional done chunk.
	return { text, reasoningChars, failed, usedTools, incompleteReason };
}
