import { desktopClient } from "@/lib/desktop-client";
import {
	OAUTH_AUTHORIZATION_REQUESTED_EVENT,
	type OAuthAuthorizationRequestedPayload,
} from "@/lib/desktop-transport";

export type ProviderOAuthLoginResult = {
	provider: string;
	accessTokenPresent: boolean;
};

function readOAuthAuthorizationRequest(
	payload: unknown,
): OAuthAuthorizationRequestedPayload | null {
	if (!payload || typeof payload !== "object") return null;
	const value = payload as Record<string, unknown>;
	if (
		typeof value.flowId !== "string" ||
		typeof value.providerId !== "string" ||
		typeof value.url !== "string"
	) {
		return null;
	}
	return {
		flowId: value.flowId,
		providerId: value.providerId,
		url: value.url,
		...(typeof value.instructions === "string"
			? { instructions: value.instructions }
			: {}),
	};
}

export async function loginProviderWithOAuth(input: {
	providerId: string;
	onAuthorization: (request: OAuthAuthorizationRequestedPayload) => void;
}): Promise<ProviderOAuthLoginResult> {
	const flowId = globalThis.crypto.randomUUID();
	const unsubscribe = desktopClient.subscribe(
		OAUTH_AUTHORIZATION_REQUESTED_EVENT,
		(payload) => {
			const authorization = readOAuthAuthorizationRequest(payload);
			if (
				!authorization ||
				authorization.flowId !== flowId ||
				authorization.providerId !== input.providerId
			) {
				return;
			}
			input.onAuthorization(authorization);
		},
	);

	try {
		return await desktopClient.invoke<ProviderOAuthLoginResult>(
			"run_provider_oauth_login",
			{
				provider: input.providerId,
				flowId,
			},
		);
	} finally {
		unsubscribe();
	}
}
