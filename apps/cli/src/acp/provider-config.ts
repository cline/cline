import type { SessionConfigOption } from "@agentclientprotocol/sdk";

/**
 * ACP category for the auth-provider selector.
 *
 * `model` is reserved for the model selector. Clients that see several options
 * in that category pick the earlier one, so tagging the provider as `model`
 * makes them write a model id into `provider` and the session fails to open.
 * Category names that start with `_` are free for custom use.
 */
export const PROVIDER_CONFIG_CATEGORY = "_provider";

export function createProviderConfigOption(
	currentProviderId: string,
	options: Array<{ value: string; name: string }>,
): SessionConfigOption {
	return {
		type: "select",
		id: "provider",
		name: "Provider",
		description: "The authentication provider to use",
		category: PROVIDER_CONFIG_CATEGORY,
		currentValue: currentProviderId,
		options,
	};
}
