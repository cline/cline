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
