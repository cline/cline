import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import {
	type ClineAccountOrganization,
	ClineAccountService,
	getPersistedProviderApiKey,
	type ProviderSettingsManager,
	RuntimeOAuthTokenManager,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";

export const PERSONAL_ACCOUNT_VALUE = "personal";

export const ORGANIZATION_CONFIG_ID = "organization";

export function usesClineAccount(providerId: string): boolean {
	return providerId === "cline" || providerId === "cline-pass";
}

export interface AcpOrganizationState {
	organizations: ClineAccountOrganization[];
	/** Active organization id, or null when the personal account is active. */
	activeOrganizationId: string | null;
}

interface ClineAccountInput {
	apiKey: string;
	providerSettingsManager: ProviderSettingsManager;
}

// Cline access tokens expire between runs, so account requests resolve
// through the refresh-aware OAuth manager. A single shared instance keeps
// refreshes single-flight; the refresh token is single-use, so parallel
// refreshes would invalidate each other.
let oauthTokenManager: RuntimeOAuthTokenManager | undefined;

function createAccountService(input: ClineAccountInput): ClineAccountService {
	const { providerSettingsManager } = input;
	const settings = providerSettingsManager.getProviderSettings("cline");
	return new ClineAccountService({
		apiBaseUrl:
			settings?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
		getAuthToken: async () => {
			try {
				oauthTokenManager ??= new RuntimeOAuthTokenManager({
					providerSettingsManager,
				});
				const resolution = await oauthTokenManager.resolveProviderApiKey({
					providerId: "cline",
				});
				if (resolution?.apiKey) {
					return resolution.apiKey;
				}
			} catch {
				// Fall back to the persisted token; the account request surfaces
				// the auth failure to the caller.
			}
			return (
				getPersistedProviderApiKey(
					"cline",
					providerSettingsManager.getProviderSettings("cline"),
				) ||
				input.apiKey ||
				undefined
			);
		},
	});
}

export async function fetchClineOrganizations(
	input: ClineAccountInput,
): Promise<AcpOrganizationState | undefined> {
	try {
		const service = createAccountService(input);
		const organizations = await service.fetchUserOrganizations();
		if (organizations.length === 0) {
			return undefined;
		}
		return {
			organizations,
			activeOrganizationId:
				organizations.find((org) => org.active)?.organizationId ?? null,
		};
	} catch {
		return undefined;
	}
}

export function buildOrganizationConfigOption(
	state: AcpOrganizationState,
): SessionConfigOption {
	return {
		type: "select",
		id: ORGANIZATION_CONFIG_ID,
		name: "Account",
		description:
			"The Cline account usage is billed to — your personal account or an organization",
		category: "account",
		currentValue: state.activeOrganizationId ?? PERSONAL_ACCOUNT_VALUE,
		options: [
			{ value: PERSONAL_ACCOUNT_VALUE, name: "Personal" },
			...state.organizations.map((org) => ({
				value: org.organizationId,
				name: org.name,
			})),
		],
	};
}

export async function switchClineOrganization(
	input: ClineAccountInput & { organizationId: string | null },
): Promise<void> {
	const service = createAccountService(input);
	await service.switchAccount(input.organizationId);
	await persistActiveOrganization(input.providerSettingsManager, service);
}

// Re-persist the active organization so headless runs and the hub daemon
// attribute telemetry to the right account. Best-effort: the switch itself
// already succeeded server-side.
async function persistActiveOrganization(
	manager: ProviderSettingsManager,
	service: ClineAccountService,
): Promise<void> {
	try {
		const organizations = await service.fetchUserOrganizations();
		const active = organizations.find((org) => org.active) ?? null;
		const persisted = manager.getProviderSettings("cline");
		if (!persisted) {
			return;
		}
		manager.saveProviderSettings(
			{
				...persisted,
				auth: {
					...persisted.auth,
					organizationId: active?.organizationId,
					organizationName: active?.name,
					memberId: active?.memberId,
				},
			},
			{ setLastUsed: false },
		);
	} catch {
		// Ignore; see above.
	}
}

export function getAcpOrgSubscriptionMessage(): string {
	return [
		"Organization accounts cannot use ClinePass subscriptions.",
		'Switch the "Account" session option to Personal to keep using ClinePass,',
		'or switch the "Provider" option to Cline to bill your organization.',
	].join(" ");
}
