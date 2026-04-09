import type {
	AgentModelEvent,
	GatewayModelDefinition,
	GatewayProviderFactory,
	GatewayProviderRegistration,
	GatewayStreamRequest,
} from "@clinebot/shared";
import { nanoid } from "nanoid";
import type { ModelInfo } from "../model/types";
import {
	type ApiHandler,
	type ApiStream,
	type ApiStreamChunk,
	type HandlerModelInfo,
	type Message,
	normalizeProviderId,
	type ProviderConfig,
	resolveRoutingProviderId,
	type ToolDefinition,
} from "../provider/types";
import {
	createAnthropicProvider,
	createBedrockProvider,
	createClaudeCodeProvider,
	createDifyProvider,
	createGoogleProvider,
	createMistralProvider,
	createOpenAICodexProvider,
	createOpenAICompatibleProvider,
	createOpenAIProvider,
	createOpenCodeProvider,
	createVertexProvider,
} from "./ai-sdk";
import { BUILTIN_PROVIDER_REGISTRATIONS } from "./builtins-runtime";
import { createGateway } from "./index";
import {
	getProviderCollection,
	getProviderCollectionSync,
} from "./model-registry";

const BUILTIN_PROVIDER_MAP = new Map(
	BUILTIN_PROVIDER_REGISTRATIONS.map((registration) => [
		registration.manifest.id,
		registration,
	]),
);

function toGatewayCapabilities(
	capabilities: readonly string[] | undefined,
): GatewayModelDefinition["capabilities"] {
	if (!capabilities?.length) {
		return undefined;
	}

	const mapped = new Set<
		NonNullable<GatewayModelDefinition["capabilities"]>[number]
	>();
	for (const capability of capabilities) {
		switch (capability) {
			case "tools":
			case "reasoning":
			case "images":
			case "audio":
				mapped.add(capability);
				break;
			case "files":
			case "streaming":
			case "temperature":
			case "prompt-cache":
			case "reasoning-effort":
			case "computer-use":
			case "global-endpoint":
				mapped.add("text");
				break;
			case "structured_output":
				mapped.add("structured-output");
				break;
			default:
				mapped.add("text");
		}
	}

	mapped.add("text");
	return [...mapped];
}

function toGatewayModelDefinition(
	providerId: string,
	model: ModelInfo,
): GatewayModelDefinition {
	return {
		id: model.id,
		name: model.name ?? model.id,
		description: model.description,
		providerId,
		contextWindow: model.contextWindow,
		maxOutputTokens: model.maxTokens,
		capabilities: toGatewayCapabilities(model.capabilities),
		metadata: {
			family: model.family,
			pricing: model.pricing,
			status: model.status,
			releaseDate: model.releaseDate,
		},
	};
}

function resolveFactory(providerId: string): GatewayProviderFactory {
	const normalized = normalizeProviderId(providerId);
	switch (normalized) {
		case "openai-native":
			return createOpenAIProvider;
		case "anthropic":
		case "minimax":
			return createAnthropicProvider;
		case "gemini":
			return createGoogleProvider;
		case "vertex":
			return createVertexProvider;
		case "bedrock":
			return createBedrockProvider;
		case "mistral":
			return createMistralProvider;
		case "claude-code":
			return createClaudeCodeProvider;
		case "openai-codex":
			return createOpenAICodexProvider;
		case "opencode":
			return createOpenCodeProvider;
		case "dify":
			return createDifyProvider;
		default:
			return createOpenAICompatibleProvider;
	}
}

