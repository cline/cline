/**
 * Base Handler
 *
 * Abstract base class that provides common functionality for all handlers.
 */

import { nanoid } from "nanoid";
import type { ProviderClient } from "../../models/types/model";
import type {
	ApiHandler,
	ApiStream,
	ApiStreamUsageChunk,
	HandlerModelInfo,
	ModelCapability,
	ModelInfo,
	ProviderConfig,
} from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import type { ApiStreamChunk } from "../types/stream";

export const DEFAULT_REQUEST_HEADERS: Record<string, string> = {
	"HTTP-Referer": "https://cline.bot",
	"X-Title": "Cline",
	"X-IS-MULTIROOT": "false",
	"X-CLIENT-TYPE": "cline-sdk",
};

interface OpenAICompatibleProviderErrorShape {
	status?: number;
	message?: string;
	error?: {
		message?: string;
		code?: number;
		metadata?: {
			raw?: string;
			provider_name?: string;
		};
	};
	response?: {
		status?: number;
	};
}

const controllerIds = new WeakMap<AbortController, string>();
let controllerIdCounter = 0;

function getControllerId(controller: AbortController): string {
	let id = controllerIds.get(controller);
	if (!id) {
		id = `abort_${++controllerIdCounter}`;
		controllerIds.set(controller, id);
	}
	return id;
}

function serializeAbortReason(reason: unknown): unknown {
	return reason instanceof Error
		? { name: reason.name, message: reason.message }
		: reason;
}

/**
 * Base handler class with common functionality
 */
export abstract class BaseHandler implements ApiHandler {
	abstract readonly type: ProviderClient;
	protected config: ProviderConfig;
	protected abortController: AbortController | undefined;
	private abortSignalSequence = 0;

	constructor(config: ProviderConfig) {
		this.config = config;
	}

	abstract getMessages(systemPrompt: string, messages: Message[]): unknown;

	abstract createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream;

	getModel(): HandlerModelInfo {
		const modelId = this.config.modelId;
		return {
			id: modelId,
			info: { ...(this.config.modelInfo ?? {}), id: modelId },
		};
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		return undefined;
	}

	protected getAbortSignal(): AbortSignal {
		const controller = new AbortController();
		this.abortController = controller;
		controller.signal.addEventListener(
			"abort",
			() => {
				if (this.abortController === controller) {
					this.abortController = undefined;
				}
			},
			{ once: true },
		);

		const configSignal = this.config.abortSignal;
		if (configSignal) {
			if (configSignal.aborted) {
				this.logAbort("debug", "Provider request inherited aborted signal", {
					controllerId: getControllerId(controller),
					reason: serializeAbortReason(configSignal.reason),
				});
				controller.abort(configSignal.reason);
			} else {
				const signalId = ++this.abortSignalSequence;
				configSignal.addEventListener(
					"abort",
					() => {
						this.logAbort("warn", "Provider request abort signal fired", {
							controllerId: getControllerId(controller),
							signalId,
							reason: serializeAbortReason(configSignal.reason),
						});
						controller.abort(configSignal.reason);
					},
					{ once: true },
				);
				this.logAbort("debug", "Provider request attached abort signal", {
					controllerId: getControllerId(controller),
					signalId,
				});
			}
		}

		return controller.signal;
	}

	abort(): void {
		this.abortController?.abort();
	}

	setAbortSignal(signal: AbortSignal | undefined): void {
		this.config.abortSignal = signal;
		if (signal?.aborted) {
			this.logAbort("debug", "Provider handler received pre-aborted signal", {
				controllerId: this.abortController
					? getControllerId(this.abortController)
					: undefined,
				reason: serializeAbortReason(signal.reason),
			});
			this.abortController?.abort(signal.reason);
		}
	}

	private logAbort(
		level: "debug" | "warn",
		message: string,
		metadata?: Record<string, unknown>,
	): void {
		this.config.logger?.[level]?.(message, {
			providerId: this.config.providerId,
			modelId: this.config.modelId,
			...metadata,
		});
	}

	protected supportsPromptCache(modelInfo?: ModelInfo): boolean {
		const resolvedModelInfo = this.resolveModelInfo(modelInfo);
		const pricing = resolvedModelInfo?.pricing;

		return (
			this.hasResolvedCapability("prompt-cache", resolvedModelInfo) ||
			typeof pricing?.cacheRead === "number" ||
			typeof pricing?.cacheWrite === "number"
		);
	}

	protected resolveModelInfo(modelInfo?: ModelInfo): ModelInfo | undefined {
		const resolvedModelInfo =
			modelInfo ??
			this.config.modelInfo ??
			this.config.knownModels?.[this.config.modelId];
		if (!resolvedModelInfo) {
			return undefined;
		}

		const capabilities = this.resolveModelCapabilities(resolvedModelInfo);
		return capabilities
			? { ...resolvedModelInfo, capabilities }
			: resolvedModelInfo;
	}

