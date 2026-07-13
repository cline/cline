import {
	decodeJwtPayload,
	getClineEnvironmentConfig,
	type ITelemetryService,
} from "@cline/shared";
import { hashSecret, sdkDebug } from "../logging/early-logger";
import type { ProviderSettingsManager } from "../services/storage/provider-settings-manager";
import { withSettingsRefreshLock } from "../services/storage/settings-file-lock";
import {
	captureAuthLoggedOut,
	captureAuthRefreshRecovered,
} from "../services/telemetry/core-events";
import type { ProviderSettings } from "../types/provider-settings";
import {
	type ClineOAuthCredentials,
	getValidClineCredentials,
	loginClineOAuth,
} from "./cline";
import { getValidOpenAICodexCredentials, loginOpenAICodex } from "./codex";
import { getValidOcaCredentials, loginOcaOAuth } from "./oca";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./types";

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
	/**
	 * Set by refreshProviderOAuthCredentialsFromStore, which owns the
	 * logged-out decision (it can recover from invalid_grant by adopting
	 * credentials rotated by another process). Handlers that emit logged-out
	 * telemetry should skip it when this is true.
	 */
	suppressLoggedOutTelemetry?: boolean;
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
		metadata: settings.auth?.metadata,
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
	const auth: NonNullable<ProviderSettings["auth"]> = {
		...(input.settings?.auth ?? {}),
		accessToken,
		refreshToken: input.credentials.refresh,
		accountId: input.credentials.accountId,
		expiresAt: input.credentials.expires,
	};
	const incomingMetadata = Object.fromEntries(
		Object.entries(input.credentials.metadata ?? {}).filter(
			([, value]) => value !== undefined,
		),
	);
	const metadata = {
		...(input.settings?.auth?.metadata ?? {}),
		...incomingMetadata,
	};
	if (Object.keys(metadata).length > 0) {
		auth.metadata = metadata;
	}

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

function createClineAuthHandler(input: {
	providerId: string;
	storageProviderId?: string;
}): ProviderAuthHandler {
	return createOAuthHandler({
		providerId: input.providerId,
		storageProviderId: input.storageProviderId,
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
		refresh: ({
			settings,
			credentials,
			forceRefresh,
			telemetry,
			suppressLoggedOutTelemetry,
		}) =>
			getValidClineCredentials(
				credentials as ClineOAuthCredentials,
				{
					apiBaseUrl:
						settings.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
					telemetry,
				},
				{
					forceRefresh,
					emitLoggedOutTelemetry: suppressLoggedOutTelemetry !== true,
				},
			),
	});
}

