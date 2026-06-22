import { describe, expect, it } from "vitest";
import {
	formatCliErrorMessage,
	getClinePassSubscriptionUrl,
	isClinePassSubscriptionError,
} from "./cline-pass-errors";

describe("cline-pass-errors", () => {
	it("recognizes both raw and formatted ClinePass subscription messages", () => {
		expect(
			isClinePassSubscriptionError(
				"the user is not subscribed to required model plan",
			),
		).toBe(true);

		const formatted = `No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: ${getClinePassSubscriptionUrl()}`;
		expect(isClinePassSubscriptionError(formatted)).toBe(true);
		expect(formatCliErrorMessage(new Error(formatted))).toBe(formatted);
	});

	it("formats the ClinePass subscription URL", () => {
		expect(getClinePassSubscriptionUrl()).toBe(
			"https://app.cline.bot/dashboard/subscription?personal=true",
		);
	});
});