async function resolveProviderRegistration(
	config: ProviderConfig,
): Promise<GatewayProviderRegistration | undefined> {
	const providerId = normalizeProviderId(config.providerId);
	const routedProviderId = normalizeProviderId(
		resolveRoutingProviderId(config),
	);
	const builtin = BUILTIN_PROVIDER_MAP.get(providerId);
	if (builtin && providerId === routedProviderId) {
		return undefined;
	}

	const collection =
		(await getProviderCollection(providerId)) ??
		(providerId !== routedProviderId
			? await getProviderCollection(routedProviderId)
			: undefined);
	if (!collection) {
		const routedBuiltin = BUILTIN_PROVIDER_MAP.get(routedProviderId);
		if (!routedBuiltin || providerId === routedProviderId) {
			return undefined;
		}
		return {
			manifest: {
				...routedBuiltin.manifest,
				id: providerId,
				name: routedBuiltin.manifest.name,
				models: routedBuiltin.manifest.models.map((model) => ({
					...model,
					providerId,
				})),
			},
			defaults: routedBuiltin.defaults,
			createProvider: routedBuiltin.createProvider,
			loadProvider: routedBuiltin.loadProvider,
		};
	}

	const routedBuiltin = BUILTIN_PROVIDER_MAP.get(routedProviderId);
	return {
		manifest: {
			id: providerId,
			name: collection.provider.name,
			description: collection.provider.description,
			defaultModelId: collection.provider.defaultModelId,
			models: Object.values(collection.models).map((model) =>
				toGatewayModelDefinition(providerId, model),
			),
			api: collection.provider.baseUrl,
			apiKeyEnv: collection.provider.env,
		},
		defaults: {
			...(routedBuiltin?.defaults ?? {}),
			baseUrl: collection.provider.baseUrl ?? routedBuiltin?.defaults?.baseUrl,
			apiKeyEnv: collection.provider.env ?? routedBuiltin?.defaults?.apiKeyEnv,
		},
		createProvider:
			routedBuiltin?.createProvider ?? resolveFactory(routedProviderId),
		loadProvider: routedBuiltin?.loadProvider,
	};
}

function resolveProviderRegistrationSync(
	config: ProviderConfig,
): GatewayProviderRegistration | undefined {
	const providerId = normalizeProviderId(config.providerId);
	const routedProviderId = normalizeProviderId(
		resolveRoutingProviderId(config),
	);
	const builtin = BUILTIN_PROVIDER_MAP.get(providerId);
	if (builtin && providerId === routedProviderId) {
		return undefined;
	}

	const collection =
		getProviderCollectionSync(providerId) ??
		(providerId !== routedProviderId
			? getProviderCollectionSync(routedProviderId)
			: undefined);
	if (!collection) {
		const routedBuiltin = BUILTIN_PROVIDER_MAP.get(routedProviderId);
		if (!routedBuiltin || providerId === routedProviderId) {
			return undefined;
		}
		return {
			manifest: {
				...routedBuiltin.manifest,
				id: providerId,
				models: routedBuiltin.manifest.models.map((model) => ({
					...model,
					providerId,
				})),
			},
			defaults: routedBuiltin.defaults,
			createProvider: routedBuiltin.createProvider,
			loadProvider: routedBuiltin.loadProvider,
		};
	}

	const routedBuiltin = BUILTIN_PROVIDER_MAP.get(routedProviderId);
	return {
		manifest: {
			id: providerId,
			name: collection.provider.name,
			description: collection.provider.description,
			defaultModelId: collection.provider.defaultModelId,
			models: Object.values(collection.models).map((model) =>
				toGatewayModelDefinition(providerId, model),
			),
			api: collection.provider.baseUrl,
			apiKeyEnv: collection.provider.env,
		},
		defaults: {
			...(routedBuiltin?.defaults ?? {}),
			baseUrl: collection.provider.baseUrl ?? routedBuiltin?.defaults?.baseUrl,
			apiKeyEnv: collection.provider.env ?? routedBuiltin?.defaults?.apiKeyEnv,
		},
		createProvider:
			routedBuiltin?.createProvider ?? resolveFactory(routedProviderId),
		loadProvider: routedBuiltin?.loadProvider,
	};
}

