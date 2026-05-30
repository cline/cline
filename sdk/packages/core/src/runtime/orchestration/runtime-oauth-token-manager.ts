import {
	getClineEnvironmentConfig,
	type ITelemetryService,
	isOAuthProviderId,
	type OAuthProviderId,
} from "@cline/shared";
import {
	type ClineOAuthCredentials,
	getValidClineCredentials,
} from "../../auth/cline";
import {
	getValidOpenAICodexCredentials,
	isOpenAICodexTokenExpired,
} from "../../auth/codex";
import { getValidOcaCredentials } from "../../auth/oca";
import { decodeJwtPayload } from "../../auth/utils";
import {
	openAICodexAuthSettingsEqual,
	ProviderSettingsManager,
	type ProviderSettingsRefreshLockOptions,
} from "../../services/storage/provider-settings-manager";
import type { ProviderSettings } from "../../types/provider-settings";

const WORKOS_TOKEN_PREFIX = "workos:";

type ManagedOAuthProviderId = OAuthProviderId;

function toStoredAccessToken(
	providerId: ManagedOAuthProviderId,
	accessToken: string,
): string {
	if (providerId === "cline") {
		return `${WORKOS_TOKEN_PREFIX}${accessToken}`;
	}
	return accessToken;
}

function fromStoredAccessToken(
	providerId: ManagedOAuthProviderId,
	accessToken: string,
): string {
	if (
		providerId === "cline" &&
		accessToken.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX)
	) {
		return accessToken.slice(WORKOS_TOKEN_PREFIX.length);
	}
	return accessToken;
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
	const explicitExpiry = (
		settings.auth as
			| (ProviderSettings["auth"] & { expiresAt?: number })
			| undefined
	)?.expiresAt;
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

