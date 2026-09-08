import type { ITelemetryService } from "@cline/shared";
import {
	getProviderAuthHandler,
	getProviderOAuthCredentialsFromSettings,
	saveProviderOAuthCredentials,
} from "../../auth/provider-auth-registry";
import { hashSecret, sdkDebug } from "../../logging/early-logger";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import type { ProviderSettings } from "../../types/provider-settings";

type ManagedOAuthProviderId = string;

function authSettingsEqual(
	a: ProviderSettings["auth"] | undefined,
	b: ProviderSettings["auth"] | undefined,
): boolean {
	const aExpiry = (
		a as (ProviderSettings["auth"] & { expiresAt?: number }) | undefined
	)?.expiresAt;
	const bExpiry = (
		b as (ProviderSettings["auth"] & { expiresAt?: number }) | undefined
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
		const handler = getProviderAuthHandler(input.providerId);
		if (!handler) {
			return null;
		}
		return this.resolveWithSingleFlight(
			handler.providerId,
			handler.storageProviderId,
			input.forceRefresh,
		);
	}

	private async resolveWithSingleFlight(
		providerId: ManagedOAuthProviderId,
		storageProviderId: ManagedOAuthProviderId,
		forceRefresh = false,
	): Promise<RuntimeOAuthResolution | null> {
		const currentInFlight = this.refreshInFlight.get(storageProviderId);
		if (currentInFlight) {
			return currentInFlight;
		}
		const pending = this.resolveProviderApiKeyInternal(
			providerId,
			storageProviderId,
			forceRefresh,
		)
			.catch((error) => {
				throw error;
			})
			.finally(() => {
				this.refreshInFlight.delete(storageProviderId);
			});
		this.refreshInFlight.set(storageProviderId, pending);
		return pending;
	}

	private async resolveProviderApiKeyInternal(
		providerId: ManagedOAuthProviderId,
		storageProviderId: ManagedOAuthProviderId,
		forceRefresh: boolean,
	): Promise<RuntimeOAuthResolution | null> {
		const handler = getProviderAuthHandler(providerId);
		if (!handler) {
			return null;
		}
		const settings =
			this.providerSettingsManager.getProviderSettings(storageProviderId);
		if (!settings) {
			sdkDebug(
				`oauth.resolve providerId=${providerId} storageProviderId=${storageProviderId} outcome=no_settings`,
			);
			return null;
		}

		const currentCredentials = getProviderOAuthCredentialsFromSettings(
			providerId,
			settings,
		);
		if (!currentCredentials) {
			sdkDebug(
				`oauth.resolve providerId=${providerId} storageProviderId=${storageProviderId} outcome=no_credentials`,
			);
			return null;
		}

		sdkDebug(
			`oauth.resolve.start providerId=${providerId} storageProviderId=${storageProviderId} forceRefresh=${forceRefresh} accessTokenHash=${hashSecret(currentCredentials.access)} refreshTokenHash=${hashSecret(currentCredentials.refresh)}`,
		);

		const nextCredentials = await handler.refresh({
			settings,
			credentials: currentCredentials,
			forceRefresh,
			telemetry: this.telemetry,
		});
		if (!nextCredentials) {
			sdkDebug(
				`oauth.resolve providerId=${providerId} outcome=refresh_returned_null`,
			);
			throw new OAuthReauthRequiredError(providerId);
		}

		const nextSettings: ProviderSettings = saveProviderOAuthCredentials({
			manager: this.providerSettingsManager,
			providerId,
			settings,
			credentials: nextCredentials,
			setLastUsed: false,
			save: false,
		});
		const wasRefreshed = !authSettingsEqual(settings.auth, nextSettings.auth);
		if (wasRefreshed) {
			sdkDebug(
				`oauth.resolve.refreshed providerId=${providerId} newAccessTokenHash=${hashSecret(nextCredentials.access)} newRefreshTokenHash=${hashSecret(nextCredentials.refresh)} savingToDisk=true`,
			);
			this.providerSettingsManager.saveProviderSettings(nextSettings, {
				setLastUsed: false,
				tokenSource: "oauth",
			});
		} else {
			sdkDebug(`oauth.resolve providerId=${providerId} outcome=not_refreshed`);
		}

		return {
			apiKey: handler.getApiKey(nextSettings) ?? nextCredentials.access,
			accountId: nextCredentials.accountId,
			refreshed: wasRefreshed,
		};
	}
}
