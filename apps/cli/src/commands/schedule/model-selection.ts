import { type ProviderSettings, ProviderSettingsManager } from "@cline/core";
import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";

export const DEFAULT_SCHEDULE_PROVIDER = "cline";

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
		(provider === DEFAULT_SCHEDULE_PROVIDER
			? CLINE_DEFAULT_MODEL_ID
			: undefined);

	if (!model) {
		throw new Error(
			`No model is configured for provider "${provider}". Pass --model or save a model for that provider before creating the schedule.`,
		);
	}

	return { provider, model };
}
