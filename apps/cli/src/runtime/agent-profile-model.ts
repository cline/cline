import {
	Llms,
	ProviderSettingsManager,
	resolveProviderConfig,
} from "@cline/core";
import {
	getPersistedProviderApiKey,
	hasEnvProviderApiKey,
	isProviderConfigured,
	normalizeProviderId,
} from "../utils/provider-auth";
import type { ActiveAgentProfile, Config } from "../utils/types";

export interface AgentProfileModelSelectionResult {
	warning?: string;
}

/**
 * Applies a profile's providerId/modelId to the live session config, layered
 * on top of the user's persisted provider selection. Called once at profile
 * selection time (not on every restart) so a later explicit /model change by
 * the user wins for the rest of the session. Reverting to the default agent
 * (or switching to a profile without provider/model fields) restores the
 * user's persisted selection, which profile switches never write to.
 */
export async function applyAgentProfileModelSelection(
	config: Config,
	profile: Pick<ActiveAgentProfile, "providerId" | "modelId"> | undefined,
	options: {
		/** The profile active before this switch, for revert bookkeeping. */
		previousProfile?: Pick<ActiveAgentProfile, "providerId" | "modelId">;
	} = {},
): Promise<AgentProfileModelSelectionResult> {
	const manager = new ProviderSettingsManager();
	const userSettings = manager.getLastUsedProviderSettings();
	const baselineProvider = userSettings?.provider ?? config.providerId;
	// Normalize frontmatter aliases the same way --agent startup does.
	const targetProvider = profile?.providerId
		? normalizeProviderId(profile.providerId)
		: baselineProvider;
	const targetSettings =
		targetProvider === userSettings?.provider
			? userSettings
			: manager.getProviderSettings(targetProvider);

	// Fail soft when the profile names a provider the user has no credentials
	// for: keep the current provider and model, the persona still applies.
	// Env-declared API keys count, since request paths resolve them at runtime.
	if (
		profile?.providerId &&
		targetProvider !== config.providerId &&
		!isProviderConfigured(targetProvider, targetSettings) &&
		!hasEnvProviderApiKey(targetProvider)
	) {
		return {
			warning: `Agent profile requests provider "${targetProvider}" which is not configured; keeping ${config.providerId}. Use /model to configure it.`,
		};
	}

	const previousModelId = config.modelId;
	const providerChanged = targetProvider !== config.providerId;
	if (providerChanged) {
		config.providerId = targetProvider;
		config.apiKey =
			getPersistedProviderApiKey(targetProvider, targetSettings) ?? "";
		const resolved = await resolveProviderConfig(
			targetProvider,
			{
				loadLatestOnInit: true,
				loadPrivateOnAuth: true,
				failOnError: false,
			},
			manager.getProviderConfig(targetProvider, { includeKnownModels: false }),
		).catch(() => undefined);
		config.knownModels = resolved?.knownModels;
	}

	const knownModelIds = config.knownModels
		? Object.keys(config.knownModels)
		: [];
	// The current modelId is only a valid fallback when it is the user's own:
	// if the outgoing profile pinned a model and the persisted settings carry
	// none, falling back to it would leak the profile's model past the revert.
	const currentModelIsProfileDriven =
		options.previousProfile?.modelId !== undefined &&
		config.modelId === options.previousProfile.modelId;
	config.modelId =
		profile?.modelId ??
		targetSettings?.model ??
		(providerChanged || currentModelIsProfileDriven
			? (knownModelIds[0] ??
				Llms.getProviderCollectionSync(targetProvider)?.provider
					.defaultModelId ??
				config.modelId)
			: config.modelId);

	if (providerChanged || config.modelId !== previousModelId) {
		// Reasoning preferences belong to the user's persisted settings for the
		// target provider, same as session startup.
		const persistedReasoning = targetSettings?.reasoning;
		const effort =
			persistedReasoning?.enabled === false
				? "none"
				: persistedReasoning?.effort && persistedReasoning.effort !== "none"
					? persistedReasoning.effort
					: persistedReasoning?.enabled === true
						? "medium"
						: "none";
		config.thinking = effort !== "none";
		config.reasoningEffort = effort === "none" ? undefined : effort;
	}

	return {};
}
