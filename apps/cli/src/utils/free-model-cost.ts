import type { AgentEvent } from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";
import type { Config } from "./types";

const CLINE_RECOMMENDED_MODELS_TIMEOUT_MS = 5_000;
const freeModelIdsByBaseUrl = new Map<string, Promise<readonly string[]>>();

function normalizeModelId(modelId: string | undefined): string {
	return modelId?.trim().toLowerCase() ?? "";
}

function modelIdsMatch(selectedModelId: string, freeModelId: string): boolean {
	const selected = normalizeModelId(selectedModelId);
	const free = normalizeModelId(freeModelId);
	if (!selected || !free) return false;
	return (
		selected === free || selected.split("/").pop() === free.split("/").pop()
	);
}

function resolveClineRecommendedModelsUrl(baseUrl: string): string {
	const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
	const apiBaseUrl = normalizedBaseUrl.endsWith("/api/v1")
		? normalizedBaseUrl.slice(0, -"/api/v1".length)
		: normalizedBaseUrl;
	return `${apiBaseUrl}/api/v1/ai/cline/recommended-models`;
}

async function fetchClineFreeModelIds(
	baseUrl: string,
): Promise<readonly string[]> {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		CLINE_RECOMMENDED_MODELS_TIMEOUT_MS,
	);
	try {
		const response = await fetch(resolveClineRecommendedModelsUrl(baseUrl), {
			signal: controller.signal,
		});
		if (!response.ok) return [];
		const json = (await response.json()) as { free?: unknown };
		return Array.isArray(json.free)
			? json.free
					.map((model) =>
						model && typeof model === "object"
							? (model as Record<string, unknown>).id
							: undefined,
					)
					.filter((id): id is string => typeof id === "string" && id.length > 0)
			: [];
	} catch {
		return [];
	} finally {
		clearTimeout(timeout);
	}
}

function getClineFreeModelIds(baseUrl: string): Promise<readonly string[]> {
	const cacheKey = baseUrl.trim();
	let cached = freeModelIdsByBaseUrl.get(cacheKey);
	if (!cached) {
		cached = fetchClineFreeModelIds(cacheKey);
		freeModelIdsByBaseUrl.set(cacheKey, cached);
	}
	return cached;
}

export async function shouldZeroClineFreeModelCost(
	config: Pick<Config, "providerId" | "modelId" | "baseUrl">,
): Promise<boolean> {
	if (config.providerId !== "cline") return false;
	const modelId = normalizeModelId(config.modelId);
	if (!modelId) return false;

	const baseUrl =
		config.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl;
	const freeModelIds = await getClineFreeModelIds(baseUrl);
	return freeModelIds.some((freeModelId) =>
		modelIdsMatch(modelId, freeModelId),
	);
}

export function zeroCliUsageCost<T extends { totalCost?: number } | undefined>(
	usage: T,
	shouldZeroCost: boolean,
): T {
	if (
		!shouldZeroCost ||
		!usage ||
		typeof usage.totalCost !== "number" ||
		usage.totalCost === 0
	) {
		return usage;
	}
	return { ...usage, totalCost: 0 } as T;
}

export function zeroCliAgentEventCost(
	event: AgentEvent,
	shouldZeroCost: boolean,
): AgentEvent {
	if (!shouldZeroCost) return event;
	if (event.type === "done" && event.usage) {
		return {
			...event,
			usage: zeroCliUsageCost(event.usage, true),
		};
	}
	if (event.type !== "usage") return event;
	const next = { ...event } as Record<string, unknown>;
	if (typeof next.cost === "number") next.cost = 0;
	if (typeof next.totalCost === "number") next.totalCost = 0;
	return next as unknown as AgentEvent;
}

export function clearClineFreeModelCostCache(): void {
	freeModelIdsByBaseUrl.clear();
}
