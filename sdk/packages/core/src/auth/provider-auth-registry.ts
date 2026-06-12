import {
	getClineEnvironmentConfig,
	type ITelemetryService,
} from "@cline/shared";
import type { ProviderSettingsManager } from "../services/storage/provider-settings-manager";
import type { ProviderSettings } from "../types/provider-settings";
import {
	type ClineOAuthCredentials,
	getValidClineCredentials,
	loginClineOAuth,
} from "./cline";
import { getValidOpenAICodexCredentials, loginOpenAICodex } from "./codex";
import { getValidOcaCredentials, loginOcaOAuth } from "./oca";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./types";
import { decodeJwtPayload } from "./utils";

const WORKOS_TOKEN_PREFIX = "workos:";

export type ProviderOAuthCredentials = OAuthCredentials;

export interface ProviderAuthLoginInput {
	settings?: ProviderSettings;
	callbacks: OAuthLoginCallbacks;
	telemetry?: ITelemetryService;
}

export interface ProviderAuthRefreshInput {
	settings: ProviderSettings;
	credentials: ProviderOAuthCredentials;
	forceRefresh?: boolean;
	telemetry?: ITelemetryService;
}

export interface ProviderAuthSaveCredentialsInput {
	manager: ProviderSettingsManager;
	settings?: ProviderSettings;
	credentials: ProviderOAuthCredentials;
	setLastUsed?: boolean;
	save?: boolean;
}

export interface ProviderAuthHandler {
	providerId: string;
	storageProviderId: string;
	getApiKey(settings: ProviderSettings | undefined): string | undefined;
	login(input: ProviderAuthLoginInput): Promise<ProviderOAuthCredentials>;
	refresh(
		input: ProviderAuthRefreshInput,
	): Promise<ProviderOAuthCredentials | null>;
	saveCredentials(input: ProviderAuthSaveCredentialsInput): ProviderSettings;
	isConfigured(settings: ProviderSettings | undefined): boolean;
	normalizeStoredAccessToken?(accessToken: string): string;
}

function formatClineApiKey(accessToken: string): string {
	const token = accessToken.trim();
	return token.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX)
		? token
		: `${WORKOS_TOKEN_PREFIX}${token}`;
}

function stripClineApiKeyPrefix(accessToken: string): string {
	const token = accessToken.trim();
	return token.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX)
		? token.slice(WORKOS_TOKEN_PREFIX.length)
		: token;
}

function readExpiryFromToken(accessToken: string): number | null {
	const payload = decodeJwtPayload(accessToken);
	const exp = payload?.exp;
	if (typeof exp === "number" && exp > 0) {
		return exp * 1000;
	}
	return null;
}

function deriveCredentialExpiry(
	settings: ProviderSettings,
	normalizedAccessToken: string,
): number {
	const explicitExpiry = settings.auth?.expiresAt;
	if (
		typeof explicitExpiry === "number" &&
		Number.isFinite(explicitExpiry) &&
		explicitExpiry > 0
	) {
		return explicitExpiry;
	}

	const jwtExpiry = readExpiryFromToken(normalizedAccessToken);
	if (jwtExpiry) {
		return jwtExpiry;
	}

	// Unknown expiry should trigger refresh on next resolution.
	return Date.now() - 1;
}

function createCredentialsFromSettings(
	settings: ProviderSettings,
	options?: { normalizeAccessToken?: (accessToken: string) => string },
): ProviderOAuthCredentials | null {
	const rawAccess = settings.auth?.accessToken?.trim();
	const refreshToken = settings.auth?.refreshToken?.trim();
	if (!rawAccess || !refreshToken) {
		return null;
	}
	const access = options?.normalizeAccessToken?.(rawAccess) ?? rawAccess;
	if (!access) {
		return null;
	}

	return {
		access,
		refresh: refreshToken,
		expires: deriveCredentialExpiry(settings, access),
		accountId: settings.auth?.accountId,
	};
}

