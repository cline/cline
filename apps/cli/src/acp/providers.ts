import type { SessionConfigOption } from "@agentclientprotocol/sdk";

export const PROVIDER_CONFIG_ID = "provider";

export interface AcpProviderChoice {
	id: string;
	name: string;
}

export interface AcpProviderState {
	authMethods: readonly AcpProviderChoice[];
	configured: readonly AcpProviderChoice[];
	currentProviderId: string;
}

export function selectableAcpProviders(
	state: Pick<AcpProviderState, "authMethods" | "configured">,
): AcpProviderChoice[] {
	const selectable: AcpProviderChoice[] = [];
	const seen = new Set<string>();
	for (const choice of [...state.authMethods, ...state.configured]) {
		if (seen.has(choice.id)) {
			continue;
		}
		seen.add(choice.id);
		selectable.push(choice);
	}
	return selectable;
}

export function requiresAcpProviderAuth(input: {
	isOAuthProvider: boolean;
	isConfigured: boolean;
	envApiKey?: string;
	persistedApiKey?: string;
}): boolean {
	if (input.envApiKey || input.persistedApiKey) {
		return false;
	}
	if (input.isOAuthProvider) {
		return true;
	}
	return !input.isConfigured;
}

export function resolveAcpProviderApiKey(input: {
	providerId: string;
	envApiKey?: string;
	persistedApiKey?: string;
	authProviderId?: string;
	authApiKey?: string;
}): string {
	if (input.envApiKey) {
		return input.envApiKey;
	}
	if (input.persistedApiKey) {
		return input.persistedApiKey;
	}
	if (input.authProviderId === input.providerId && input.authApiKey) {
		return input.authApiKey;
	}
	return "";
}

export function buildProviderConfigOption(
	state: AcpProviderState,
): SessionConfigOption {
	return {
		type: "select",
		id: PROVIDER_CONFIG_ID,
		name: "Provider",
		description: "The provider to use for this session",
		category: "model",
		currentValue: state.currentProviderId,
		options: selectableAcpProviders(state).map((choice) => ({
			value: choice.id,
			name: choice.name,
		})),
	};
}