function toCredentials(
	providerId: ManagedOAuthProviderId,
	settings: ProviderSettings,
): ClineOAuthCredentials | null {
	const rawAccess = settings.auth?.accessToken?.trim();
	const refreshToken = settings.auth?.refreshToken?.trim();
	if (!rawAccess || !refreshToken) {
		return null;
	}
	const access = fromStoredAccessToken(providerId, rawAccess);
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

export class OAuthReauthRequiredError extends Error {
	public readonly providerId: ManagedOAuthProviderId;

	constructor(providerId: ManagedOAuthProviderId) {
		super(
			`OAuth credentials for provider "${providerId}" are no longer valid. Re-run authentication for this provider.`,
		);
		this.name = "OAuthReauthRequiredError";
		this.providerId = providerId;
	}
}

export type RuntimeOAuthResolution = {
	providerId: ManagedOAuthProviderId;
	apiKey: string;
	accountId?: string;
	refreshed: boolean;
};

export class RuntimeOAuthTokenManager {
	private readonly providerSettingsManager: ProviderSettingsManager;
	private readonly telemetry?: ITelemetryService;
	private readonly refreshInFlight = new Map<
		ManagedOAuthProviderId,
		{
			forceRefresh: boolean;
			promise: Promise<RuntimeOAuthResolution | null>;
		}
	>();
	private readonly refreshLockOptions?: ProviderSettingsRefreshLockOptions;

	constructor(options?: {
		providerSettingsManager?: ProviderSettingsManager;
		telemetry?: ITelemetryService;
		refreshLockOptions?: ProviderSettingsRefreshLockOptions;
	}) {
		this.providerSettingsManager =
			options?.providerSettingsManager ?? new ProviderSettingsManager();
		this.telemetry = options?.telemetry;
		this.refreshLockOptions = options?.refreshLockOptions;
	}

	public async resolveProviderApiKey(input: {
		providerId: string;
		forceRefresh?: boolean;
	}): Promise<RuntimeOAuthResolution | null> {
		if (!isOAuthProviderId(input.providerId)) {
			return null;
		}
		return this.resolveWithSingleFlight(input.providerId, input.forceRefresh);
	}

	private async resolveWithSingleFlight(
		providerId: ManagedOAuthProviderId,
		forceRefresh = false,
	): Promise<RuntimeOAuthResolution | null> {
		const currentInFlight = this.refreshInFlight.get(providerId);
		if (currentInFlight) {
			const resolution = await currentInFlight.promise;
			return forceRefresh && !currentInFlight.forceRefresh
				? this.resolveWithSingleFlight(providerId, true)
				: resolution;
		}
		const pending = this.resolveProviderApiKeyInternal(
			providerId,
			forceRefresh,
		).finally(() => {
				if (this.refreshInFlight.get(providerId)?.promise === pending) {
					this.refreshInFlight.delete(providerId);
				}
			});
		this.refreshInFlight.set(providerId, {
			forceRefresh,
			promise: pending,
		});
		return pending;
	}

	private async resolveProviderApiKeyInternal(
		providerId: ManagedOAuthProviderId,
		forceRefresh: boolean,
	): Promise<RuntimeOAuthResolution | null> {
		const settings =
			this.providerSettingsManager.getProviderSettings(providerId);
		if (!settings) {
			return null;
		}

		const currentCredentials = toCredentials(providerId, settings);
		if (!currentCredentials) {
			return null;
		}

		if (
			providerId === "openai-codex" &&
			(forceRefresh || isOpenAICodexTokenExpired(currentCredentials))
		) {
			return this.providerSettingsManager.withProviderRefreshLock(
				providerId,
				async () => {
					const storedSettings =
						this.providerSettingsManager.getProviderSettings(providerId);
					if (!storedSettings) {
						return null;
					}
					const storedCredentials = toCredentials(providerId, storedSettings);
					if (!storedCredentials) {
						return null;
					}
					const storedAuthChanged = !openAICodexAuthSettingsEqual(
						settings.auth,
						storedSettings.auth,
					);
					return this.resolveAndPersistCredentials(
						providerId,
						storedSettings,
						storedCredentials,
						forceRefresh && !storedAuthChanged,
					);
				},
				this.refreshLockOptions,
			);
		}

		return this.resolveAndPersistCredentials(
			providerId,
			settings,
			currentCredentials,
			forceRefresh,
		);
	}

	private async resolveAndPersistCredentials(
		providerId: ManagedOAuthProviderId,
		settings: ProviderSettings,
		currentCredentials: ClineOAuthCredentials,
		forceRefresh: boolean,
	): Promise<RuntimeOAuthResolution> {
		let invalidGrant = false;
		const nextCredentials = await this.resolveCredentials(
			providerId,
			settings,
			currentCredentials,
			forceRefresh,
			() => {
				invalidGrant = true;
			},
		);
		if (!nextCredentials) {
			if (providerId === "openai-codex" && invalidGrant) {
				this.clearAuthIfUnchanged(providerId, settings.auth);
			}
			throw new OAuthReauthRequiredError(providerId);
		}

		const latestSettings =
			this.providerSettingsManager.getProviderSettings(providerId);
		if (
			latestSettings &&
			!openAICodexAuthSettingsEqual(settings.auth, latestSettings.auth)
		) {
			const latestCredentials = toCredentials(providerId, latestSettings);
			if (!latestCredentials) {
				throw new OAuthReauthRequiredError(providerId);
			}
			return this.toResolution(providerId, latestCredentials, true);
		}

		const persistedAccessToken = toStoredAccessToken(
			providerId,
			nextCredentials.access,
		);
		const nextAuth = {
			...(settings.auth ?? {}),
			accessToken: persistedAccessToken,
			refreshToken: nextCredentials.refresh,
			accountId: nextCredentials.accountId,
		} as ProviderSettings["auth"] & { expiresAt?: number };
		nextAuth.expiresAt = nextCredentials.expires;
		const nextSettings: ProviderSettings = {
			...(latestSettings ?? settings),
			auth: nextAuth,
		};
		const wasRefreshed = !openAICodexAuthSettingsEqual(
			settings.auth,
			nextSettings.auth,
		);
		if (wasRefreshed) {
			this.providerSettingsManager.saveProviderSettings(nextSettings, {
				setLastUsed: false,
				tokenSource: "oauth",
			});
		}

		return this.toResolution(providerId, nextCredentials, wasRefreshed);
	}

	private clearAuthIfUnchanged(
		providerId: ManagedOAuthProviderId,
		failedAuth: ProviderSettings["auth"],
	): void {
		const latestSettings =
			this.providerSettingsManager.getProviderSettings(providerId);
		if (
			!latestSettings ||
			!openAICodexAuthSettingsEqual(latestSettings.auth, failedAuth)
		) {
			return;
		}
		const { auth: _auth, ...settingsWithoutAuth } = latestSettings;
		this.providerSettingsManager.saveProviderSettings(settingsWithoutAuth, {
			setLastUsed: false,
			tokenSource: "oauth",
			expectedOpenAICodexAuth: failedAuth,
		});
	}

	private toResolution(
		providerId: ManagedOAuthProviderId,
		credentials: ClineOAuthCredentials,
		refreshed: boolean,
	): RuntimeOAuthResolution {
		return {
			providerId,
			apiKey: toStoredAccessToken(providerId, credentials.access),
			accountId: credentials.accountId,
			refreshed,
		};
	}

	private async resolveCredentials(
		providerId: ManagedOAuthProviderId,
		settings: ProviderSettings,
		currentCredentials: ClineOAuthCredentials,
		forceRefresh: boolean,
		onInvalidGrant: () => void,
	): Promise<ClineOAuthCredentials | null> {
		if (providerId === "cline") {
			return getValidClineCredentials(
				currentCredentials,
				{
					apiBaseUrl:
						settings.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
					telemetry: this.telemetry,
				},
				{ forceRefresh },
			);
		}
		if (providerId === "oca") {
			return getValidOcaCredentials(
				currentCredentials,
				{ forceRefresh, telemetry: this.telemetry },
				{ mode: settings.oca?.mode, telemetry: this.telemetry },
			);
		}
		return getValidOpenAICodexCredentials(currentCredentials, {
			forceRefresh,
			onInvalidGrant,
			telemetry: this.telemetry,
		});
	}
}
