import type * as LlmsProviders from "@clinebot/llms";
import type { SessionAccumulatedUsage } from "../runtime/host/runtime-host";

export function createInitialAccumulatedUsage(): SessionAccumulatedUsage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost: 0,
	};
}

export function accumulateUsageTotals(
	baseline: SessionAccumulatedUsage,
	usage: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
	},
): SessionAccumulatedUsage {
	return {
		inputTokens: baseline.inputTokens + Math.max(0, usage.inputTokens ?? 0),
		outputTokens: baseline.outputTokens + Math.max(0, usage.outputTokens ?? 0),
		cacheReadTokens:
			baseline.cacheReadTokens + Math.max(0, usage.cacheReadTokens ?? 0),
		cacheWriteTokens:
			baseline.cacheWriteTokens + Math.max(0, usage.cacheWriteTokens ?? 0),
		totalCost: baseline.totalCost + Math.max(0, usage.totalCost ?? 0),
	};
}

function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function summarizeUsageFromMessages(
	messages: LlmsProviders.Message[],
): SessionAccumulatedUsage {
	let usage = createInitialAccumulatedUsage();
	for (const message of messages) {
		const metrics = (message as LlmsProviders.MessageWithMetadata).metrics;
		if (!metrics) {
			continue;
		}
		usage = accumulateUsageTotals(usage, {
			inputTokens: asNumber(metrics.inputTokens),
			outputTokens: asNumber(metrics.outputTokens),
			cacheReadTokens: asNumber(metrics.cacheReadTokens),
			cacheWriteTokens: asNumber(metrics.cacheWriteTokens),
			totalCost: asNumber(metrics.cost),
		});
	}
	return usage;
}

/**
 * Current model context-window usage, derived from the latest assistant LLM
 * call. Provider usage is normalized so `inputTokens` is already the full
 * prompt size, including any cache-read/cache-write portions. Do not add cache
 * fields back on top.
 */
export function getCurrentContextSize(
	messages: readonly LlmsProviders.Message[],
): number | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i] as
			| LlmsProviders.MessageWithMetadata
			| undefined;
		if (message?.role !== "assistant") continue;
		const inputTokens = asNumber(message.metrics?.inputTokens);
		return inputTokens > 0 ? inputTokens : undefined;
	}
	return undefined;
}
