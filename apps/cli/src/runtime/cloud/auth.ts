import { createHash } from "node:crypto";
import {
	ClineAccountService,
	getProviderAuthHandler,
	OAuthReauthRequiredError,
	ProviderSettingsManager,
	RuntimeOAuthTokenManager,
} from "@cline/core";
import { decodeJwtPayload, getClineEnvironmentConfig } from "@cline/shared";
import type { CloudScope } from "./storage";

export type CloudIdentity = {
	scope: CloudScope;
	subject?: string;
	credentialKey?: string;
	accountLabel: string;
	organizationLabel: string;
};
export function cloudCredentialKey(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}
const tokenManager = new RuntimeOAuthTokenManager();
export function cloudApiBaseUrl(): string {
	return (
		new ProviderSettingsManager()
			.getProviderSettings("cline")
			?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl
	);
}
export function cloudTokenSubject(token: string): string | undefined {
	const subject = decodeJwtPayload(token.replace(/^workos:/, ""))?.sub;
	return typeof subject === "string" ? subject : undefined;
}
export async function resolveCloudToken(): Promise<string | undefined> {
	try {
		const resolved = await tokenManager.resolveProviderApiKey({
			providerId: "cline",
		});
		if (resolved?.apiKey) return resolved.apiKey;
	} catch (error) {
		if (error instanceof OAuthReauthRequiredError) return undefined;
	}
	return getProviderAuthHandler("cline")?.getApiKey(
		new ProviderSettingsManager().getProviderSettings("cline"),
	);
}
export async function resolveCloudIdentity(): Promise<
	CloudIdentity | undefined
> {
	const token = await resolveCloudToken();
	if (!token) return undefined;
	const apiBaseUrl = cloudApiBaseUrl();
	const account = new ClineAccountService({
		apiBaseUrl,
		getAuthToken: async () => token,
	});
	const user = await account.fetchMe();
	const organization = user.organizations?.find((item) => item.active);
	return {
		scope: {
			apiBaseUrl,
			accountId: user.id,
			organizationId: organization?.organizationId,
		},
		subject: cloudTokenSubject(token),
		credentialKey: cloudTokenSubject(token)
			? undefined
			: cloudCredentialKey(token),
		accountLabel: user.email || user.id,
		organizationLabel: organization?.name || "Personal",
	};
}
