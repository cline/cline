import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	BasicLogger,
	GatewayConfig,
	GatewayModelDefinition,
	GatewayModelHandleOptions,
	GatewayModelSelection,
	GatewayProviderRegistration,
	GatewayStreamRequest,
	ITelemetryService,
} from "@cline/shared";
import { estimateRequestInputTokens } from "@cline/shared";
import { toAsyncIterable } from "./async";
import { BUILTIN_PROVIDER_REGISTRATIONS } from "./builtins-runtime";
import { GatewayRegistry } from "./registry";
import { isPositiveFiniteNumber } from "./utils";

export type * from "@cline/shared";

export const DEFAULT_GATEWAY_MAX_OUTPUT_TOKENS = 32_000;
const GATEWAY_OUTPUT_RESERVE_TOKENS = 1_024;

function mergeRequestMetadata(
	defaults: Record<string, unknown> | undefined,
	request: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!defaults && !request) {
		return undefined;
	}
	return {
		...(defaults ?? {}),
		...(request ?? {}),
	};
}

export interface Gateway {
	registerProvider(registration: GatewayProviderRegistration): this;
	configureProvider(
		config: NonNullable<GatewayConfig["providerConfigs"]>[number],
	): this;
	listProviders(): ReturnType<GatewayRegistry["listProviders"]>;
	listModels(providerId?: string): ReturnType<GatewayRegistry["listModels"]>;
	createAgentModel(
		selection: GatewayModelSelection,
		options?: GatewayModelHandleOptions,
	): AgentModel;
	stream(
		request: GatewayStreamRequest,
	): Promise<AsyncIterable<AgentModelEvent>>;
}

class GatewayModelAdapter implements AgentModel {
	constructor(
		private readonly gateway: DefaultGateway,
		private readonly selection: GatewayModelSelection,
		private readonly defaults: GatewayModelHandleOptions | undefined,
	) {}

	stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		const requestedReasoning = request.options?.reasoning as
			| {
					enabled?: boolean;
					effort?: "low" | "medium" | "high";
					budgetTokens?: number;
			  }
			| undefined;
		const thinking = request.options?.thinking;
		const reasoningEffort = request.options?.reasoningEffort;
		const thinkingBudgetTokens = request.options?.thinkingBudgetTokens;
		const legacyEffort =
			reasoningEffort === "low" ||
			reasoningEffort === "medium" ||
			reasoningEffort === "high"
				? reasoningEffort
				: undefined;
		const legacyReasoning:
			| {
					enabled?: boolean;
					effort?: "low" | "medium" | "high";
					budgetTokens?: number;
			  }
			| undefined =
			typeof thinking === "boolean" ||
			legacyEffort !== undefined ||
			typeof thinkingBudgetTokens === "number"
				? {
						enabled: typeof thinking === "boolean" ? thinking : undefined,
						effort: legacyEffort,
						budgetTokens:
							typeof thinkingBudgetTokens === "number"
								? thinkingBudgetTokens
								: undefined,
					}
				: undefined;
		return this.gateway.stream({
			providerId: this.selection.providerId,
			modelId: this.selection.modelId ?? "",
			systemPrompt: request.systemPrompt,
			messages: request.messages,
			tools: this.defaults?.tools ?? request.tools,
			temperature:
				(request.options?.temperature as number | undefined) ??
				this.defaults?.temperature,
			maxTokens:
				(request.options?.maxTokens as number | undefined) ??
				this.defaults?.maxTokens,
			metadata: mergeRequestMetadata(
				this.defaults?.metadata,
				request.options?.metadata as Record<string, unknown> | undefined,
			),
			reasoning:
				requestedReasoning ?? legacyReasoning ?? this.defaults?.reasoning,
			signal: request.signal ?? this.defaults?.signal,
		});
	}
}

