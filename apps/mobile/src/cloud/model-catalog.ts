import type { CloudModelOption } from "./rest/CloudSetupGateway";

// Same catalog choices as dashboard AgentModelSelector. These are offers,
// not Hub provider IDs: all Cloud requests still use providerId "cline".
export const CLOUD_CATALOGS = [
	{
		id: "cline",
		name: "Cline Usage-Billing",
		description: "Pay for model usage with Cline credits",
	},
	{
		id: "cline-pass",
		name: "ClinePass",
		description: "Models included with ClinePass",
	},
	{
		id: "cline-cloud",
		name: "ClineFree",
		description: "Free models for Cline Cloud agents",
	},
] as const;
export type CloudCatalogId = (typeof CLOUD_CATALOGS)[number]["id"];

export function cloudCatalogId(
	modelId = "",
	models: readonly CloudModelOption[] = [],
): CloudCatalogId {
	const explicit = models.find((model) => model.id === modelId)?.catalogId;
	if (explicit) return explicit;
	if (modelId.startsWith("cline-pass/")) return "cline-pass";
	if (modelId.startsWith("cline-cloud/")) return "cline-cloud";
	return "cline";
}

export function cloudProviderName(modelId?: string): string {
	return CLOUD_CATALOGS.find(
		(catalog) => catalog.id === cloudCatalogId(modelId),
	)!.name;
}
