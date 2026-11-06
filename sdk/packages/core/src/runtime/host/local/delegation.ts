import { getProvider, hasRegisteredHandler } from "@cline/llms";
import type { DelegationTarget } from "@cline/shared";
import { isOAuthProvider } from "../../../auth/provider-auth-registry";
import {
	createDelegatedAgentConfigProvider,
	type DelegatedAgentConnectionConfig,
	type ResolveDelegatedAgentConfig,
} from "../../../extensions/tools/team/delegated-agent";
import type { ProviderConfig } from "../../../services/llms/provider-settings";
import { buildProviderConfig } from "../../../services/local-runtime-bootstrap";
import type { ProviderSettingsManager } from "../../../services/storage/provider-settings-manager";
import type { RuntimeOAuthTokenManager } from "../../orchestration/runtime-oauth-token-manager";
import type { ResolvedStartSessionInput } from "../runtime-host";

function connection(
	config: ProviderConfig,
	target: DelegationTarget,
): DelegatedAgentConnectionConfig {
	return {
		...target,
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		headers: config.headers,
		providerConfig: config,
		knownModels: config.knownModels,
		thinking: config.thinking,
		reasoningEffort: config.reasoningEffort,
		thinkingBudgetTokens: config.thinkingBudgetTokens,
		maxTokensPerTurn: config.maxOutputTokens,
		temperature: config.temperature,
		extensionContext: config.extensionContext,
	};
}

export function createDelegationResolver(options: {
	sessionId: string;
	source: ResolvedStartSessionInput["source"];
	settings: ProviderSettingsManager;
	oauth: RuntimeOAuthTokenManager;
	fetch?: typeof fetch;
}): ResolveDelegatedAgentConfig {
	const resolve: ResolveDelegatedAgentConfig = async (
		requested,
		parent,
		signal,
	) => {
		const target = requested ?? {
			providerId: parent.providerId,
			modelId: parent.modelId,
		};
		const sameProvider = target.providerId === parent.providerId;
		// Only the same connection may contribute inline credentials or endpoint overrides.
		const config: Parameters<typeof buildProviderConfig>[0] = {
			...target,
			extensionContext: parent.extensionContext,
			...(sameProvider
				? {
						apiKey: parent.apiKey ?? parent.providerConfig?.apiKey,
						baseUrl: parent.baseUrl,
						headers: parent.headers,
						providerConfig: parent.providerConfig
							? {
									...parent.providerConfig,
									modelId: target.modelId,
									apiKey: parent.apiKey ?? parent.providerConfig.apiKey,
								}
							: undefined,
						knownModels: parent.knownModels,
					}
				: {}),
		};
		signal?.throwIfAborted();
		if (!config.apiKey && isOAuthProvider(target.providerId)) {
			config.apiKey = (
				await options.oauth.resolveProviderApiKey(target)
			)?.apiKey;
		}
		signal?.throwIfAborted();
		const prepared = buildProviderConfig(
			config,
			options.sessionId,
			options.source,
			options.settings,
			undefined,
			options.fetch,
		);
		if (
			!(await getProvider(target.providerId)) &&
			!hasRegisteredHandler(target.providerId)
		)
			throw new Error(`Unknown delegation provider "${target.providerId}".`);
		signal?.throwIfAborted();
		const child = createDelegatedAgentConfigProvider(
			{
				...parent,
				...connection(prepared, target),
				...(!requested
					? {
							thinking: parent.thinking,
							reasoningEffort: parent.reasoningEffort,
							thinkingBudgetTokens: parent.thinkingBudgetTokens,
							maxTokensPerTurn: parent.maxTokensPerTurn,
							temperature: parent.temperature,
						}
					: {}),
				onAuthError: isOAuthProvider(target.providerId)
					? async () => {
							const refreshed = await options.oauth.resolveProviderApiKey({
								providerId: target.providerId,
								forceRefresh: true,
							});
							if (!refreshed?.apiKey) return false;
							config.apiKey = refreshed.apiKey;
							if (config.providerConfig)
								config.providerConfig = {
									...config.providerConfig,
									apiKey: refreshed.apiKey,
									accessToken: refreshed.apiKey,
									accountId: refreshed.accountId,
								};
							const fresh = buildProviderConfig(
								config,
								options.sessionId,
								options.source,
								options.settings,
								undefined,
								options.fetch,
							);
							child.updateConnectionDefaults({
								apiKey: fresh.apiKey,
								baseUrl: fresh.baseUrl,
								headers: fresh.headers,
								providerConfig: fresh,
							});
							return true;
						}
					: undefined,
			},
			resolve,
		);
		return child;
	};
	return resolve;
}
