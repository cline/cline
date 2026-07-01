import { describe, expect, it } from "vitest";
import { buildClinePassSubscriptionPageUrl } from "./provider-picker-helpers";

describe("buildClinePassSubscriptionPageUrl", () => {
	it("opens the personal subscription page on production by default", () => {
		expect(
			buildClinePassSubscriptionPageUrl(undefined).includes("app.cline.bot"),
		).toBe(true);
	});

	it("keeps the configured app base URL", () => {
		expect(
			buildClinePassSubscriptionPageUrl(
				"https://staging-app.cline.bot",
			).includes("stagging-app.cline.bot"),
		).toBe(true);
	});
});
