import {
	type ClineAccountBalance,
	type ClineAccountOrganization,
	type ClineAccountOrganizationBalance,
	type ClineSubscriptionPlan,
	ClineAccountService,
	type ClineAccountUser,
	formatProviderOAuthApiKey,
	getPersistedProviderApiKey,
	getProviderOAuthCredentialsFromSettings,
	getValidClineCredentials,
	type ProviderSettings,
	ProviderSettingsManager,
	saveLocalProviderOAuthCredentials,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";
import { formatCreditBalance, normalizeCreditBalance } from "../utils/output";
import { identifyTelemetryAccount } from "../utils/telemetry";
import type { Config } from "../utils/types";

export const CLINE_CREDITS_DASHBOARD_URL =
	"https://app.cline.bot/dashboard/account?tab=credits";

type ClineAccountConfig = Pick<Config, "apiKey" | "logger" | "providerId">;

const CLINE_PASS_PROVIDER_ID = "cline-pass";

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

// FIXME: These message checks are temporary until structured error types are
// passed through to the CLI instead of plain error strings.
export function isClineAccountAuthErrorMessage(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	return (
		normalized === "no cline account auth token found" ||
		normalized.includes("requires re-authentication")
	);
}

export function isClineAccountCreditsErrorMessage(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	return (
		normalized.includes("insufficient balance") &&
		normalized.includes("cline credits balance")
	);
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
	return getClineEnvironmentConfig().apiBaseUrl;
}

function resolveClineAccountAuthToken(input: {
	config: ClineAccountConfig;
	clineProviderSettings?: ProviderSettings;
}): string | undefined {
	const configApiKey =
		input.config.providerId === "cline" ? input.config.apiKey.trim() : "";
	return (
		getPersistedProviderApiKey("cline", input.clineProviderSettings) ||
		configApiKey ||
		undefined
	);
}

async function resolveValidClineAccountAuthToken(input: {
	config: ClineAccountConfig;
	clineProviderSettings?: ProviderSettings;
	manager: ProviderSettingsManager;
	apiBaseUrl: string;
}): Promise<string | undefined> {
	const settings = input.clineProviderSettings;
	const credentials = settings
		? getProviderOAuthCredentialsFromSettings("cline", settings)
		: null;
	if (settings && credentials) {
		const nextCredentials = await getValidClineCredentials(credentials, {
			apiBaseUrl: input.apiBaseUrl,
		});
		if (!nextCredentials) {
			throw new Error(
				"Cline account requires re-authentication. Run cline auth cline.",
			);
		}
		const nextAccessToken = formatProviderOAuthApiKey("cline", nextCredentials);
		if (nextCredentials !== credentials) {
			saveLocalProviderOAuthCredentials(
				input.manager,
				"cline",
				settings,
				nextCredentials,
				{ setLastUsed: false },
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
	config: ClineAccountConfig;
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
	config: ClineAccountConfig;
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
	const accountContext = {
		id: user.id,
		email: user.email,
		provider: "cline",
		organizationId: activeOrganization?.organizationId,
		organizationName: activeOrganization?.name,
		memberId: activeOrganization?.memberId,
	};
	identifyTelemetryAccount(accountContext, input.config.logger);

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
	config: ClineAccountConfig;
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

export async function loadIndividualSubscriptionPlans(input: {
	config: ClineAccountConfig;
	clineApiBaseUrl?: string;
	clineProviderSettings?: ProviderSettings;
}): Promise<ClineSubscriptionPlan[]> {
	const service = await createClineAccountService(input);
	if (!service) {
		throw new Error("No Cline account auth token found");
	}
	return service.fetchAvailableSubscriptionPlans({ type: "individual" });
}

async function onChangeToClinePass(config: ClineAccountConfig) {
	try {
		await switchClineAccount({
			config: config,
			organizationId: null,
		});
	} catch (error) {
		config.logger?.debug("Failed to switch ClinePass to personal account", {
			error,
		});
	}
}

export async function onProviderChange(input: {
	config: ClineAccountConfig;
	providerId: string;
}): Promise<void> {
	if (input.providerId === CLINE_PASS_PROVIDER_ID) {
		return onChangeToClinePass(input.config);
	}

	return;
}
