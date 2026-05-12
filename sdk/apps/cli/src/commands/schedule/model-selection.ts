import { type ProviderSettings, ProviderSettingsManager } from "@cline/core";

export const DEFAULT_SCHEDULE_PROVIDER = "cline";
export const DEFAULT_SCHEDULE_MODEL = "openai/gpt-5.3-codex";

interface ProviderSettingsReader {
	getLastUsedProviderSettings(): ProviderSettings | undefined;
	getProviderSettings(providerId: string): ProviderSettings | undefined;
}

function trimToUndefined(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function resolveScheduleModelSelection(
	options: {
		provider?: string;
		model?: string;
	},
	providerSettingsManager?: ProviderSettingsReader,
): { provider: string; model: string } {
	const explicitProvider = trimToUndefined(options.provider);
	const explicitModel = trimToUndefined(options.model);
	if (explicitProvider && explicitModel) {
		return { provider: explicitProvider, model: explicitModel };
	}
	const manager = providerSettingsManager ?? new ProviderSettingsManager();
	const lastUsedSettings = manager.getLastUsedProviderSettings();
	const provider =
		explicitProvider ??
		trimToUndefined(lastUsedSettings?.provider) ??
		DEFAULT_SCHEDULE_PROVIDER;
	const selectedProviderSettings = explicitProvider
		? manager.getProviderSettings(provider)
		: lastUsedSettings;
	const model =
		explicitModel ??
		trimToUndefined(selectedProviderSettings?.model) ??
		DEFAULT_SCHEDULE_MODEL;
	return { provider, model };
}
