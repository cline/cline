import process from "node:process";
import {
	ensureCustomProvidersLoaded,
	getLocalProviderModels,
	Llms,
	listLocalProviders,
	loginAndSaveLocalProviderOAuthCredentials,
	markLocalProviderEnabled,
	normalizeOAuthProvider,
	saveLocalProviderSettings,
} from "@cline/core";
import type {
	WebviewInboundMessage,
	WebviewProviderModel,
} from "../webview-protocol";
import { providerSettingsManager, workspaceRoot } from "./deps";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";
import { openExternalUrl } from "./utils";

export function resolveBrowserDefaults(ctx: HubContext): {
	provider?: string;
	model?: string;
	workspaceRoot: string;
	cwd: string;
} {
	const lastUsed = providerSettingsManager.getLastUsedProviderSettings();
	return {
		provider:
			lastUsed?.provider ??
			ctx.lastSessionContext?.providerId ??
			process.env.CLINE_PROVIDER?.trim(),
		model:
			lastUsed?.model ??
			ctx.lastSessionContext?.modelId ??
			process.env.CLINE_MODEL?.trim(),
		workspaceRoot: ctx.lastSessionContext?.workspaceRoot ?? workspaceRoot,
		cwd:
			ctx.lastSessionContext?.cwd ??
			ctx.lastSessionContext?.workspaceRoot ??
			workspaceRoot,
	};
}

export async function loadProviders(
	ctx: HubContext,
	peer: BrowserPeer,
): Promise<void> {
	await ensureCustomProvidersLoaded(providerSettingsManager);
	const state = providerSettingsManager.read();
	const defaults = resolveBrowserDefaults(ctx);
	const ids = Llms.getProviderIds().sort((a, b) => a.localeCompare(b));
	const providers = (
		await Promise.all(
			ids.map(async (id) => {
				const info = await Llms.getProvider(id);
				const enabled =
					Boolean(state.providers[id]?.settings) || id === defaults.provider;
				return {
					id,
					name: info?.name ?? id,
					enabled,
					defaultModelId: info?.defaultModelId,
				};
			}),
		)
	).filter((provider) => provider.enabled);
	ctx.send(peer, { type: "providers", providers });
	const selected =
		(defaults.provider &&
			providers.find((provider) => provider.id === defaults.provider)) ||
		providers[0];
	if (selected) {
		await loadModels(ctx, peer, selected.id);
	}
}

export async function loadModels(
	ctx: HubContext,
	peer: BrowserPeer,
	providerId: string,
): Promise<void> {
	const provider = providerId.trim();
	if (!provider) return;
	const payload = await getLocalProviderModels(
		provider,
		providerSettingsManager.getProviderConfig(provider),
	);
	const models: WebviewProviderModel[] = payload.models.map((model) => ({
		id: model.id,
		name: model.name,
		supportsReasoning: model.supportsReasoning,
		supportsThinking: model.supportsReasoning,
	}));
	ctx.send(peer, { type: "models", providerId: provider, models });
}

export async function sendProviderCatalog(
	ctx: HubContext,
	peer: BrowserPeer,
): Promise<void> {
	await ensureCustomProvidersLoaded(providerSettingsManager);
	const payload = await listLocalProviders(providerSettingsManager, {
		isClinePassEnabled: true,
	});
	ctx.send(peer, {
		type: "provider_catalog",
		providers: payload.providers,
		settingsPath: payload.settingsPath,
	});
}

export async function saveProviderSettings(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: Extract<WebviewInboundMessage, { type: "saveProviderSettings" }>,
): Promise<void> {
	const result = saveLocalProviderSettings(providerSettingsManager, {
		providerId: frame.providerId,
		enabled: frame.enabled,
		apiKey: frame.apiKey,
		baseUrl: frame.baseUrl,
	});
	ctx.send(peer, {
		type: "provider_settings_saved",
		providerId: result.providerId,
		enabled: result.enabled,
	});
	await sendProviderCatalog(ctx, peer);
	await loadProviders(ctx, peer);
}

export async function runProviderOAuthLogin(
	ctx: HubContext,
	peer: BrowserPeer,
	providerId: string,
): Promise<void> {
	const normalized = normalizeOAuthProvider(providerId);
	const saved = await loginAndSaveLocalProviderOAuthCredentials(
		providerSettingsManager,
		normalized,
		openExternalUrl,
	);
	if (saved.provider !== normalized) {
		markLocalProviderEnabled(providerSettingsManager, normalized, {
			tokenSource: "oauth",
		});
	}
	ctx.send(peer, {
		type: "provider_oauth_login_done",
		providerId: normalized,
		accessTokenPresent:
			(saved.auth?.accessToken?.trim() ?? saved.apiKey?.trim() ?? "").length >
			0,
	});
	await sendProviderCatalog(ctx, peer);
	await loadProviders(ctx, peer);
}