function toGatewayRequestMessages(
	messages: Message[],
): GatewayStreamRequest["messages"] {
	const toolNames = new Map<string, string>();

	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const part of message.content) {
			if (part.type === "tool_use") {
				toolNames.set(part.id, part.name);
				if (part.call_id) {
					toolNames.set(part.call_id, part.name);
				}
			}
		}
	}

	return messages.map((message) => {
		const content =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content.flatMap((part): Array<Record<string, unknown>> => {
						switch (part.type) {
							case "text":
								return [{ type: "text", text: part.text }];
							case "thinking":
								return [
									{
										type: "reasoning" as const,
										text: part.thinking,
										metadata:
											part.signature || part.call_id
												? {
														signature: part.signature,
														callId: part.call_id,
														details: part.details,
													}
												: undefined,
									},
								];
							case "tool_use":
								return [
									{
										type: "tool-call" as const,
										toolCallId: part.call_id ?? part.id,
										toolName: part.name,
										input: part.input,
										metadata: part.signature
											? { thoughtSignature: part.signature }
											: undefined,
									},
								];
							case "tool_result":
								return [
									{
										type: "tool-result" as const,
										toolCallId: part.tool_use_id,
										toolName: toolNames.get(part.tool_use_id) ?? "tool",
										output:
											typeof part.content === "string"
												? part.content
												: part.content
														.map((contentPart) =>
															contentPart.type === "text"
																? contentPart.text
																: contentPart.type === "file"
																	? contentPart.content
																	: "",
														)
														.join("\n"),
										isError: part.is_error ?? false,
									},
								];
							case "image":
								return [
									{
										type: "image" as const,
										image: `data:${part.mediaType};base64,${part.data}`,
										mediaType: part.mediaType,
									},
								];
							case "file":
								return [{ type: "text" as const, text: part.content }];
							case "redacted_thinking":
								return [];
							default:
								return [];
						}
					});

		return {
			role: message.role,
			content,
		} as GatewayStreamRequest["messages"][number];
	});
}

function toGatewayTools(
	tools: ToolDefinition[] | undefined,
): GatewayStreamRequest["tools"] {
	return tools?.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
}

function buildGatewayRequest(
	config: ProviderConfig,
	systemPrompt: string,
	messages: Message[],
	tools?: ToolDefinition[],
	signal?: AbortSignal,
): GatewayStreamRequest {
	return {
		providerId: normalizeProviderId(config.providerId),
		modelId: config.modelId,
		systemPrompt,
		messages: toGatewayRequestMessages(messages),
		tools: toGatewayTools(tools),
		maxTokens: config.maxOutputTokens,
		reasoning:
			config.thinking || config.reasoningEffort || config.thinkingBudgetTokens
				? {
						enabled: config.thinking,
						effort:
							config.reasoningEffort === "xhigh"
								? "high"
								: config.reasoningEffort === "low" ||
										config.reasoningEffort === "medium" ||
										config.reasoningEffort === "high"
									? config.reasoningEffort
									: undefined,
						budgetTokens: config.thinkingBudgetTokens,
					}
				: undefined,
		signal,
	};
}

function buildGatewayConfig(config: ProviderConfig) {
	const providerId = normalizeProviderId(config.providerId);
	return {
		providerId,
		apiKey: config.apiKey ?? config.accessToken,
		baseUrl: config.baseUrl,
		headers: config.headers,
		timeoutMs: config.timeoutMs,
		defaultModelId: config.modelId,
		models: config.knownModels
			? Object.values(config.knownModels).map((model) => {
					const definition = toGatewayModelDefinition(providerId, model);
					const { providerId: _providerId, ...definitionWithoutProviderId } =
						definition;
					return definitionWithoutProviderId;
				})
			: undefined,
		options: {
			region: config.region ?? config.gcp?.region,
			project: config.gcp?.projectId,
			projectId: config.gcp?.projectId,
			location: config.region ?? config.gcp?.region,
			accessKeyId: config.aws?.accessKey,
			secretAccessKey: config.aws?.secretKey,
			sessionToken: config.aws?.sessionToken,
			credentialProvider: config.aws?.profile,
			authentication: config.aws?.authentication,
			endpoint: config.aws?.endpoint,
			customModelBaseId: config.aws?.customModelBaseId,
			apiVersion: config.azure?.apiVersion,
			useIdentity: config.azure?.useIdentity,
			mode: config.oca?.mode,
			usePromptCache: config.aws?.usePromptCache ?? config.oca?.usePromptCache,
			...config.codex,
			...config.claudeCode,
			...config.opencode,
			...config.sap,
		},
	};
}

