import { describe, expect, it } from "vitest";
import {
	DEFAULT_CLINE_PROVIDER_LANGFUSE_BASE_URL,
	parseLangfuseTelemetryFeatureFlag,
} from "./feature-flags";

describe("parseLangfuseTelemetryFeatureFlag", () => {
	it("normalizes a complete feature-flag credential pair", () => {
		expect(
			parseLangfuseTelemetryFeatureFlag(" public-key :: secret-key "),
		).toEqual({
			baseUrl: DEFAULT_CLINE_PROVIDER_LANGFUSE_BASE_URL,
			publicKey: "public-key",
			secretKey: "secret-key",
		});
	});

	it.each([
		false,
		{},
		"",
		"public-key",
		"::secret-key",
		"public-key::",
		"public-key::secret-key::extra",
	])("rejects an invalid value: %j", (value) => {
		expect(parseLangfuseTelemetryFeatureFlag(value)).toBeUndefined();
	});
});
