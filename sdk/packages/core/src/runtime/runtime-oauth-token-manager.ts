import type * as LlmsProviders from "@clinebot/llms";
import {
	type ITelemetryService,
	isOAuthProviderId,
	type OAuthProviderId,
} from "@clinebot/shared";
import {
	type ClineOAuthCredentials,
	getValidClineCredentials,
} from "../auth/cline";
import { getValidOpenAICodexCredentials } from "../auth/codex";
import { getValidOcaCredentials } from "../auth/oca";
import { decodeJwtPayload } from "../auth/utils";
import { ProviderSettingsManager } from "../services/storage/provider-settings-manager";

const DEFAULT_CLINE_API_BASE_URL = "https://api.cline.bot";
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
	settings: LlmsProviders.ProviderSettings,
	normalizedAccessToken: string,
): number {
	const explicitExpiry = (
		settings.auth as
			| (LlmsProviders.ProviderSettings["auth"] & { expiresAt?: number })
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
	settings: LlmsProviders.ProviderSettings,
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

function authSettingsEqual(
	a: LlmsProviders.ProviderSettings["auth"] | undefined,
	b: LlmsProviders.ProviderSettings["auth"] | undefined,
): boolean {
	const aExpiry = (
		a as
			| (LlmsProviders.ProviderSettings["auth"] & { expiresAt?: number })
			| undefined
	)?.expiresAt;
	const bExpiry = (
		b as
			| (LlmsProviders.ProviderSettings["auth"] & { expiresAt?: number })
			| undefined
	)?.expiresAt;
	return (
		a?.accessToken === b?.accessToken &&
		a?.refreshToken === b?.refreshToken &&
		a?.accountId === b?.accountId &&
		aExpiry === bExpiry
	);
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
		Promise<RuntimeOAuthResolution | null>
	>();

	constructor(options?: {
		providerSettingsManager?: ProviderSettingsManager;
		telemetry?: ITelemetryService;
	}) {
		this.providerSettingsManager =
			options?.providerSettingsManager ?? new ProviderSettingsManager();
		this.telemetry = options?.telemetry;
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
			return currentInFlight;
		}
		const pending = this.resolveProviderApiKeyInternal(providerId, forceRefresh)
			.catch((error) => {
				throw error;
			})
			.finally(() => {
				this.refreshInFlight.delete(providerId);
			});
		this.refreshInFlight.set(providerId, pending);
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

		const nextCredentials = await this.resolveCredentials(
			providerId,
			settings,
			currentCredentials,
			forceRefresh,
		);
		if (!nextCredentials) {
			throw new OAuthReauthRequiredError(providerId);
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
		} as LlmsProviders.ProviderSettings["auth"] & { expiresAt?: number };
		nextAuth.expiresAt = nextCredentials.expires;
		const nextSettings: LlmsProviders.ProviderSettings = {
			...settings,
			auth: nextAuth,
		};
		const wasRefreshed = !authSettingsEqual(settings.auth, nextSettings.auth);
		if (wasRefreshed) {
			this.providerSettingsManager.saveProviderSettings(nextSettings, {
				setLastUsed: false,
				tokenSource: "oauth",
			});
		}

		return {
			providerId,
			apiKey: persistedAccessToken,
			accountId: nextCredentials.accountId,
			refreshed: wasRefreshed,
		};
	}

	private async resolveCredentials(
		providerId: ManagedOAuthProviderId,
		settings: LlmsProviders.ProviderSettings,
		currentCredentials: ClineOAuthCredentials,
		forceRefresh: boolean,
	): Promise<ClineOAuthCredentials | null> {
		if (providerId === "cline") {
			return getValidClineCredentials(
				currentCredentials,
				{
					apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_CLINE_API_BASE_URL,
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
			telemetry: this.telemetry,
		});
	}
}
