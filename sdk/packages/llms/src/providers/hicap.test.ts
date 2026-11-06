import { describe, expect, it } from "vitest";
import { BUILTIN_PROVIDER_MANIFESTS_BY_ID, BUILTIN_SPECS } from "./builtins";
import { BUILT_IN_PROVIDER, isBuiltInProviderId } from "./ids";
import { getProvider } from "./model-registry";

const HICAP_BASE_URL = "https://api.hicap.ai/v1";

function findHicapSpec() {
	const spec = BUILTIN_SPECS.find((candidate) => candidate.id === "hicap");
	if (!spec) {
		throw new Error("hicap builtin spec not found");
	}
	return spec;
}

describe("hicap builtin spec", () => {
	it("is registered under the canonical provider id", () => {
		expect(BUILT_IN_PROVIDER.HICAP).toBe("hicap");
		expect(isBuiltInProviderId("hicap")).toBe(true);
		expect(BUILTIN_PROVIDER_MANIFESTS_BY_ID.hicap).toBeDefined();
	});

	it("declares the OpenAI-compatible endpoint and key environment variable", () => {
		expect(findHicapSpec()).toMatchObject({
			id: "hicap",
			family: "openai-compatible",
			defaultModelId: "hicap-pro",
			apiKeyEnv: ["HICAP_API_KEY"],
			defaults: { baseUrl: HICAP_BASE_URL },
		});
	});

	it("resolves through the provider registry with its default endpoint", async () => {
		await expect(getProvider("hicap")).resolves.toMatchObject({
			id: "hicap",
			baseUrl: HICAP_BASE_URL,
			defaultModelId: "hicap-pro",
		});
	});

	it("is selectable as a default provider without a user-supplied base URL", async () => {
		const provider = await getProvider("hicap");
		expect(provider?.baseUrl).toBe(HICAP_BASE_URL);
		expect(BUILTIN_PROVIDER_MANIFESTS_BY_ID.hicap).toBeDefined();
		expect(findHicapSpec().apiKeyEnv).toContain("HICAP_API_KEY");
	});
});
