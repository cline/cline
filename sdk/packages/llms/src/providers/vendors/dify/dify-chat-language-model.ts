/*!
 * Vendored from dify-ai-provider v1.1.1 (https://github.com/warmwind/dify-ai-provider,
 * commit 352943be697b89cf1a4d329e11b53c1f19e4286d), (c) 2024 Oscar Jiang, MIT
 * license (see ./LICENSE). Changes for @ai-sdk/provider-utils 5 and zod 4 are
 * listed in ./README.md.
 */
import {
	APICallError,
	type JSONValue,
	type LanguageModelV2,
	type LanguageModelV2CallOptions,
	type LanguageModelV2Content,
	type LanguageModelV2FinishReason,
	type LanguageModelV2StreamPart,
} from "@ai-sdk/provider";
import {
	combineHeaders,
	createEventSourceResponseHandler,
	createJsonErrorResponseHandler,
	createJsonResponseHandler,
	type FetchFunction,
	generateId,
	type ParseResult,
	postJsonToApi,
} from "@ai-sdk/provider-utils";
import type { z } from "zod";
import type { DifyStreamEvent } from "./dify-chat-schema";
import {
	completionResponseSchema,
	difyStreamEventSchema,
	errorResponseSchema,
} from "./dify-chat-schema";
import {
	type DifyChatModelId,
	type DifyChatSettings,
	defaultLogger,
	type Logger,
} from "./dify-chat-settings";
import {
	extractFileAttachments,
	formatToolsPrompt,
	parseToolCalls,
	ThinkTagParser,
} from "./stream-parser";

function formatSystemPrompt(raw: string): string {
	if (!raw) return "";
	const trimmed = raw.trim();

	// Detect structured prompt format
	const envTagMatch = trimmed.match(/<env>([\s\S]*?)<\/env>/);
	const dirsTagMatch = trimmed.match(/<directories>([\s\S]*?)<\/directories>/);
	const identityMatch = trimmed.match(/^You are\b[^.]*\./m);

	if (envTagMatch || identityMatch || dirsTagMatch) {
		const parts: string[] = [];

		if (identityMatch) {
			parts.push(identityMatch[0]);
		}

		if (envTagMatch) {
			parts.push(`<env>${envTagMatch[1]}</env>`);
		}

		if (dirsTagMatch) {
			parts.push(`<directories>${dirsTagMatch[1]}</directories>`);
		}

		return parts.join("\n\n\n\n");
	}

	return trimmed;
}

type CompletionResponse = z.infer<typeof completionResponseSchema>;
type ErrorResponse = z.infer<typeof errorResponseSchema>;

interface ModelConfig {
	provider: string;
	baseURL: string;
	headers: () => Record<string, string>;
	fetch?: FetchFunction;
}

/** Content part for multimodal messages (text or tool-result). */
interface MessageContentPart {
	type?: string;
	text?: string;
	toolName?: string;
	output?: unknown;
	result?: unknown;
	content?: unknown;
	providerMetadata?: { difyWorkflowData?: { conversationId?: string } };
	callProviderMetadata?: { difyWorkflowData?: { conversationId?: string } };
}

interface Message {
	role: string;
	content: string | MessageContentPart[];
	[key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringField(
	record: Record<string, unknown>,
	keys: string[],
): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value) return value;
	}
	return undefined;
}

function buildRetrieverResourceSources(
	resources: unknown,
	metadata: Record<string, JSONValue>,
): LanguageModelV2StreamPart[] {
	if (!Array.isArray(resources)) return [];

	return resources.map((resource, index) => {
		const record = isRecord(resource) ? resource : {};
		const id =
			getStringField(record, ["segment_id", "document_id", "id"]) ??
			`retriever-resource-${index + 1}`;
		const title =
			getStringField(record, [
				"document_name",
				"title",
				"dataset_name",
				"segment_id",
				"id",
			]) ?? `Retriever resource ${index + 1}`;
		const filename = getStringField(record, ["document_name", "filename"]);

		return {
			type: "source",
			sourceType: "document",
			id,
			mediaType: "text/plain",
			title,
			...(filename ? { filename } : {}),
			providerMetadata: {
				difyWorkflowData: {
					...metadata,
					retrieverResource: resource as JSONValue,
				},
			},
		};
	});
}

export class DifyChatLanguageModel implements LanguageModelV2 {
	readonly specificationVersion = "v2" as const;
	readonly modelId: string;
	readonly supportedUrls: Record<string, RegExp[]> = {};

