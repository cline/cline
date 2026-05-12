import { existsSync, readFileSync } from "node:fs";
import { resolveProviderSettingsPath } from "@cline/shared/storage";

type ProviderConfig = import("../providers").ProviderConfig;

type StoredProviderSettingsLike = {
	providers?: Record<
		string,
		{
			settings?: {
				auth?: {
					accessToken?: string;
					accountId?: string;
				};
				apiKey?: string;
			};
		}
	>;
};

function readObject(input: unknown): Record<string, unknown> {
	return input && typeof input === "object" && !Array.isArray(input)
		? (input as Record<string, unknown>)
		: {};
}

function readEnvValue(envName: unknown, label: string): string | undefined {
	if (typeof envName !== "string" || envName.trim().length === 0) {
		return undefined;
	}
	const value = process.env[envName]?.trim();
	if (!value) {
		throw new Error(
			`${label} references unset or empty environment variable ${envName}`,
		);
	}
	return value;
}

function readStringHeaders(input: unknown): Record<string, string> {
	const record = readObject(input);
	return Object.fromEntries(
		Object.entries(record).filter(
			([key, value]) => typeof key === "string" && typeof value === "string",
		),
	) as Record<string, string>;
}

function readEnvHeaders(input: unknown): Record<string, string> {
	const record = readObject(input);
	return Object.fromEntries(
		Object.entries(record)
			.map(([key, envName]) => [
				key,
				readEnvValue(envName, `headersEnv.${key}`),
			])
			.filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
}

function readSavedOpenAICodexSettings():
	| { accessToken?: string; accountId?: string }
	| undefined {
	const filePath = resolveProviderSettingsPath();
	if (!existsSync(filePath)) {
		return undefined;
	}
	try {
		const raw = readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as StoredProviderSettingsLike;
		const settings = parsed.providers?.["openai-codex"]?.settings;
		return {
			accessToken:
				settings?.auth?.accessToken?.trim() || settings?.apiKey?.trim(),
			accountId: settings?.auth?.accountId?.trim(),
		};
	} catch {
		return undefined;
	}
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const payload = token.split(".")[1];
	if (!payload) {
		return undefined;
	}
	try {
		const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = base64.padEnd(
			base64.length + ((4 - (base64.length % 4)) % 4),
			"=",
		);
		return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
			string,
			unknown
		>;
	} catch {
		return undefined;
	}
}

function deriveOpenAICodexAccountId(
	accessToken: string | undefined,
): string | undefined {
	if (!accessToken) {
		return undefined;
	}
	const payload = decodeJwtPayload(accessToken);
	const auth = readObject(payload?.["https://api.openai.com/auth"]);
	const authAccountId = auth.chatgpt_account_id;
	if (typeof authAccountId === "string" && authAccountId.length > 0) {
		return authAccountId;
	}
	const organizations = payload?.organizations;
	if (Array.isArray(organizations)) {
		const organization = readObject(organizations[0]);
		const orgId = organization.id;
		if (typeof orgId === "string" && orgId.length > 0) {
			return orgId;
		}
	}
	const rootAccountId = payload?.chatgpt_account_id;
	return typeof rootAccountId === "string" && rootAccountId.length > 0
		? rootAccountId
		: undefined;
}

export function toLiveProviderConfig(settingsInput: unknown): ProviderConfig {
	const settings = readObject(settingsInput);
	const provider = settings.provider;
	if (typeof provider !== "string" || provider.trim().length === 0) {
		throw new Error("live provider entry must include a provider string");
	}
	const savedCodex =
		provider === "openai-codex" ? readSavedOpenAICodexSettings() : undefined;

	const config: ProviderConfig = {
		providerId: provider,
		modelId: typeof settings.model === "string" ? settings.model : "default",
	};
	const apiKey =
		typeof settings.apiKey === "string"
			? settings.apiKey
			: (readEnvValue(settings.apiKeyEnv, "apiKeyEnv") ??
				savedCodex?.accessToken);
	if (apiKey) {
		config.apiKey = apiKey;
	}
	const baseUrl =
		typeof settings.baseUrl === "string"
			? settings.baseUrl
			: readEnvValue(settings.baseUrlEnv, "baseUrlEnv");
	if (baseUrl) {
		config.baseUrl = baseUrl;
	}
	const headers = {
		...readStringHeaders(settings.headers),
		...readEnvHeaders(settings.headersEnv),
	};
	const codexAccountId =
		savedCodex?.accountId || deriveOpenAICodexAccountId(apiKey);
	if (
		provider === "openai-codex" &&
		codexAccountId &&
		!headers["ChatGPT-Account-Id"]
	) {
		headers["ChatGPT-Account-Id"] = codexAccountId;
	}
	if (Object.keys(headers).length > 0) {
		config.headers = headers;
	}
	if (
		settings.reasoning &&
		typeof settings.reasoning === "object" &&
		!Array.isArray(settings.reasoning)
	) {
		const reasoning = settings.reasoning as Record<string, unknown>;
		if (typeof reasoning.enabled === "boolean") {
			config.thinking = reasoning.enabled;
		}
		if (typeof reasoning.effort === "string" && reasoning.effort !== "none") {
			config.reasoningEffort = reasoning.effort as
				| "low"
				| "medium"
				| "high"
				| "xhigh";
		}
		if (typeof reasoning.budgetTokens === "number") {
			config.thinkingBudgetTokens = reasoning.budgetTokens;
		}
	}
	return config;
}
