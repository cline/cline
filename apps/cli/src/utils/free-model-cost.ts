import { type AgentEvent, ProviderSettingsManager } from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";
import { getCliProviderSettingsManager } from "./provider-settings";
import type { Config } from "./types";

const managers = new Map<string, ProviderSettingsManager>();
function getManager(baseUrl: string): ProviderSettingsManager {
	let manager = managers.get(baseUrl);
	if (!manager) {
		manager = new ProviderSettingsManager({
			...getCliProviderSettingsManager().getCatalogContext(),
			baseUrl,
		});
		managers.set(baseUrl, manager);
	}
	return manager;
}
function normalizeModelId(modelId: string | undefined): string {
	return modelId?.trim().toLowerCase() ?? "";
}

function modelIdsMatch(selectedModelId: string, freeModelId: string): boolean {
	const selected = normalizeModelId(selectedModelId);
	const free = normalizeModelId(freeModelId);
	if (!selected || !free) return false;
	return selected === free;
}

export async function shouldZeroClineFreeModelCost(
	config: Pick<Config, "providerId" | "modelId" | "baseUrl">,
): Promise<boolean> {
	// Free models are also selectable on ClinePass — they ride usage billing at $0
	if (config.providerId !== "cline" && config.providerId !== "cline-pass")
		return false;
	const modelId = normalizeModelId(config.modelId);
	if (!modelId) return false;

	const baseUrl =
		config.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl;
	const freeModelIds = await getManager(baseUrl).getFreeModelIds();
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
	managers.clear();
}
