import { describe, expect, it } from "vitest";
import { getProviderIds } from "../gateway/model-registry";
import { BUILT_IN_PROVIDER_IDS } from "./ids";

describe("provider-ids", () => {
	it("keeps built-in provider ids aligned with model registry loaders", () => {
		const registryProviderIds = new Set(getProviderIds());
		for (const providerId of BUILT_IN_PROVIDER_IDS) {
			expect(registryProviderIds.has(providerId)).toBe(true);
		}
	});
});
