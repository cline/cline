import type { ITelemetryService } from "@cline/shared";
import {
	getProviderAuthHandler,
	refreshProviderOAuthCredentialsFromStore,
} from "../../auth/provider-auth-registry";
import { sdkDebug } from "../../logging/early-logger";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";

type ManagedOAuthProviderId = string;

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
		const pending = this.resolveProviderApiKeyInternal(providerId, forceRefresh)
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
		forceRefresh: boolean,
	): Promise<RuntimeOAuthResolution | null> {
		const handler = getProviderAuthHandler(providerId);
		if (!handler) {
			return null;
		}
		sdkDebug(
			`oauth.resolve.start providerId=${providerId} storageProviderId=${handler.storageProviderId} forceRefresh=${forceRefresh}`,
		);

		const outcome = await refreshProviderOAuthCredentialsFromStore({
			manager: this.providerSettingsManager,
			providerId,
			forceRefresh,
			telemetry: this.telemetry,
		});

		if (outcome.status === "no_credentials") {
			sdkDebug(`oauth.resolve providerId=${providerId} outcome=no_credentials`);
			return null;
		}
		if (outcome.status === "reauth_required") {
			sdkDebug(
				`oauth.resolve providerId=${providerId} outcome=reauth_required`,
			);
			throw new OAuthReauthRequiredError(providerId);
		}

		sdkDebug(
			`oauth.resolve providerId=${providerId} outcome=ok refreshed=${outcome.refreshed}`,
		);
		return {
			apiKey: handler.getApiKey(outcome.settings) ?? outcome.credentials.access,
			accountId: outcome.credentials.accountId,
			refreshed: outcome.refreshed,
		};
	}
}
