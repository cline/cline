import type * as LlmsProviders from "@clinebot/llms";
import { createHandler } from "@clinebot/llms";
import type { BasicLogger } from "@clinebot/shared";
import type {
	CoreCompactionContext,
	CoreCompactionResult,
	CoreCompactionSummarizerConfig,
} from "../../types/config";
import {
	buildSummaryMessage,
	buildSummaryRequest,
	type EstimateMessageTokens,
	ensureFilesSection,
	extractFileOps,
	findCutIndex,
	findLatestSummaryIndex,
	getCompactionSummaryMetadata,
	resolveSummarizerConfig,
	serializeConversation,
} from "./compaction-shared";

async function generateSummary(options: {
	providerConfig: LlmsProviders.ProviderConfig;
	request: string;
	logger?: BasicLogger;
}): Promise<string> {
	const handler = createHandler(options.providerConfig);
	let text = "";
	for await (const chunk of handler.createMessage(
		"Summarize the provided coding session into a concise continuation note with detailed next steps.",
		[{ role: "user", content: options.request }],
	)) {
		if (chunk.type === "text") {
			text += chunk.text;
			continue;
		}
		if (chunk.type === "done" && !chunk.success && chunk.error) {
			throw new Error(chunk.error);
		}
	}
	options.logger?.debug?.("Generated compaction summary", {
		outputChars: text.length,
		modelId: options.providerConfig.modelId,
		providerId: options.providerConfig.providerId,
	});
	return text.trim();
}

export async function runAgenticCompaction(options: {
	context: CoreCompactionContext;
	providerConfig: LlmsProviders.ProviderConfig;
	summarizer?: CoreCompactionSummarizerConfig;
	preserveRecentTokens: number;
	estimateMessageTokens: EstimateMessageTokens;
	logger?: BasicLogger;
}): Promise<CoreCompactionResult | undefined> {
	const messages = options.context.messages;
	if (messages.length < 2) {
		return undefined;
	}

	const cutIndex = findCutIndex(
		messages,
		options.preserveRecentTokens,
		options.estimateMessageTokens,
	);
	if (cutIndex <= 0 || cutIndex >= messages.length) {
		return undefined;
	}

	const messagesToSummarize = messages.slice(0, cutIndex);
	const latestSummaryIndex = findLatestSummaryIndex(messagesToSummarize);
	const previousSummary =
		latestSummaryIndex >= 0
			? getCompactionSummaryMetadata(messagesToSummarize[latestSummaryIndex])
					?.summary
			: undefined;
	const newMessagesToFold =
		latestSummaryIndex >= 0
			? messagesToSummarize.slice(latestSummaryIndex + 1)
			: messagesToSummarize;
	if (newMessagesToFold.length === 0) {
		return undefined;
	}

	const fileOps = extractFileOps(messagesToSummarize);
	const conversationText = serializeConversation(newMessagesToFold);
	const rawSummary = await generateSummary({
		providerConfig: resolveSummarizerConfig({
			activeProviderConfig: options.providerConfig,
			summarizer: options.summarizer,
		}),
		request: buildSummaryRequest({
			previousSummary,
			conversationText,
			fileOps,
		}),
		logger: options.logger,
	});
	if (!rawSummary.trim()) {
		return undefined;
	}

	const summary = ensureFilesSection(rawSummary, fileOps);
	const tokensBefore = messages.reduce(
		(total, message) => total + options.estimateMessageTokens(message),
		0,
	);
	return {
		messages: [
			buildSummaryMessage({
				summary,
				fileOps,
				tokensBefore,
			}),
			...messages.slice(cutIndex),
		],
	};
}
