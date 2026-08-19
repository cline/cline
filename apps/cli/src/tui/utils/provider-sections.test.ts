import { describe, expect, it } from "vitest";
import {
	getProviderSection,
	OTHER_PROVIDER_SECTION,
	POPULAR_PROVIDER_SECTION,
} from "./provider-sections";

describe("provider sections", () => {
	it("labels popular providers separately from the rest", () => {
		expect(getProviderSection({ capabilities: ["popular"] })).toBe(
			POPULAR_PROVIDER_SECTION,
		);
		expect(getProviderSection({ capabilities: ["reasoning"] })).toBe(
			OTHER_PROVIDER_SECTION,
		);
		expect(getProviderSection({})).toBe(OTHER_PROVIDER_SECTION);
	});
});
