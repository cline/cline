import type {
	RpcClineAccountActionRequest,
	RpcOAuthProviderId,
	RpcProviderActionRequest,
} from "@clinebot/core";
import {
	addLocalProvider,
	ClineAccountService,
	ensureCustomProvidersLoaded,
	executeRpcClineAccountAction,
	getLocalProviderModels,
	listLocalProviders,
	loginLocalProvider,
	normalizeOAuthProvider,
	ProviderSettingsManager,
	resolveLocalClineAuthToken,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
} from "@clinebot/core";

export async function runProviderAction(
	request: RpcProviderActionRequest,
): Promise<{ result: unknown }> {
	const manager = new ProviderSettingsManager();
	await ensureCustomProvidersLoaded(manager);
	const parsed = request;

	if (parsed.action === "clineAccount") {
		const settings = manager.getProviderSettings("cline");
		const accountService = new ClineAccountService({
			apiBaseUrl: settings?.baseUrl?.trim() || "https://api.cline.bot",
			getAuthToken: async () => resolveLocalClineAuthToken(settings),
		});
		return {
			result: await executeRpcClineAccountAction(
				parsed as RpcClineAccountActionRequest,
				accountService,
			),
		};
	}
	if (parsed.action === "listProviders") {
		return { result: await listLocalProviders(manager) };
	}
	if (parsed.action === "getProviderModels") {
		return { result: await getLocalProviderModels(parsed.providerId) };
	}
	if (parsed.action === "addProvider") {
		return { result: await addLocalProvider(manager, parsed) };
	}
	if (parsed.action === "saveProviderSettings") {
		return { result: saveLocalProviderSettings(manager, parsed) };
	}
	throw new Error(`unsupported provider action: ${String(parsed)}`);
}

export async function runProviderOAuthLogin(
	provider: string,
): Promise<{ provider: RpcOAuthProviderId; accessToken: string }> {
	const providerId = normalizeOAuthProvider(provider);
	const manager = new ProviderSettingsManager();
	const existing = manager.getProviderSettings(providerId);
	const credentials = await loginLocalProvider(providerId, existing, (url) => {
		throw new Error(`RPC OAuth login cannot open browser directly: ${url}`);
	});
	const saved = saveLocalProviderOAuthCredentials(
		manager,
		providerId,
		existing,
		credentials,
	);
	const resolvedKey = saved.auth?.accessToken ?? saved.apiKey ?? "";
	return {
		provider: providerId,
		accessToken: resolvedKey,
	};
}