	private readonly generateId: () => string;
	private readonly chatMessagesEndpoint: string;
	private readonly config: ModelConfig;
	private readonly logger?: Logger;

	constructor(
		modelId: DifyChatModelId,
		private settings: DifyChatSettings,
		config: ModelConfig,
	) {
		this.modelId = modelId;
		this.config = config;
		this.generateId = generateId;
		this.chatMessagesEndpoint = `${this.config.baseURL}/chat-messages`;
		this.logger =
			settings.logger === false
				? undefined
				: (settings.logger ?? defaultLogger);

		// Make sure we set a default response mode
		if (!this.settings.responseMode) {
			this.settings.responseMode = "streaming";
		}
	}

	private createErrorHandler() {
		return createJsonErrorResponseHandler({
			errorSchema: errorResponseSchema as any,
			errorToMessage: (data: ErrorResponse) => {
				this.logger?.error("Dify API error", data);
				return `Dify API error: ${data.message}`;
			},
		});
	}

	get provider(): string {
		return this.config.provider;
	}

	async doGenerate(
		options: LanguageModelV2CallOptions,
	): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
		const { abortSignal } = options;
		const {
			body: requestBody,
			toolNames,
			requestHeaders,
		} = await this.getRequestBody(options);

		// Force blocking mode for doGenerate unless explicitly handled otherwise
		const body = { ...requestBody, response_mode: "blocking" };

		if (this.settings.logMessages) {
			this.logger?.info("", { body });
		}

		const { responseHeaders, value: data } = await postJsonToApi({
			url: this.chatMessagesEndpoint,
			headers: combineHeaders(
				this.config.headers(),
				requestHeaders ?? options.headers,
			),
			body,
			abortSignal,
			failedResponseHandler: this.createErrorHandler(),
			successfulResponseHandler: createJsonResponseHandler(
				completionResponseSchema as any,
			),
			fetch: this.config.fetch,
		});

		const typedData = data as CompletionResponse;
		if (this.settings.logMessages) {
			this.logger?.info("", {
				answer: typedData.answer,
				conversation_id: typedData.conversation_id,
			});
		}
		const content: LanguageModelV2Content[] = [];

		// Parse tool calls from answer text
		if (typedData.answer) {
			const { toolCalls, cleanText } = parseToolCalls(
				typedData.answer,
				toolNames,
				this.generateId,
			);

			if (cleanText) {
				content.push({ type: "text", text: cleanText });
			}

			for (const tc of toolCalls) {
				content.push({
					type: "tool-call",
					toolCallId: tc.id,
					toolName: tc.name,
					input: tc.input,
				});
			}
		}

		const hasToolCalls = content.some((c) => c.type === "tool-call");