function saveOAuthCredentials(input: {
	manager: ProviderSettingsManager;
	storageProviderId: string;
	settings?: ProviderSettings;
	credentials: ProviderOAuthCredentials;
	formatAccessToken?: (accessToken: string) => string;
	setLastUsed?: boolean;
	save?: boolean;
}): ProviderSettings {
	const accessToken =
		input.formatAccessToken?.(input.credentials.access) ??
		input.credentials.access;
	const auth = {
		...(input.settings?.auth ?? {}),
		accessToken,
		refreshToken: input.credentials.refresh,
		accountId: input.credentials.accountId,
		expiresAt: input.credentials.expires,
	};

	const merged: ProviderSettings = {
		...(input.settings ?? {
			provider: input.storageProviderId as ProviderSettings["provider"],
		}),
		provider: input.storageProviderId as ProviderSettings["provider"],
		auth,
	};
	if (input.save !== false) {
		input.manager.saveProviderSettings(merged, {
			...(input.setLastUsed === undefined
				? {}
				: { setLastUsed: input.setLastUsed }),
			tokenSource: "oauth",
		});
	}
	return merged;
}

function createOAuthHandler(input: {
	providerId: string;
	storageProviderId?: string;
	formatAccessToken?: (accessToken: string) => string;
	normalizeStoredAccessToken?: (accessToken: string) => string;
	login: (input: ProviderAuthLoginInput) => Promise<ProviderOAuthCredentials>;
	refresh: (
		input: ProviderAuthRefreshInput,
	) => Promise<ProviderOAuthCredentials | null>;
}): ProviderAuthHandler {
	const storageProviderId = input.storageProviderId ?? input.providerId;
	return {
		providerId: input.providerId,
		storageProviderId,
		getApiKey(settings) {
			const accessToken = settings?.auth?.accessToken?.trim();
			if (accessToken) {
				return input.formatAccessToken?.(accessToken) ?? accessToken;
			}

			return (
				settings?.apiKey?.trim() || settings?.auth?.apiKey?.trim() || undefined
			);
		},
		login: input.login,
		refresh: input.refresh,
		saveCredentials(saveInput) {
			return saveOAuthCredentials({
				...saveInput,
				storageProviderId,
				formatAccessToken: input.formatAccessToken,
			});
		},
		isConfigured(settings) {
			return !!settings?.auth?.accessToken;
		},
		normalizeStoredAccessToken: input.normalizeStoredAccessToken,
	};
}

const providerAuthHandlers = [
	createOAuthHandler({
		providerId: "cline",
		formatAccessToken: formatClineApiKey,
		normalizeStoredAccessToken: stripClineApiKeyPrefix,
		login: ({ settings, callbacks, telemetry }) =>
			loginClineOAuth({
				apiBaseUrl:
					settings?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
				useWorkOSDeviceAuth: true,
				callbacks,
				telemetry,
			}),
		refresh: ({ settings, credentials, forceRefresh, telemetry }) =>
			getValidClineCredentials(
				credentials as ClineOAuthCredentials,
				{
					apiBaseUrl:
						settings.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
					telemetry,
				},
				{ forceRefresh },
			),
	}),
	createOAuthHandler({
		providerId: "oca",
		login: ({ settings, callbacks, telemetry }) =>
			loginOcaOAuth({ mode: settings?.oca?.mode, callbacks, telemetry }),
		refresh: ({ settings, credentials, forceRefresh, telemetry }) =>
			getValidOcaCredentials(
				credentials,
				{ forceRefresh, telemetry },
				{ mode: settings.oca?.mode, telemetry },
			),
	}),
	createOAuthHandler({
		providerId: "openai-codex",
		login: ({ callbacks, telemetry }) =>
			loginOpenAICodex({
				onAuth: callbacks.onAuth,
				onPrompt: callbacks.onPrompt,
				onProgress: callbacks.onProgress,
				onManualCodeInput: callbacks.onManualCodeInput,
				telemetry,
			}),
		refresh: ({ credentials, forceRefresh, telemetry }) =>
			getValidOpenAICodexCredentials(credentials, { forceRefresh, telemetry }),
	}),
] as const satisfies readonly ProviderAuthHandler[];

