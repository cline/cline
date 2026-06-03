import type { GatewayProviderRegistration } from "@cline/shared";

const registeredGatewayProviders = new Map<
	string,
	GatewayProviderRegistration
>();

export function registerGatewayProvider(
	registration: GatewayProviderRegistration,
): void {
	registeredGatewayProviders.set(registration.manifest.id, registration);
}

export function unregisterGatewayProvider(providerId: string): boolean {
	return registeredGatewayProviders.delete(providerId);
}

export function getRegisteredGatewayProviders(): GatewayProviderRegistration[] {
	return Array.from(registeredGatewayProviders.values());
}

export function resetGatewayProviderRegistry(): void {
	registeredGatewayProviders.clear();
}
