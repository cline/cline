import { describe, expect, it } from "vitest";
import { safeParseSettings, toProviderConfig } from "./provider-settings";

describe("provider settings", () => {
	it("builds a Bedrock provider config", () => {
		const result = safeParseSettings({
			provider: "bedrock",
			model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			connection: {
				region: "ca-central-1",
				profile: "engineering-sso",
			},
		});

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error("expected Bedrock settings to parse");
		}

		expect(toProviderConfig(result.data)).toMatchObject({
			providerId: "bedrock",
			modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			connection: {
				region: "ca-central-1",
				profile: "engineering-sso",
			},
		});
	});

	it("rejects removed provider settings", () => {
		expect(
			safeParseSettings({
				provider: "bedrockCoder",
				model: "anthropic/claude-sonnet-4.6",
			}).success,
		).toBe(false);
	});
});