const providerAuthHandlerById = new Map<string, ProviderAuthHandler>(
	providerAuthHandlers.map((handler) => [handler.providerId, handler]),
);

export function getProviderAuthHandler(
	providerId: string,
): ProviderAuthHandler | undefined {
	return providerAuthHandlerById.get(providerId.trim().toLowerCase());
}

export function isOAuthProvider(providerId: string): boolean {
	return getProviderAuthHandler(providerId) !== undefined;
}

export function getProviderAuthStorageId(
	providerId: string,
): string | undefined {
	return getProviderAuthHandler(providerId)?.storageProviderId;
}

export function resolveProviderApiKeyFromSettings(
	manager: ProviderSettingsManager,
	providerId: string,
): string | undefined {
	const handler = getProviderAuthHandler(providerId);
	const storageProviderId = handler?.storageProviderId ?? providerId;
	const settings = manager.getProviderSettings(storageProviderId);
	return (
		handler?.getApiKey(settings) ??
		getPersistedProviderApiKey(providerId, settings)
	);
}

export async function loginAndSaveProviderOAuthCredentials(
	manager: ProviderSettingsManager,
	providerId: string,
	input: {
		callbacks: OAuthLoginCallbacks;
		telemetry?: ITelemetryService;
	},
): Promise<ProviderSettings> {
	const handler = getProviderAuthHandler(providerId);
	if (!handler) {
		throw new Error(`Provider "${providerId}" does not support OAuth login`);
	}
	const existing = manager.getProviderSettings(handler.storageProviderId);
	const credentials = await handler.login({
		settings: existing,
		callbacks: input.callbacks,
		telemetry: input.telemetry,
	});
	return handler.saveCredentials({ manager, settings: existing, credentials });
}

export function getProviderOAuthCredentialsFromSettings(
	providerId: string,
	settings: ProviderSettings,
): ProviderOAuthCredentials | null {
	const handler = getProviderAuthHandler(providerId);
	if (!handler) return null;
	return createCredentialsFromSettings(settings, {
		normalizeAccessToken: handler.normalizeStoredAccessToken,
	});
}

export function saveProviderOAuthCredentials(input: {
	manager: ProviderSettingsManager;
	providerId: string;
	settings?: ProviderSettings;
	credentials: ProviderOAuthCredentials;
	setLastUsed?: boolean;
	save?: boolean;
}): ProviderSettings {
	const handler = getProviderAuthHandler(input.providerId);
	if (!handler) {
		throw new Error(
			`Provider "${input.providerId}" does not support OAuth credentials`,
		);
	}
	return handler.saveCredentials({
		manager: input.manager,
		settings: input.settings,
		credentials: input.credentials,
		setLastUsed: input.setLastUsed,
		save: input.save,
	});
}

export function getPersistedProviderApiKey(
	providerId: string,
	settings?: ProviderSettings,
): string | undefined {
	const handler = getProviderAuthHandler(providerId);
	if (handler) {
		return handler.getApiKey(settings);
	}

	return (
		settings?.auth?.accessToken ?? settings?.apiKey ?? settings?.auth?.apiKey
	);
}

export function formatProviderOAuthApiKey(
	providerId: string,
	credentials: Pick<ProviderOAuthCredentials, "access">,
): string {
	const handler = getProviderAuthHandler(providerId);
	if (!handler) return credentials.access;

	return (
		handler.getApiKey({
			provider: handler.storageProviderId,
			auth: { accessToken: credentials.access },
		}) ?? credentials.access
	);
}
