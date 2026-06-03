// Cline SDK `ApiHandler` (from `@cline/llms`) backed by the VS Code Language
// Model API (`vscode.lm`). Registered via `registerHandler("vscode-lm", ...)`
// (see ./register-vscode-lm.ts) so the SDK routes "vscode-lm" inference here.
//
// Model selection: the SDK `ProviderConfig` has no field for a VS Code LM
// selector, so the selector travels as a `vendor/family[/version/id]` string in
// `ProviderConfig.modelId` (the model-id channel the rest of the SDK adapter
// uses) and is parsed back into a `LanguageModelChatSelector` here. See
// parseVsCodeLmSelector / apps/vscode/src/shared/vsCodeSelectorUtils.ts.

import type {
	ApiHandler,
	ApiStreamChunk,
	HandlerModelInfo,
	Message,
	ProviderConfig,
	ToolDefinition,
} from "@cline/llms";
import { nanoid } from "nanoid";
import * as vscode from "vscode";
import { Logger } from "@/shared/services/Logger";
import {
	parseVsCodeLmModelSelector,
	SELECTOR_SEPARATOR,
} from "@/shared/vsCodeSelectorUtils";
import { convertToVsCodeLmMessages } from "./vscode-lm-format";

const FALLBACK_CONTEXT_WINDOW = 128_000;

/**
 * Parse a stringified VS Code LM selector (`vendor/family[/version/id]`) back
 * into a `LanguageModelChatSelector`. Only `vendor` and `family` are produced by
 * the model picker today; extra segments map to version/id positionally to mirror
 * `stringifyVsCodeLmModelSelector`.
 */
export function parseVsCodeLmSelector(
	modelId: string | undefined,
): vscode.LanguageModelChatSelector {
	return parseVsCodeLmModelSelector(modelId);
}

function extractText(message: vscode.LanguageModelChatMessage): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	if (Array.isArray(message.content)) {
		return message.content
			.filter(
				(part): part is vscode.LanguageModelTextPart =>
					part instanceof vscode.LanguageModelTextPart,
			)
			.map((part) => part.value)
			.join("");
	}
	return "";
}

export class VsCodeLmHandler implements ApiHandler {
	private readonly selector: vscode.LanguageModelChatSelector;
	private client: vscode.LanguageModelChat | null = null;
	private currentRequestCancellation: vscode.CancellationTokenSource | null =
		null;
	private abortSignal: AbortSignal | undefined;

	constructor(config: ProviderConfig) {
		this.selector = parseVsCodeLmSelector(config.modelId);
		this.abortSignal = config.abortSignal;
	}

	setAbortSignal(signal: AbortSignal | undefined): void {
		this.abortSignal = signal;
	}

	abort(): void {
		this.ensureCleanState();
	}

	private ensureCleanState(): void {
		if (this.currentRequestCancellation) {
			this.currentRequestCancellation.cancel();
			this.currentRequestCancellation.dispose();
			this.currentRequestCancellation = null;
		}
	}

