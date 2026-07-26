import type { GatewayProviderRegistration } from "@cline/shared";
import { BUILTIN_SPECS, toManifest } from "./builtins";

export const BUILTIN_PROVIDER_REGISTRATIONS: GatewayProviderRegistration[] =
	BUILTIN_SPECS.map((spec) => ({
		manifest: toManifest(spec),
		loadProvider: async () => {
			const { createBedrockProvider } = await import("./ai-sdk");
			return { createProvider: createBedrockProvider };
		},
	}));
