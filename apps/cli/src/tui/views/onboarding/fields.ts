import type { ProviderConfigFieldKey } from "@cline/core";

/** Render order for provider config fields and Tab cycling. */
export const FIELD_ORDER: ProviderConfigFieldKey[] = [
	"awsRegion",
	"baseUrl",
	"azureApiVersion",
	"apiKey",
	"headers",
	"contextWindow",
	"maxOutputTokens",
	"awsProfile",
	"sapClientId",
	"sapClientSecret",
	"sapTokenUrl",
	"sapResourceGroup",
	"sapDeploymentId",
];