		return {
			content,
			finishReason: (hasToolCalls
				? "tool-calls"
				: "stop") as LanguageModelV2FinishReason,
			usage: {
				inputTokens: typedData.metadata.usage.prompt_tokens,
				outputTokens: typedData.metadata.usage.completion_tokens,
				totalTokens: typedData.metadata.usage.total_tokens,
			},
			warnings: [],
			providerMetadata: {
				difyWorkflowData: {
					conversationId: typedData.conversation_id as JSONValue,
					messageId: typedData.message_id as JSONValue,
				},
			},
			request: { body: JSON.stringify(body) },
			response: {
				id: typedData.id,
				timestamp: new Date(),
				headers: responseHeaders,
			},
		};
	}

	async doStream(
		options: LanguageModelV2CallOptions,
	): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
		if (this.settings.logMessages) {
			this.logger?.info("", { options });
		}
		const { abortSignal } = options;
		const {
			body: requestBody,
			toolNames,
			requestHeaders,
		} = await this.getRequestBody(options);
		const body = { ...requestBody, response_mode: "streaming" };

		if (this.settings.logMessages) {
			this.logger?.info("", { body });
		}

		const { responseHeaders, value: responseStream } = await postJsonToApi({
			url: this.chatMessagesEndpoint,
			headers: combineHeaders(
				this.config.headers(),
				requestHeaders ?? options.headers,
			),
			body,
			failedResponseHandler: this.createErrorHandler(),
			successfulResponseHandler: createEventSourceResponseHandler(
				difyStreamEventSchema as any,
			),
			abortSignal,
			fetch: this.config.fetch,
		});

		let conversationId: string | undefined;
		let messageId: string | undefined;
		let taskId: string | undefined;
		let isActiveText = false;
		let isActiveReasoning = false;
		const thinkParser = new ThinkTagParser();
		const genId = this.generateId;
		const logger = this.logger;
		const logMessages = this.settings.logMessages;

		function buildDifyWorkflowData() {
			const meta: Record<string, JSONValue> = {};
			if (conversationId) meta.conversationId = conversationId as JSONValue;
			if (messageId) meta.messageId = messageId as JSONValue;
			if (taskId) meta.taskId = taskId as JSONValue;
			return meta;
		}

		function buildDifyMetadata() {
			const meta = buildDifyWorkflowData();
			return Object.keys(meta).length
				? { providerMetadata: { difyWorkflowData: meta } }
				: {};
		}

		function emitSegments(
			segments: Array<{ type: string; content: string }>,
			controller: TransformStreamDefaultController<LanguageModelV2StreamPart>,
		) {
			for (const seg of segments) {
				if (seg.type === "reasoning") {
					if (isActiveText) {
						controller.enqueue({
							type: "text-end",
							id: "0",
							...buildDifyMetadata(),
						});
						isActiveText = false;
					}
					if (!isActiveReasoning) {
						isActiveReasoning = true;
						controller.enqueue({
							type: "reasoning-start",
							id: "r0",
							...buildDifyMetadata(),
						});
					}
					controller.enqueue({
						type: "reasoning-delta",
						id: "r0",
						delta: seg.content,
						...buildDifyMetadata(),
					});
				} else if (seg.content) {
					if (isActiveReasoning) {
						controller.enqueue({
							type: "reasoning-end",
							id: "r0",
							...buildDifyMetadata(),
						});
						isActiveReasoning = false;
					}
					if (!isActiveText) {
						isActiveText = true;
						controller.enqueue({
							type: "text-start",
							id: "0",
							...buildDifyMetadata(),
						});
					}
					controller.enqueue({
						type: "text-delta",
						id: "0",
						delta: seg.content,
						...buildDifyMetadata(),
					});
				}
			}
		}

		return {
			stream: responseStream.pipeThrough(
				new TransformStream<
					ParseResult<DifyStreamEvent>,
					LanguageModelV2StreamPart
				>({
					transform(chunk, controller) {
						if (!chunk.success) {
							logger?.error("Dify stream parse error", {
								error: String(chunk.error),
							});
							controller.enqueue({ type: "error", error: chunk.error });
							return;
						}

						const data = chunk.value;

						if (logMessages) {
							logger?.info("", { data });
						}

						// Store conversation/message IDs for metadata
						if (data.conversation_id) conversationId = data.conversation_id;
						if (data.message_id) messageId = data.message_id;
						if (data.task_id) taskId = data.task_id;

						// Handle known event types
						switch (data.event) {
							case "workflow_finished":
							case "message_end": {
								let inputTokens = 0;
								let outputTokens = 0;
								let totalTokens = 0;

								if (data.event === "workflow_finished") {
									const dataUsage = (data as any).data || {};
									inputTokens = 0;
									outputTokens = dataUsage.total_tokens ?? 0;
									totalTokens = dataUsage.total_tokens ?? 0;
								} else {
									const usageData = (data as any).metadata?.usage || {};
									inputTokens = usageData.prompt_tokens ?? 0;
									outputTokens = usageData.completion_tokens ?? 0;
									totalTokens = usageData.total_tokens ?? 0;
								}

								// Use accumulated answer for tool parsing
								// Remove <think> tags for tool parsing
								const textWithoutThink = thinkParser.getTextWithoutThink();

								const { toolCalls } = parseToolCalls(
									textWithoutThink,
									toolNames,
									genId,
								);
								const hasToolCalls = toolCalls.length > 0;

								if (logMessages) {
									logger?.info("", { toolCalls });
								}

								// Flush remaining content from parser
								emitSegments(thinkParser.flush(), controller);

								if (isActiveReasoning) {
									controller.enqueue({
										type: "reasoning-end",
										id: "r0",
										...buildDifyMetadata(),
									});
									isActiveReasoning = false;
								}

								if (isActiveText) {
									controller.enqueue({
										type: "text-end",
										id: "0",
										...buildDifyMetadata(),
									});
									isActiveText = false;
								} else if (!hasToolCalls) {
									controller.enqueue({
										type: "text-start",
										id: "0",
										...buildDifyMetadata(),
									});
									controller.enqueue({
										type: "text-end",
										id: "0",
										...buildDifyMetadata(),
									});
								}

								if (data.event === "message_end") {
									for (const sourcePart of buildRetrieverResourceSources(
										(data as any).metadata?.retriever_resources,
										buildDifyWorkflowData(),
									)) {
										controller.enqueue(sourcePart);
									}
								}

								// Don't emit cleanText here since it was already emitted via stream

								for (const tc of toolCalls) {
									controller.enqueue({
										type: "tool-input-start",
										id: tc.id,
										toolName: tc.name,
										...buildDifyMetadata(),
									});
									controller.enqueue({
										type: "tool-input-delta",
										id: tc.id,
										delta: tc.input,
										...buildDifyMetadata(),
									});
									controller.enqueue({
										type: "tool-input-end",
										id: tc.id,
										...buildDifyMetadata(),
									});
									controller.enqueue({
										type: "tool-call",
										toolCallId: tc.id,
										toolName: tc.name,
										input: tc.input,
										...buildDifyMetadata(),
									});
								}

								controller.enqueue({
									type: "finish",
									finishReason: hasToolCalls ? "tool-calls" : "stop",
									...buildDifyMetadata(),
									usage: {
										inputTokens,
										outputTokens,
										totalTokens,
									},
								});
								break;
							}

							case "message":
							case "agent_message": {
								if (
									"answer" in data &&
									typeof data.answer === "string" &&
									data.answer
								) {
									emitSegments(thinkParser.feed(data.answer), controller);

									if ("id" in data && typeof data.id === "string") {
										controller.enqueue({
											type: "response-metadata",
											id: data.id,
										});
									}
								}
								break;
							}

							// agent_thought events are summaries of agent_message chunks.
							// Dify sends: agent_thought(empty) → agent_message × N → agent_thought(full) → message_end
							// The agent_message events already contain all content (including <think> tags),
							// so agent_thought is redundant and must be ignored to avoid duplicate output.
							case "agent_thought":
								break;

							case "message_replace": {
								if (
									"answer" in data &&
									typeof data.answer === "string" &&
									data.answer
								) {
									thinkParser.reset(data.answer);

									if (isActiveText) {
										controller.enqueue({
											type: "text-end",
											id: "0",
											...buildDifyMetadata(),
										});
										isActiveText = false;
									}
									controller.enqueue({
										type: "text-start",
										id: "0",
										...buildDifyMetadata(),
									});
									controller.enqueue({
										type: "text-delta",
										id: "0",
										delta: data.answer,
										...buildDifyMetadata(),
									});
									isActiveText = true;
								}
								break;
							}

							case "message_file":
							case "ping":
								break;

							case "error": {
								const err = data as {
									message?: string;
									msg?: string;
									code?: string;
									status?: string;
								};
								const msg = err.message ?? err.msg ?? "Unknown Dify error";
								const code = err.code ?? err.status ?? "";
								logger?.error("Dify stream error", { code, message: msg });
								controller.enqueue({
									type: "error",
									error: new Error(
										`Dify error${code ? ` (${code})` : ""}: ${msg}`,
									),
								});
								break;
							}
						}
					},
				}),
			),
			request: { body: JSON.stringify(body) },
			response: { headers: responseHeaders },
		};
	}

	/**
	 * Get the request body for the Dify API
	 */
	private async getRequestBody(options: LanguageModelV2CallOptions) {
		// In AI SDK v5 LanguageModelV2, messages are in options.prompt
		const opts = options as LanguageModelV2CallOptions & {
			messages?: Message[];
		};
		const messages = (options.prompt ?? opts.messages) as Message[] | undefined;

		if (!messages || !messages.length) {
			this.logger?.error("No messages provided", { prompt: options.prompt });
			throw new APICallError({
				message: "No messages provided",
				url: this.chatMessagesEndpoint,
				requestBodyValues: options,
			});
		}

		const conversationId = this.findConversationId(options.headers, messages);
		const query = this.buildQuery(messages, conversationId);

		if (!query) {
			this.logger?.error("No user message found", {
				messageCount: messages.length,
				roles: messages.map((m) => m.role),
			});
			throw new APICallError({
				message: "No user message found",
				url: this.chatMessagesEndpoint,
				requestBodyValues: { messageCount: messages.length },
			});
		}

		const userId = options.headers?.["user-id"] ?? "you_should_pass_user-id";

		// Clean headers by removing handled IDs (do not mutate options.headers)
		const {
			"chat-id": _h1,
			"user-id": _h2,
			...cleanHeaders
		} = options.headers || {};

		// Extract file/image attachments from messages
		// Note: extractFileAttachments is an external async utility, kept as is.
		const files = await extractFileAttachments(
			messages,
			userId,
			this.config.baseURL,
			this.config.headers,
			this.logger,
		);

		// System Prompt
		const systemPrompt = this.extractSystemPrompt(messages);

		// Tool config
		const injectTools = this.settings.injectToolsPrompt !== false;
		// Always parse tool names to support tool execution even if prompt injection is disabled
		const { prompt: generatedPrompt, toolNames } = formatToolsPrompt(
			options.tools,
		);
		const toolsPrompt = injectTools ? generatedPrompt : "";

		const isNewConversation = !conversationId;
		const parts = [
			isNewConversation ? systemPrompt : "",
			query,
			isNewConversation ? toolsPrompt : "",
		].filter(Boolean);
		const finalQuery = parts.join("\n\n");
		const inputs = this.settings.inputs || {};

		const requestBody = {
			inputs,
			query: finalQuery,
			response_mode: this.settings.responseMode,
			conversation_id: conversationId,
			user: userId,
			...(files.length ? { files } : {}),
		};

		return {
			body: requestBody,
			toolNames,
			requestHeaders: cleanHeaders,
		};
	}

	private findConversationId(
		headers: Record<string, string | undefined> | undefined,
		messages: Message[],
	): string | undefined {
		// Priority: Header > Last Message Provider Metadata
		if (headers?.["chat-id"]) {
			return headers["chat-id"];
		}

		// Iterate backwards to find the most recent conversation context
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (Array.isArray(msg.content)) {
				for (const part of msg.content) {
					const meta =
						part?.providerMetadata?.difyWorkflowData ||
						part?.callProviderMetadata?.difyWorkflowData;
					if (meta?.conversationId) {
						return meta.conversationId as string;
					}
				}
			}
		}
		return undefined;
	}

	private buildQuery(
		messages: Message[],
		conversationId: string | undefined,
	): string {
		// Dify expects a single query string.
		// If conversation exists: only the new user input (+ tool results)
		// If new conversation: combine all history as context

		let startIndex = 0;

		if (conversationId) {
			// Existing Conversation: Extract latest interaction
			// We walk backwards to find the start of the new interaction.
			startIndex = messages.length;

			for (let i = messages.length - 1; i >= 0; i--) {
				const msg = messages[i];
				if (msg.role === "tool") {
					startIndex = i;
					continue;
				}
				if (msg.role === "user") {
					startIndex = i;
					break; // Found the primary user query
				}
				// Stop at assistant, system or other roles
				break;
			}
		}

		return messages
			.slice(startIndex)
			.filter(
				(msg) =>
					msg.role === "user" ||
					msg.role === "tool" ||
					(!conversationId && msg.role === "assistant"),
			)
			.map((msg) => {
				if (msg.role === "tool") return this.extractToolResult(msg);
				return this.extractTextFromMessage(msg);
			})
			.filter(Boolean)
			.join("\n\n");
	}

	private extractSystemPrompt(messages: Message[]): string {
		const systemMessage = messages.find((msg) => msg.role === "system");
		const rawSystemPrompt = systemMessage
			? this.extractTextFromMessage(systemMessage)
			: "";

		return formatSystemPrompt(rawSystemPrompt);
	}

	private extractTextFromMessage(msg: Message): string {
		if (typeof msg.content === "string") {
			return msg.content;
		}
		if (Array.isArray(msg.content)) {
			return msg.content
				.map((part: string | MessageContentPart) => {
					if (typeof part === "string") return part;
					if (part?.type === "text" && part.text) return part.text;
					return "";
				})
				.filter(Boolean)
				.join(" ");
		}
		return "";
	}

	private extractToolResult(msg: Message): string {
		const content = msg.content;
		if (!Array.isArray(content)) return "";

		const results: string[] = [];
		for (const part of content) {
			if (part?.type === "tool-result") {
				const name = part.toolName || "tool";
				const raw = part.output ?? part.result ?? part.content ?? part.text;
				const output =
					raw !== undefined &&
					typeof raw === "object" &&
					raw !== null &&
					"value" in raw
						? (raw as { value: unknown }).value
						: raw;
				const result =
					output === undefined
						? "[completed]"
						: typeof output === "string"
							? output
							: JSON.stringify(output);
				results.push(`[${name} result]: ${result}`);
			}
		}
		return results.join("\n");
	}
}