	protected resolveModelCapabilities(
		modelInfo?: Pick<ModelInfo, "capabilities">,
	): ModelCapability[] | undefined {
		const resolved = new Set(modelInfo?.capabilities ?? []);
		for (const capability of this.getConfigCapabilityOverrides()) {
			resolved.add(capability);
		}
		return resolved.size > 0 ? [...resolved] : undefined;
	}

	protected hasResolvedCapability(
		capability: ModelCapability,
		modelInfo?: Pick<ModelInfo, "capabilities">,
	): boolean {
		return (
			this.resolveModelCapabilities(modelInfo)?.includes(capability) ?? false
		);
	}

	protected getConfigCapabilityOverrides(): ModelCapability[] {
		const allowedOverrides = new Set<ModelCapability>(["prompt-cache"]);
		const overrides: ModelCapability[] = [];
		for (const capability of this.config.capabilities ?? []) {
			if (allowedOverrides.has(capability as ModelCapability)) {
				overrides.push(capability as ModelCapability);
			}
		}
		return overrides;
	}

	protected calculateCost(
		inputTokens: number,
		outputTokens: number,
		cacheReadTokens = 0,
		cacheWriteTokens = 0,
	): number | undefined {
		const pricing = (
			this.config.modelInfo ?? this.config.knownModels?.[this.config.modelId]
		)?.pricing;
		if (!pricing?.input || !pricing?.output) {
			return undefined;
		}

		return (
			(inputTokens / 1_000_000) * pricing.input +
			(outputTokens / 1_000_000) * pricing.output +
			(cacheReadTokens > 0
				? (cacheReadTokens / 1_000_000) * (pricing.cacheRead ?? 0)
				: 0) +
			(cacheWriteTokens > 0
				? (cacheWriteTokens / 1_000_000) *
					(pricing.cacheWrite ?? pricing.input * 1.25)
				: 0)
		);
	}

	protected calculateCostFromInclusiveInput(
		inputTokens: number,
		outputTokens: number,
		cacheReadTokens = 0,
		cacheWriteTokens = 0,
	): number | undefined {
		return this.calculateCost(
			Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens),
			outputTokens,
			cacheReadTokens,
			cacheWriteTokens,
		);
	}

	protected createResponseId(): string {
		return nanoid();
	}

	protected withResponseId<T extends ApiStreamChunk>(
		chunk: T,
		responseId: string,
	): T {
		return { ...chunk, id: responseId };
	}

	protected *withResponseIdForAll(
		chunks: Iterable<ApiStreamChunk>,
		responseId: string,
	): Generator<ApiStreamChunk> {
		for (const chunk of chunks) {
			yield { ...chunk, id: responseId };
		}
	}

	protected getRequestHeaders(): Record<string, string> {
		return {
			...DEFAULT_REQUEST_HEADERS,
			...(this.config.headers ?? {}),
		};
	}

	protected normalizeOpenAICompatibleBadRequest(
		error: unknown,
	): Error | undefined {
		const rawError = error as OpenAICompatibleProviderErrorShape | undefined;
		const status =
			rawError?.status ??
			rawError?.response?.status ??
			rawError?.error?.code ??
			(typeof rawError?.message === "string" && rawError.message.includes("400")
				? 400
				: undefined);
		if (status !== 400) {
			return undefined;
		}

		const rawMetadata = rawError?.error?.metadata?.raw;
		const parsedRaw = this.parseRawProviderError(rawMetadata);
		const detail =
			parsedRaw?.error?.message?.trim() ||
			rawError?.error?.message?.trim() ||
			rawError?.message?.trim() ||
			"Provider returned error";
		const providerName =
			rawError?.error?.metadata?.provider_name?.trim() || "Provider";
		const requestId = parsedRaw?.request_id?.trim();
		const normalizedMessage = this.rewriteProviderBadRequestDetail(detail);
		const suffix = requestId ? ` Request ID: ${requestId}.` : "";
		return new Error(
			`${providerName} request was rejected (HTTP 400). ${normalizedMessage}${suffix}`,
			{
				cause: error instanceof Error ? error : undefined,
			},
		);
	}

	private parseRawProviderError(
		raw: string | undefined,
	): { error?: { message?: string }; request_id?: string } | undefined {
		if (!raw) {
			return undefined;
		}
		try {
			return JSON.parse(raw) as {
				error?: { message?: string };
				request_id?: string;
			};
		} catch {
			return undefined;
		}
	}

	private rewriteProviderBadRequestDetail(detail: string): string {
		const promptTooLongMatch = detail.match(
			/prompt is too long:\s*([\d,]+)\s*tokens?\s*>\s*([\d,]+)\s*maximum/i,
		);
		if (promptTooLongMatch) {
			const actual = promptTooLongMatch[1];
			const maximum = promptTooLongMatch[2];
			return `Prompt is too long: ${actual} tokens exceeds the ${maximum} token limit.`;
		}
		return detail.endsWith(".") ? detail : `${detail}.`;
	}
}
