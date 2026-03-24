import type { ApiStream } from "../types";

export type {
	AiSdkMessage,
	AiSdkMessagePart,
} from "../transform/ai-sdk-community-format";
export { toAiSdkMessages } from "../transform/ai-sdk-community-format";

type AiSdkStreamPart = {
	type?: string;
	[key: string]: unknown;
};

type AiSdkUsage = {
	inputTokens?: unknown;
	outputTokens?: unknown;
	reasoningTokens?: unknown;
	thoughtsTokenCount?: unknown;
	cachedInputTokens?: unknown;
};

export type AiSdkStream = {
	fullStream?: AsyncIterable<AiSdkStreamPart>;
	textStream?: AsyncIterable<string>;
	text?: Promise<string> | string;
	usage?: Promise<Record<string, unknown>>;
};

type AiSdkUsageMetrics = {
	inputTokens: number;
	outputTokens: number;
	thoughtsTokenCount: number;
	cacheReadTokens: number;
	cacheWriteTokens?: number;
};

export type EmitAiSdkStreamOptions = {
	responseId: string;
	errorMessage: string;
	calculateCost: (
		inputTokens: number,
		outputTokens: number,
		cacheReadTokens: number,
		cacheWriteTokens?: number,
	) => number | undefined;
	reasoningTypes?: string[];
	enableToolCalls?: boolean;
	toolCallArgsOrder?: Array<"args" | "input">;
	toolCallFunctionIncludeId?: boolean;
	enableTextFallback?: boolean;
	resolveUsageMetrics?: (
		usage: AiSdkUsage,
		part?: AiSdkStreamPart,
	) => AiSdkUsageMetrics;
};

let cachedAiModule: {
	streamText: (input: Record<string, unknown>) => AiSdkStream;
} | null = null;

export type LoadAiSdkOptions = {
	beforeImport?: () => void;
};

export async function loadAiSdkModule(options?: LoadAiSdkOptions): Promise<{
	streamText: (input: Record<string, unknown>) => AiSdkStream;
}> {
	if (cachedAiModule) {
		return cachedAiModule;
	}
	options?.beforeImport?.();
	cachedAiModule = (await import("ai")) as unknown as {
		streamText: (input: Record<string, unknown>) => AiSdkStream;
	};
	return cachedAiModule;
}

export function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function defaultResolveUsageMetrics(usage: AiSdkUsage): AiSdkUsageMetrics {
	return {
		inputTokens: numberOrZero(usage.inputTokens),
		outputTokens: numberOrZero(usage.outputTokens),
		thoughtsTokenCount: numberOrZero(
			usage.reasoningTokens ?? usage.thoughtsTokenCount,
		),
		cacheReadTokens: numberOrZero(usage.cachedInputTokens),
	};
}

export async function* emitAiSdkStream(
	stream: AiSdkStream,
	options: EmitAiSdkStreamOptions,
): ApiStream {
	const resolveUsageMetrics =
		options.resolveUsageMetrics ?? defaultResolveUsageMetrics;
	const reasoningTypes = new Set(options.reasoningTypes ?? ["reasoning-delta"]);
	const toolCallArgsOrder = options.toolCallArgsOrder ?? ["args", "input"];
	const responseId = options.responseId;

	let usageEmitted = false;
	let textEmitted = false;

	if (stream.fullStream) {
		for await (const part of stream.fullStream) {
			const partType = part.type;

			if (partType === "text-delta") {
				const text =
					(part.textDelta as string | undefined) ??
					(part.text as string | undefined) ??
					(part.delta as string | undefined);
				if (text) {
					yield { type: "text", text, id: responseId };
					textEmitted = true;
				}
				continue;
			}

			if (partType && reasoningTypes.has(partType)) {
				const reasoning =
					(part.textDelta as string | undefined) ??
					(part.reasoning as string | undefined) ??
					(part.text as string | undefined);
				if (reasoning) {
					yield { type: "reasoning", reasoning, id: responseId };
				}
				continue;
			}

			if (partType === "tool-call" && options.enableToolCalls) {
				const toolCallId =
					(part.toolCallId as string | undefined) ??
					(part.id as string | undefined);
				const toolName =
					(part.toolName as string | undefined) ??
					(part.name as string | undefined);
				const args =
					toolCallArgsOrder
						.map((key) => part[key] as Record<string, unknown> | undefined)
						.find((candidate) => candidate !== undefined) ?? {};

				yield {
					type: "tool_calls",
					id: responseId,
					tool_call: {
						call_id: toolCallId,
						function: {
							id: options.toolCallFunctionIncludeId ? toolCallId : undefined,
							name: toolName,
							arguments: args,
						},
					},
				};
				continue;
			}

			if (partType === "error") {
				const message =
					(part.error as Error | undefined)?.message ?? options.errorMessage;
				throw new Error(message);
			}

			if (partType === "finish") {
				const usage = (part.totalUsage ?? part.usage ?? {}) as AiSdkUsage;
				const usageMetrics = resolveUsageMetrics(usage, part);

				yield {
					type: "usage",
					inputTokens: Math.max(
						0,
						usageMetrics.inputTokens - usageMetrics.cacheReadTokens,
					),
					outputTokens: usageMetrics.outputTokens,
					thoughtsTokenCount: usageMetrics.thoughtsTokenCount,
					cacheReadTokens: usageMetrics.cacheReadTokens,
					cacheWriteTokens: usageMetrics.cacheWriteTokens,
					totalCost: options.calculateCost(
						usageMetrics.inputTokens,
						usageMetrics.outputTokens,
						usageMetrics.cacheReadTokens,
						usageMetrics.cacheWriteTokens,
					),
					id: responseId,
				};
				usageEmitted = true;
			}
		}
	} else if (stream.textStream) {
		for await (const text of stream.textStream) {
			yield { type: "text", text, id: responseId };
			textEmitted = true;
		}
	}

	if (!textEmitted && options.enableTextFallback && stream.text) {
		const text = await stream.text;
		if (typeof text === "string" && text.length > 0) {
			yield { type: "text", text, id: responseId };
		}
	}

	if (!usageEmitted && stream.usage) {
		const usage = (await stream.usage) as AiSdkUsage;
		const usageMetrics = resolveUsageMetrics(usage);
		yield {
			type: "usage",
			inputTokens: Math.max(
				0,
				usageMetrics.inputTokens - usageMetrics.cacheReadTokens,
			),
			outputTokens: usageMetrics.outputTokens,
			thoughtsTokenCount: usageMetrics.thoughtsTokenCount,
			cacheReadTokens: usageMetrics.cacheReadTokens,
			cacheWriteTokens: usageMetrics.cacheWriteTokens,
			totalCost: options.calculateCost(
				usageMetrics.inputTokens,
				usageMetrics.outputTokens,
				usageMetrics.cacheReadTokens,
				usageMetrics.cacheWriteTokens,
			),
			id: responseId,
		};
	}

	yield { type: "done", success: true, id: responseId };
}
