import { Llms, type ProviderSettings } from "@clinebot/core";

export type OAuthCredentials = {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	email?: string;
	metadata?: Record<string, unknown>;
};

export function normalizeProviderId(providerId: string): string {
	return Llms.normalizeProviderId(providerId.trim());
}

export function normalizeAuthProviderId(providerId: string): string {
	const normalized = providerId.trim().toLowerCase();
	if (normalized === "codex" || normalized === "openai-codex") {
		return "openai-codex";
	}
	return normalizeProviderId(normalized);
}

export function isOAuthProvider(providerId: string): boolean {
	return (
		providerId === "cline" ||
		providerId === "oca" ||
		providerId === "openai-codex"
	);
}

export function toProviderApiKey(
	providerId: string,
	credentials: Pick<OAuthCredentials, "access">,
): string {
	if (providerId === "cline") {
		return credentials.access.startsWith("workos:")
			? credentials.access
			: `workos:${credentials.access}`;
	}
	return credentials.access;
}

export function getPersistedProviderApiKey(
	providerId: string,
	settings?: ProviderSettings,
): string | undefined {
	const accessToken = settings?.auth?.accessToken?.trim();
	if (accessToken) {
		return toProviderApiKey(providerId, { access: accessToken });
	}
	const shorthandKey = settings?.apiKey?.trim();
	if (shorthandKey) {
		return shorthandKey;
	}
	const authKey = settings?.auth?.apiKey?.trim();
	if (authKey) {
		return authKey;
	}
	return undefined;
}

export async function ensureOAuthProviderApiKey(
	input: Parameters<
		typeof import("../commands/auth").ensureOAuthProviderApiKey
	>[0],
): Promise<
	Awaited<
		ReturnType<typeof import("../commands/auth").ensureOAuthProviderApiKey>
	>
> {
	const { ensureOAuthProviderApiKey: ensureFromCommand } = await import(
		"../commands/auth"
	);
	return await ensureFromCommand(input);
}