function toApiStreamChunk(id: string, event: AgentModelEvent): ApiStreamChunk {
	switch (event.type) {
		case "text-delta":
			return { type: "text", id, text: event.text };
		case "reasoning-delta":
			return {
				type: "reasoning",
				id,
				reasoning: event.text,
				signature:
					typeof event.metadata?.thoughtSignature === "string"
						? event.metadata.thoughtSignature
						: typeof event.metadata?.signature === "string"
							? event.metadata.signature
							: undefined,
				details: event.metadata?.details,
			};
		case "tool-call-delta": {
			const args =
				typeof event.inputText === "string" || event.input === undefined
					? event.inputText
					: (event.input as Record<string, unknown>);
			return {
				type: "tool_calls",
				id,
				signature:
					typeof event.metadata?.thoughtSignature === "string"
						? event.metadata.thoughtSignature
						: undefined,
				tool_call: {
					call_id: event.toolCallId,
					function: {
						id: event.toolCallId,
						name: event.toolName,
						arguments: args,
					},
				},
			};
		}
		case "usage":
			return {
				type: "usage",
				id,
				inputTokens: event.usage.inputTokens,
				outputTokens: event.usage.outputTokens,
				cacheReadTokens: event.usage.cacheReadTokens,
				cacheWriteTokens: event.usage.cacheWriteTokens,
				totalCost: event.usage.totalCost,
			};
		case "finish":
			return {
				type: "done",
				id,
				success: event.reason !== "error",
				error: event.error,
				incompleteReason:
					event.reason === "max-tokens" ? "max_tokens" : undefined,
			};
	}
}

function resolveModelInfo(config: ProviderConfig): ModelInfo {
	return (
		config.modelInfo ??
		(config.modelId ? config.knownModels?.[config.modelId] : undefined) ?? {
			id: config.modelId,
			name: config.modelId,
			capabilities: ["streaming"],
		}
	);
}

class GatewayApiHandler implements ApiHandler {
	private abortSignal: AbortSignal | undefined;

	constructor(private readonly config: ProviderConfig) {
		this.abortSignal = config.abortSignal;
	}

	getMessages(systemPrompt: string, messages: Message[]): unknown {
		return buildGatewayRequest(
			this.config,
			systemPrompt,
			messages,
			undefined,
			this.abortSignal,
		);
	}

	createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		const gateway = createGateway({
			providerConfigs: [buildGatewayConfig(this.config)],
		});
		const registration = resolveProviderRegistrationSync(this.config);
		if (registration) {
			gateway.registerProvider(registration);
		}

		const request = buildGatewayRequest(
			this.config,
			systemPrompt,
			messages,
			tools,
			this.abortSignal,
		);
		const id = `gw_${nanoid(10)}`;
		const stream = (async function* () {
			for await (const event of await gateway.stream(request)) {
				yield toApiStreamChunk(id, event);
			}
		})() as ApiStream;
		stream.id = id;
		return stream;
	}

	getModel(): HandlerModelInfo {
		return {
			id: this.config.modelId,
			info: resolveModelInfo(this.config),
		};
	}

	abort(): void {
		// Requests are cancelled via the configured AbortSignal.
	}

	setAbortSignal(signal: AbortSignal | undefined): void {
		this.abortSignal = signal;
	}
}

export function createGatewayApiHandler(config: ProviderConfig): ApiHandler {
	return new GatewayApiHandler(config);
}

export async function createGatewayApiHandlerAsync(
	config: ProviderConfig,
): Promise<ApiHandler> {
	const gateway = createGateway({
		providerConfigs: [buildGatewayConfig(config)],
	});
	const registration = await resolveProviderRegistration(config);
	if (registration) {
		gateway.registerProvider(registration);
	}
	return new (class extends GatewayApiHandler {
		override createMessage(
			systemPrompt: string,
			messages: Message[],
			tools?: ToolDefinition[],
		): ApiStream {
			const request = buildGatewayRequest(
				config,
				systemPrompt,
				messages,
				tools,
				config.abortSignal,
			);
			const id = `gw_${nanoid(10)}`;
			const stream = (async function* () {
				for await (const event of await gateway.stream(request)) {
					yield toApiStreamChunk(id, event);
				}
			})() as ApiStream;
			stream.id = id;
			return stream;
		}
	})(config);
}
