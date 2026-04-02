import { resolveApiKeyForProvider } from "../runtime/auth";
import type { ApiStream, HandlerModelInfo, ProviderConfig } from "../types";
import { resolveRoutingProviderId } from "../types";
import type { ContentBlock, Message } from "../types/messages";
import { FetchBaseHandler } from "./fetch-base";

export const DEFAULT_ASKSAGE_BASE_URL = "https://api.asksage.ai/server";
const DEFAULT_ASKSAGE_MODEL_ID = "gpt-4o";

type AskSageRequest = {
	system_prompt: string;
	message: Array<{
		user: "gpt" | "me";
		message: string;
	}>;
	model: string;
	dataset: "none";
	usage: boolean;
};

type AskSageUsage = {
	model_tokens: {
		completion_tokens: number;
		prompt_tokens: number;
		total_tokens: number;
	};
	asksage_tokens: number;
};

type AskSageResponse = {
	message?: string;
	usage?: AskSageUsage | null;
	tool_responses?: unknown[];
};

export class AskSageHandler extends FetchBaseHandler {
	readonly type = "fetch";
	protected getDefaultBaseUrl(): string {
		return DEFAULT_ASKSAGE_BASE_URL;
	}

	getModel(): HandlerModelInfo {
		const modelId = this.config.modelId?.trim() || DEFAULT_ASKSAGE_MODEL_ID;
		const modelInfo = this.config.modelInfo ??
			this.config.knownModels?.[modelId] ?? {
				id: modelId,
				capabilities: ["tools"],
			};
		return { id: modelId, info: { ...modelInfo, id: modelId } };
	}

	protected getJsonHeaders(
		extra?: Record<string, string>,
	): Record<string, string> {
		const apiKey = resolveApiKeyForProvider(
			resolveRoutingProviderId(this.config),
			this.config.apiKey,
		);
		if (!apiKey) {
			throw new Error("AskSage API key is required");
		}
		return super.getJsonHeaders({
			"x-access-tokens": apiKey,
			...(extra ?? {}),
		});
	}

	protected async *createMessageWithFetch(
		systemPrompt: string,
		messages: Message[],
	): ApiStream {
		const responseId = this.createResponseId();
		const { id: modelId } = this.getModel();

		const payload: AskSageRequest = {
			system_prompt: systemPrompt,
			message: messages.map((message) => ({
				user: message.role === "assistant" ? "gpt" : "me",
				message: this.serializeMessageContent(message.content),
			})),
			model: modelId,
			dataset: "none",
			usage: true,
		};

		let result: AskSageResponse;
		try {
			result = await this.fetchJson<AskSageResponse>("/query", {
				method: "POST",
				body: payload,
			});
		} catch (error) {
			const details = error instanceof Error ? error.message : String(error);
			throw new Error(`AskSage request failed: ${details}`);
		}

		for (const toolResponse of result.tool_responses ?? []) {
			yield {
				type: "text",
				text: `[Tool Response: ${JSON.stringify(toolResponse)}]\n`,
				id: responseId,
			};
		}

		const text = result.message?.trim();
		if (!text) {
			throw new Error("AskSage request failed: no content in response");
		}

		yield { type: "text", text, id: responseId };

		if (result.usage) {
			yield {
				type: "usage",
				inputTokens: result.usage.model_tokens.prompt_tokens,
				outputTokens: result.usage.model_tokens.completion_tokens,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: result.usage.asksage_tokens,
				id: responseId,
			};
		}

		yield { type: "done", success: true, id: responseId };
	}

	private serializeMessageContent(content: string | ContentBlock[]): string {
		if (typeof content === "string") {
			return content;
		}
		return content
			.map((block) => ("text" in block ? block.text : ""))
			.join("")
			.trim();
	}
}

export function createAskSageHandler(config: ProviderConfig): AskSageHandler {
	return new AskSageHandler(config);
}