	private async getClient(): Promise<vscode.LanguageModelChat> {
		if (this.client) {
			return this.client;
		}
		try {
			const models = await vscode.lm.selectChatModels(this.selector);
			if (models && models.length > 0) {
				this.client = models[0];
				return this.client;
			}
			throw new Error(
				`No VS Code language model matched selector ${JSON.stringify(this.selector)}. Ensure GitHub Copilot (or another LM provider) is installed and the model is enabled.`,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			throw new Error(
				`Cline <Language Model API>: Failed to select model: ${message}`,
			);
		}
	}

	getMessages(
		systemPrompt: string,
		messages: Message[],
	): vscode.LanguageModelChatMessage[] {
		return [
			vscode.LanguageModelChatMessage.Assistant(systemPrompt),
			...convertToVsCodeLmMessages(messages),
		];
	}

	// VS Code LM does not expose a tokenizer cheaply; approximate (chars/4),
	// matching the legacy handler. Good enough for budgeting/usage display.
	private approxTokens(text: string): number {
		return Math.ceil((text || "").length / 4);
	}

	async *createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): AsyncGenerator<ApiStreamChunk> {
		this.ensureCleanState();
		const client = await this.getClient();
		const id = nanoid();

		const vsCodeLmMessages = this.getMessages(systemPrompt, messages);
		const inputTokens = vsCodeLmMessages.reduce(
			(sum, msg) => sum + this.approxTokens(extractText(msg)),
			0,
		);

		this.currentRequestCancellation = new vscode.CancellationTokenSource();
		if (this.abortSignal) {
			if (this.abortSignal.aborted) {
				this.currentRequestCancellation.cancel();
			} else {
				this.abortSignal.addEventListener(
					"abort",
					() => this.currentRequestCancellation?.cancel(),
					{ once: true },
				);
			}
		}

		let accumulatedText = "";

		try {
			const requestOptions: vscode.LanguageModelChatRequestOptions = {
				justification: `Cline would like to use '${client.name}' from '${client.vendor}', Click 'Allow' to proceed.`,
			};

			// Native tool calling: the VS Code LM API (finalized in VS Code 1.95)
			// accepts tool definitions on the request and streams back
			// LanguageModelToolCallPart for invocations. Map the SDK's
			// ToolDefinition[] onto vscode.LanguageModelChatTool[]; tool RESULTS are
			// already round-tripped as LanguageModelToolResultPart by
			// convertToVsCodeLmMessages. We use "Auto" tool mode so the model
			// decides when to call tools (vs. forcing a call).
			if (tools && tools.length > 0) {
				requestOptions.tools = tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
				}));
				requestOptions.toolMode = vscode.LanguageModelChatToolMode.Auto;
			}

			const response = await client.sendRequest(
				vsCodeLmMessages,
				requestOptions,
				this.currentRequestCancellation.token,
			);

			for await (const chunk of response.stream) {
				if (chunk instanceof vscode.LanguageModelTextPart) {
					if (typeof chunk.value !== "string") {
						continue;
					}
					accumulatedText += chunk.value;
					const textChunk: ApiStreamChunk = {
						type: "text",
						text: chunk.value,
						id,
					};
					yield textChunk;
				} else if (chunk instanceof vscode.LanguageModelToolCallPart) {
					// A tool invocation from the model. callId/name/input come straight
					// from the API (input is already a parsed object); forward them as a
					// tool-call chunk for the SDK runtime to execute.
					if (!chunk.name || !chunk.callId || !chunk.input) {
						continue;
					}
					const toolCallChunk: ApiStreamChunk = {
						type: "tool_calls",
						id,
						tool_call: {
							call_id: chunk.callId,
							function: {
								id: chunk.callId,
								name: chunk.name,
								arguments: chunk.input as Record<string, unknown>,
							},
						},
					};
					// Approximate output token accounting still wants the tool call's
					// size; serialize for the estimate without affecting the chunk.
					accumulatedText += JSON.stringify({
						name: chunk.name,
						input: chunk.input,
						callId: chunk.callId,
					});
					yield toolCallChunk;
				}
			}

			const usageChunk: ApiStreamChunk = {
				type: "usage",
				inputTokens,
				outputTokens: this.approxTokens(accumulatedText),
				totalCost: 0,
				id,
			};
			yield usageChunk;
		} catch (error) {
			this.ensureCleanState();
			if (error instanceof vscode.CancellationError) {
				throw new Error(
					"Cline <Language Model API>: Request cancelled by user",
				);
			}
			if (error instanceof Error) {
				Logger.error("Cline <Language Model API>: Stream error:", error);
				throw error;
			}
			throw new Error(
				`Cline <Language Model API>: Response stream error: ${String(error)}`,
			);
		} finally {
			this.ensureCleanState();
		}
	}

	getModel(): HandlerModelInfo {
		if (this.client) {
			const modelParts = [
				this.client.vendor,
				this.client.family,
				this.client.version,
			].filter(Boolean);
			const modelId = this.client.id || modelParts.join(SELECTOR_SEPARATOR);
			const contextWindow =
				typeof this.client.maxInputTokens === "number" &&
				this.client.maxInputTokens > 0
					? this.client.maxInputTokens
					: FALLBACK_CONTEXT_WINDOW;
			return {
				id: modelId,
				info: {
					id: modelId,
					contextWindow,
					maxInputTokens: contextWindow,
					maxTokens: -1,
					description: `VSCode Language Model: ${modelId}`,
				},
			};
		}

		// No client yet (e.g. getModel() called before createMessage()).
		const fallbackId =
			[
				this.selector.vendor,
				this.selector.family,
				this.selector.version,
				this.selector.id,
			]
				.filter(Boolean)
				.join(SELECTOR_SEPARATOR) || "vscode-lm";
		return {
			id: fallbackId,
			info: {
				id: fallbackId,
				contextWindow: FALLBACK_CONTEXT_WINDOW,
				maxInputTokens: FALLBACK_CONTEXT_WINDOW,
				maxTokens: -1,
				description: `VSCode Language Model (Fallback): ${fallbackId}`,
			},
		};
	}
}