const providerAuthHandlers = [
	createClineAuthHandler({ providerId: "cline" }),
	createClineAuthHandler({
		providerId: "cline-pass",
		storageProviderId: "cline",
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
		settings?.auth?.accessToken?.trim() ||
		settings?.apiKey?.trim() ||
		settings?.auth?.apiKey?.trim() ||
		undefined
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

export type ProviderOAuthRefreshOutcome =
	| {
			status: "ok";
			settings: ProviderSettings;
			credentials: ProviderOAuthCredentials;
			refreshed: boolean;
	  }
	| { status: "no_credentials" }
	| { status: "reauth_required" };

function credentialsEqual(
	a: ProviderOAuthCredentials,
	b: ProviderOAuthCredentials,
): boolean {
	return (
		a.access === b.access &&
		a.refresh === b.refresh &&
		a.expires === b.expires &&
		a.accountId === b.accountId
	);
}

/**
 * Refresh a provider's OAuth credentials against the shared settings store
 * (providers.json). This is the ONLY correct way to rotate tokens: refresh
 * tokens are single-use upstream and the store is shared by every Cline
 * process on the machine (CLI, extension, hub), so rotation must be
 * serialized and recoverable.
 *
 * Inside a cross-process lock this: re-reads the store (adopting a rotation
 * that finished while we waited), refreshes, and — if the refresh comes back
 * invalid_grant — re-checks the store once more before concluding the session
 * is dead, in case a non-cooperating process (e.g. the legacy extension)
 * rotated the token mid-flight. `reauth_required` is returned only when the
 * on-disk refresh token itself was rejected; that is the single place the
 * logged-out decision is made.
 *
 * Returns `no_credentials` when the store has no usable credentials, and
 * THROWS on transient refresh failures (network/5xx) — the store is left
 * untouched in that case.
 */
export async function refreshProviderOAuthCredentialsFromStore(input: {
	manager: ProviderSettingsManager;
	providerId: string;
	forceRefresh?: boolean;
	telemetry?: ITelemetryService;
	/** Fallback API base URL when the stored settings carry no baseUrl. */
	apiBaseUrl?: string;
}): Promise<ProviderOAuthRefreshOutcome> {
	const handler = getProviderAuthHandler(input.providerId);
	if (!handler) {
		return { status: "no_credentials" };
	}
	const storageProviderId = handler.storageProviderId;

	const readStore = (): {
		settings?: ProviderSettings;
		credentials: ProviderOAuthCredentials | null;
	} => {
		let settings = input.manager.getProviderSettings(storageProviderId);
		if (settings && input.apiBaseUrl && !settings.baseUrl?.trim()) {
			settings = { ...settings, baseUrl: input.apiBaseUrl };
		}
		const credentials = settings
			? createCredentialsFromSettings(settings, {
					normalizeAccessToken: handler.normalizeStoredAccessToken,
				})
			: null;
		return { settings, credentials };
	};

	const preLock = readStore();
	if (!preLock.settings || !preLock.credentials) {
		return { status: "no_credentials" };
	}

	return withSettingsRefreshLock(input.manager.getFilePath(), async () => {
		let { settings, credentials } = readStore();
		if (!settings || !credentials) {
			// Another process logged out while we waited — do not resurrect.
			return { status: "no_credentials" };
		}

		let forceRefresh = input.forceRefresh;
		if (credentials.refresh !== preLock.credentials?.refresh) {
			// Another process rotated while we waited for the lock. Its tokens
			// are newer than the ones our caller wanted to force-rotate;
			// validate them instead of burning a rotation.
			sdkDebug(
				`oauth.refreshFromStore providerId=${input.providerId} adopted_rotation_while_waiting refreshTokenHash=${hashSecret(credentials.refresh)}`,
			);
			captureAuthRefreshRecovered(
				input.telemetry,
				input.providerId,
				"rotated_while_waiting_for_lock",
			);
			forceRefresh = false;
		}

		let next = await handler.refresh({
			settings,
			credentials,
			forceRefresh,
			telemetry: input.telemetry,
			suppressLoggedOutTelemetry: true,
		});

		if (!next) {
			// Invalid grant. Before concluding the session is dead, check
			// whether a non-cooperating rotator beat us mid-flight: if the
			// on-disk refresh token differs from the one that just failed,
			// adopt it and retry once.
			const retry = readStore();
			if (
				retry.settings &&
				retry.credentials &&
				retry.credentials.refresh !== credentials.refresh
			) {
				sdkDebug(
					`oauth.refreshFromStore providerId=${input.providerId} adopt_disk_after_invalid_grant refreshTokenHash=${hashSecret(retry.credentials.refresh)}`,
				);
				captureAuthRefreshRecovered(
					input.telemetry,
					input.providerId,
					"adopted_disk_after_invalid_grant",
				);
				settings = retry.settings;
				credentials = retry.credentials;
				next = await handler.refresh({
					settings,
					credentials,
					forceRefresh: false,
					telemetry: input.telemetry,
					suppressLoggedOutTelemetry: true,
				});
			}
			if (!next) {
				sdkDebug(
					`oauth.refreshFromStore providerId=${input.providerId} outcome=reauth_required refreshTokenHash=${hashSecret(credentials.refresh)}`,
				);
				captureAuthLoggedOut(
					input.telemetry,
					input.providerId,
					"invalid_grant",
				);
				return { status: "reauth_required" };
			}
		}

		const refreshed = !credentialsEqual(next, credentials);
		const nextSettings = handler.saveCredentials({
			manager: input.manager,
			settings,
			credentials: next,
			setLastUsed: false,
			save: false,
		});
		if (refreshed) {
			sdkDebug(
				`oauth.refreshFromStore providerId=${input.providerId} outcome=refreshed newRefreshTokenHash=${hashSecret(next.refresh)}`,
			);
			input.manager.saveProviderSettings(nextSettings, {
				setLastUsed: false,
				tokenSource: "oauth",
			});
		}
		return {
			status: "ok",
			settings: nextSettings,
			credentials: next,
			refreshed,
		};
	});
}
