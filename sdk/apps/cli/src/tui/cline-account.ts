import {
	type ClineAccountBalance,
	type ClineAccountOrganization,
	type ClineAccountOrganizationBalance,
	ClineAccountService,
	type ClineAccountUser,
	getValidClineCredentials,
	type ProviderSettings,
	ProviderSettingsManager,
} from "@clinebot/core";
import { formatCreditBalance, normalizeCreditBalance } from "../utils/output";
import { toProviderApiKey } from "../utils/provider-auth";
import type { Config } from "../utils/types";

const DEFAULT_CLINE_API_BASE_URL = "https://api.cline.bot";
const WORKOS_TOKEN_PREFIX = "workos:";

export interface ClineAccountSnapshot {
	user: ClineAccountUser;
	balance: ClineAccountBalance;
	organizationBalance: ClineAccountOrganizationBalance | null;
	organizations: ClineAccountOrganization[];
	activeOrganization: ClineAccountOrganization | null;
	displayedBalance: number;
}

export function formatClineCredits(value: number): string {
	return formatCreditBalance(normalizeCreditBalance(value));
}

function resolveAccountApiBaseUrl(input: {
	clineApiBaseUrl?: string;
	clineProviderSettings?: ProviderSettings;
}): string {
	const settingsBaseUrl = input.clineProviderSettings?.baseUrl?.trim();
	if (settingsBaseUrl) {
		return settingsBaseUrl;
	}
	const configuredBaseUrl = input.clineApiBaseUrl?.trim();
	if (configuredBaseUrl) {
		return configuredBaseUrl;
	}
	return DEFAULT_CLINE_API_BASE_URL;
}

function resolveClineAccountAuthToken(input: {
	config: Config;
	clineProviderSettings?: ProviderSettings;
}): string | undefined {
	const persistedAccessToken =
		input.clineProviderSettings?.auth?.accessToken?.trim() || "";
	const configApiKey =
		input.config.providerId === "cline" ? input.config.apiKey.trim() : "";
	const settingsApiKey =
		input.clineProviderSettings?.apiKey?.trim() ||
		input.clineProviderSettings?.auth?.apiKey?.trim() ||
		"";

	let authToken = persistedAccessToken || configApiKey || settingsApiKey;
	if (authToken.toLowerCase().startsWith("workos:workos:")) {
		authToken = authToken.slice("workos:".length);
	}
	return authToken || undefined;
}

function stripWorkosTokenPrefix(accessToken: string): string {
	return accessToken.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX)
		? accessToken.slice(WORKOS_TOKEN_PREFIX.length)
		: accessToken;
}

async function resolveValidClineAccountAuthToken(input: {
	config: Config;
	clineProviderSettings?: ProviderSettings;
	manager: ProviderSettingsManager;
	apiBaseUrl: string;
}): Promise<string | undefined> {
	const settings = input.clineProviderSettings;
	const auth = settings?.auth;
	const accessToken = auth?.accessToken?.trim();
	const refreshToken = auth?.refreshToken?.trim();
	if (settings && auth && accessToken && refreshToken) {
		const credentials = await getValidClineCredentials(
			{
				access: stripWorkosTokenPrefix(accessToken),
				refresh: refreshToken,
				expires: auth.expiresAt ?? Date.now() - 1,
				accountId: auth.accountId,
			},
			{ apiBaseUrl: input.apiBaseUrl },
		);
		if (!credentials) {
			throw new Error(
				"Cline account requires re-authentication. Run clite auth cline.",
			);
		}
		const nextAccessToken = toProviderApiKey("cline", credentials);
		if (
			nextAccessToken !== accessToken ||
			credentials.refresh !== refreshToken ||
			credentials.accountId !== auth.accountId ||
			credentials.expires !== auth.expiresAt
		) {
			input.manager.saveProviderSettings(
				{
					...settings,
					auth: {
						...(settings.auth ?? {}),
						accessToken: nextAccessToken,
						refreshToken: credentials.refresh,
						accountId: credentials.accountId,
						expiresAt: credentials.expires,
					},
				},
				{ setLastUsed: false, tokenSource: "oauth" },
			);
		}
		return nextAccessToken;
	}
	return resolveClineAccountAuthToken({
		config: input.config,
		clineProviderSettings: settings,
	});
}

export async function createClineAccountService(input: {
	config: Config;
	clineApiBaseUrl?: string;
	clineProviderSettings?: ProviderSettings;
}): Promise<ClineAccountService | undefined> {
	const manager = new ProviderSettingsManager();
	const settings =
		manager.getProviderSettings("cline") ?? input.clineProviderSettings;
	const apiBaseUrl = resolveAccountApiBaseUrl({
		clineApiBaseUrl: input.clineApiBaseUrl,
		clineProviderSettings: settings,
	});
	const authToken = await resolveValidClineAccountAuthToken({
		config: input.config,
		clineProviderSettings: settings,
		manager,
		apiBaseUrl,
	});
	if (!authToken) {
		return undefined;
	}
	return new ClineAccountService({
		apiBaseUrl,
		getAuthToken: async () => authToken,
	});
}

export async function loadClineAccountSnapshot(input: {
	config: Config;
	clineApiBaseUrl?: string;
	clineProviderSettings?: ProviderSettings;
}): Promise<ClineAccountSnapshot> {
	const service = await createClineAccountService(input);
	if (!service) {
		throw new Error("No Cline account auth token found");
	}

	const user = await service.fetchMe();
	const organizations = user.organizations ?? [];
	const activeOrganization =
		organizations.find((organization) => organization.active) ?? null;
	const [balance, organizationBalance] = await Promise.all([
		service.fetchBalance(user.id),
		activeOrganization
			? service.fetchOrganizationBalance(activeOrganization.organizationId)
			: Promise.resolve(null),
	]);
	const displayedBalance = activeOrganization
		? (organizationBalance?.balance ?? balance.balance)
		: balance.balance;

	return {
		user,
		balance,
		organizationBalance,
		organizations,
		activeOrganization,
		displayedBalance,
	};
}

export async function switchClineAccount(input: {
	config: Config;
	organizationId?: string | null;
	clineApiBaseUrl?: string;
	clineProviderSettings?: ProviderSettings;
}): Promise<void> {
	const service = await createClineAccountService(input);
	if (!service) {
		throw new Error("No Cline account auth token found");
	}
	await service.switchAccount(input.organizationId);
}
