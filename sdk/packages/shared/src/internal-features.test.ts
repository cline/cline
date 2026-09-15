import { describe, expect, it } from "vitest";
import {
	InternalFeature,
	isInternalFeatureEnabled,
	isInternalUserEmail,
} from "./internal-features";

describe("isInternalUserEmail", () => {
	it("accepts @cline.bot accounts case-insensitively", () => {
		expect(isInternalUserEmail("beatrix@cline.bot")).toBe(true);
		expect(isInternalUserEmail("Beatrix@Cline.Bot")).toBe(true);
		expect(isInternalUserEmail("  someone@cline.bot  ")).toBe(true);
	});

	it("rejects lookalike and subdomain addresses", () => {
		expect(isInternalUserEmail("attacker@notcline.bot")).toBe(false);
		expect(isInternalUserEmail("attacker@cline.bot.evil.com")).toBe(false);
		expect(isInternalUserEmail("attacker@team.cline.bot")).toBe(false);
		expect(isInternalUserEmail("cline.bot@example.com")).toBe(false);
	});

	it("rejects missing or malformed emails", () => {
		expect(isInternalUserEmail(undefined)).toBe(false);
		expect(isInternalUserEmail(null)).toBe(false);
		expect(isInternalUserEmail("")).toBe(false);
		expect(isInternalUserEmail("@cline.bot")).toBe(false);
		expect(isInternalUserEmail("someone@")).toBe(false);
		expect(isInternalUserEmail("cline.bot")).toBe(false);
	});
});

describe("isInternalFeatureEnabled", () => {
	it("grants access to internal users regardless of the flag", () => {
		expect(
			isInternalFeatureEnabled(InternalFeature.COMPOSIO_CONNECTORS, {
				email: "beatrix@cline.bot",
				isFlagEnabled: () => false,
			}),
		).toBe(true);
	});

	it("grants access via the feature flag for external users", () => {
		const seenKeys: string[] = [];
		expect(
			isInternalFeatureEnabled(InternalFeature.COMPOSIO_CONNECTORS, {
				email: "user@example.com",
				isFlagEnabled: (flagKey) => {
					seenKeys.push(flagKey);
					return true;
				},
			}),
		).toBe(true);
		expect(seenKeys).toEqual([InternalFeature.COMPOSIO_CONNECTORS]);
	});

	it("fails closed with no email and no flag resolver", () => {
		expect(
			isInternalFeatureEnabled(InternalFeature.COMPOSIO_CONNECTORS, {}),
		).toBe(false);
		expect(
			isInternalFeatureEnabled(InternalFeature.COMPOSIO_CONNECTORS, {
				email: "user@example.com",
			}),
		).toBe(false);
		expect(
			isInternalFeatureEnabled(InternalFeature.COMPOSIO_CONNECTORS, {
				email: "user@example.com",
				isFlagEnabled: () => false,
			}),
		).toBe(false);
	});
});
