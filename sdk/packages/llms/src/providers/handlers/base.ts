/**
 * Base Handler
 *
 * Abstract base class that provides common functionality for all handlers.
 */

import { nanoid } from "nanoid";
import type {
	ApiHandler,
	ApiStream,
	ApiStreamUsageChunk,
	HandlerModelInfo,
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
		const resolvedModelInfo =
			modelInfo ??
			this.config.modelInfo ??
			this.config.knownModels?.[this.config.modelId];
		const pricing = resolvedModelInfo?.pricing;

		return (
			resolvedModelInfo?.capabilities?.includes("prompt-cache") === true ||
			this.config.capabilities?.includes("prompt-cache") === true ||
			typeof pricing?.cacheRead === "number" ||
			typeof pricing?.cacheWrite === "number"
		);
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
}
