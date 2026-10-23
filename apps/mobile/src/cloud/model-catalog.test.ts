import { describe, expect, it } from "vitest";
import {
	cloudCatalogId,
	CLOUD_CATALOGS,
	cloudProviderName,
} from "./model-catalog";
import { CloudSetupGateway } from "./rest/CloudSetupGateway";

describe("Cloud catalogs follow web's offers, not Hub provider IDs", () => {
	it("names and separates all three offers", () => {
		expect(CLOUD_CATALOGS.map((c) => c.name)).toEqual([
			"Cline Usage-Billing",
			"ClinePass",
			"ClineFree",
		]);
		expect(cloudCatalogId("cline-cloud/fast")).toBe("cline-cloud");
		expect(cloudCatalogId("cline-pass/reasoner")).toBe("cline-pass");
		expect(cloudProviderName("anthropic/sonnet")).toBe("Cline Usage-Billing");
	});
	it("keeps the full usage catalog and separates offers, preserving canonical reasoning capabilities", async () => {
		const catalog = Array.from({ length: 465 }, (_, i) => ({
			id: `vendor/model-${i}`,
			name: `Model ${i}`,
			supported_parameters: i === 0 ? [] : ["reasoning"],
		}));
		const gateway = new CloudSetupGateway({
			apiBaseUrl: "https://test",
			getAccessToken: async () => null,
			fetchImpl: (async (url) =>
				new Response(
					JSON.stringify(
						String(url).endsWith("/models")
							? {
									data: [
										...catalog,
										{ id: "cline-paid/model-1", supported_parameters: [] },
									],
								}
							: {
									clinePass: [{ id: "cline-pass/model-1", name: "Pass" }],
									clineCloud: [{ id: "cline-cloud/model-0", name: "Free" }],
								},
					),
				)) as typeof fetch,
		});
		const models = await gateway.listRecommendedModels();
		for (const entry of catalog)
			expect(models.find((model) => model.id === entry.id)?.catalogId).toBe(
				"cline",
			);
		expect(
			models.find((model) => model.id === "cline-pass/model-1"),
		).toMatchObject({ catalogId: "cline-pass", supportsReasoning: true });
		expect(
			models.find((model) => model.id === "cline-cloud/model-0"),
		).toMatchObject({ catalogId: "cline-cloud", supportsReasoning: false });
	});
});
