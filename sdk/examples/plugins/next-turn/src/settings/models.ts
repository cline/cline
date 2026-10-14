/**
 * The planner's model choices. The hub does not handle `catalog.list`, so
 * the settings page lists the person's configured providers from
 * `@cline/core`'s `ProviderSettingsManager`, the same store the planner
 * resolves its model from. Provider and model ids only: no key, token or
 * account field leaves this module.
 */

import { isRecord } from "../values";

export type ModelChoice = {
	providerId: string;
	modelId?: string;
	lastUsed: boolean;
};

/** Choices from a `StoredProviderSettings` value: the last-used provider first, then by id. */
export function modelChoices(stored: unknown): ModelChoice[] {
	if (!isRecord(stored) || !isRecord(stored.providers)) return [];
	const lastUsed =
		typeof stored.lastUsedProvider === "string"
			? stored.lastUsedProvider
			: undefined;
	const choices: ModelChoice[] = [];
	for (const [providerId, entry] of Object.entries(stored.providers)) {
		const settings =
			isRecord(entry) && isRecord(entry.settings) ? entry.settings : {};
		const modelId =
			typeof settings.model === "string" && settings.model.trim()
				? settings.model
				: undefined;
		choices.push({ providerId, modelId, lastUsed: providerId === lastUsed });
	}
	return choices.sort(
		(a, b) =>
			Number(b.lastUsed) - Number(a.lastUsed) ||
			a.providerId.localeCompare(b.providerId),
	);
}

/** Reads the host's provider settings; `@cline/core` is imported on first use. */
export async function readModelChoices(): Promise<ModelChoice[]> {
	const core = await import("@cline/core");
	return modelChoices(new core.ProviderSettingsManager().read());
}
