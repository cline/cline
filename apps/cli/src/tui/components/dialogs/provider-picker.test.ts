import { describe, expect, it } from "vitest";
import { buildClinePassSubscriptionPageUrl } from "./provider-picker-helpers";

describe("buildClinePassSubscriptionPageUrl", () => {
	it("opens the personal subscription page on production by default", () => {
		expect(buildClinePassSubscriptionPageUrl(undefined)).toBe(
			"https://app.cline.bot/dashboard/subscription?personal=true",
		);
	});

	it("keeps the configured app base URL", () => {
		expect(
			buildClinePassSubscriptionPageUrl("https://staging-app.cline.bot"),
		).toBe(
			"https://staging-app.cline.bot/dashboard/subscription?personal=true",
		);
	});
});