export function resolveGatewayRequestMaxTokens(input: {
	requestedMaxTokens?: number;
	model: Pick<GatewayModelDefinition, "contextWindow" | "maxOutputTokens">;
	estimatedInputTokens: number;
	defaultMaxOutputTokens?: number;
	outputReserveTokens?: number;
	reasoningBudgetTokens?: number;
	onContextOverflow?: (details: {
		contextWindow: number;
		estimatedInputTokens: number;
		reserveTokens: number;
	}) => void;
}): number | undefined {
	const caps: number[] = [];
	if (isPositiveFiniteNumber(input.requestedMaxTokens)) {
		caps.push(Math.floor(input.requestedMaxTokens));
	} else {
		// Providers like Anthropic require max_tokens to exceed the thinking
		// budget, so an explicit reasoning budget lifts the synthesized default
		// (still clamped by model max output and remaining context below).
		const reasoningFloor = isPositiveFiniteNumber(input.reasoningBudgetTokens)
			? Math.floor(input.reasoningBudgetTokens) +
				(input.outputReserveTokens ?? GATEWAY_OUTPUT_RESERVE_TOKENS)
			: 0;
		const defaultMaxOutputTokens = Math.max(
			input.defaultMaxOutputTokens ?? DEFAULT_GATEWAY_MAX_OUTPUT_TOKENS,
			reasoningFloor,
		);
		if (
			isPositiveFiniteNumber(input.model.maxOutputTokens) ||
			isPositiveFiniteNumber(input.model.contextWindow)
		) {
			caps.push(defaultMaxOutputTokens);
		}
	}

	if (isPositiveFiniteNumber(input.model.maxOutputTokens)) {
		caps.push(Math.floor(input.model.maxOutputTokens));
	}

	if (isPositiveFiniteNumber(input.model.contextWindow)) {
		const reserveTokens =
			input.outputReserveTokens ?? GATEWAY_OUTPUT_RESERVE_TOKENS;
		const remainingContext =
			input.model.contextWindow - input.estimatedInputTokens - reserveTokens;
		if (remainingContext <= 0) {
			input.onContextOverflow?.({
				contextWindow: input.model.contextWindow,
				estimatedInputTokens: input.estimatedInputTokens,
				reserveTokens,
			});
			return undefined;
		}
		caps.push(Math.floor(remainingContext));
	}

	if (caps.length === 0) {
		return undefined;
	}

	return Math.max(1, Math.floor(Math.min(...caps)));
}

export class DefaultGateway implements Gateway {
	private readonly registry: GatewayRegistry;
	private readonly logger: BasicLogger | undefined;
	private readonly telemetry: ITelemetryService | undefined;

	constructor(config: GatewayConfig = {}) {
		this.registry = new GatewayRegistry(config.fetch);
		this.logger = config.logger;
		this.telemetry = config.telemetry;

		if (config.builtins !== false) {
			const builtins = new Set(
				config.builtins ??
					BUILTIN_PROVIDER_REGISTRATIONS.map(
						(provider) => provider.manifest.id,
					),
			);
			for (const builtin of BUILTIN_PROVIDER_REGISTRATIONS) {
				if (builtins.has(builtin.manifest.id)) {
					this.registry.registerProvider(builtin);
				}
			}
		}

		for (const provider of config.providers ?? []) {
			this.registry.registerProvider(provider);
		}

		for (const providerConfig of config.providerConfigs ?? []) {
			this.registry.configureProvider(providerConfig);
		}
	}

	registerProvider(registration: GatewayProviderRegistration): this {
		this.registry.registerProvider(registration);
		return this;
	}

	configureProvider(
		config: NonNullable<GatewayConfig["providerConfigs"]>[number],
	): this {
		this.registry.configureProvider(config);
		return this;
	}

	listProviders() {
		return this.registry.listProviders();
	}

	listModels(providerId?: string) {
		return this.registry.listModels(providerId);
	}

	createAgentModel(
		selection: GatewayModelSelection,
		options?: GatewayModelHandleOptions,
	): AgentModel {
		return new GatewayModelAdapter(this, selection, options);
	}

	async stream(
		request: GatewayStreamRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const resolved = this.registry.resolveModel({
			providerId: request.providerId,
			modelId: request.modelId || undefined,
		});
		const providerRecord = await this.registry.createProvider(
			request.providerId,
		);
		const provider = await providerRecord.createProvider(providerRecord.config);
		const maxTokens = resolveGatewayRequestMaxTokens({
			requestedMaxTokens: request.maxTokens,
			model: resolved.model,
			estimatedInputTokens: estimateRequestInputTokens(request),
			reasoningBudgetTokens: request.reasoning?.budgetTokens,
			onContextOverflow: (details) => {
				this.logger?.log(
					"Estimated prompt tokens exceed model context window",
					{
						severity: "warn",
						providerId: resolved.provider.id,
						modelId: resolved.model.id,
						...details,
					},
				);
			},
		});
		const stream = await provider.stream(
			{
				...request,
				modelId: resolved.model.id,
				providerId: resolved.provider.id,
				maxTokens,
				defaultedMaxTokens:
					maxTokens !== undefined && !isPositiveFiniteNumber(request.maxTokens),
			},
			{
				provider: resolved.provider,
				model: resolved.model,
				config: providerRecord.config,
				signal: request.signal,
				logger: this.logger,
				telemetry: this.telemetry,
			},
		);

		return toAsyncIterable(stream);
	}
}

export function createGateway(config?: GatewayConfig): DefaultGateway {
	return new DefaultGateway(config);
}
