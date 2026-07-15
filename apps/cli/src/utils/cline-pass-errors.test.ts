import { describe, expect, it } from "vitest";
import {
	formatCliErrorMessage,
	getCliClinePassLimitMessage,
	getCliNotSubscribedMessage,
	getClineOrgIndividualInferenceSubscriptionMessage,
	getClinePassLimitDetailMessage,
	getCliSubscriptionUrl,
	isClineOrgIndividualInferenceSubscriptionErrorMessage,
	isClinePassLimitErrorMessage,
	isClinePassSubscriptionError,
} from "./cline-pass-errors";

describe("cline-pass-errors", () => {
	it("recognizes both raw and formatted ClinePass subscription messages", () => {
		expect(
			isClinePassSubscriptionError(
				"the user is not subscribed to required model plan",
			),
		).toBe(true);

		const sdkFormatted =
			"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://app.cline.bot/dashboard/subscription?personal=true";
		const formatted = getCliNotSubscribedMessage();
		expect(isClinePassSubscriptionError(sdkFormatted)).toBe(true);
		expect(isClinePassSubscriptionError(formatted)).toBe(true);
		expect(formatCliErrorMessage(new Error(sdkFormatted))).toBe(formatted);
		expect(formatCliErrorMessage(new Error(formatted))).toBe(formatted);
	});

	it("formats the ClinePass subscription URL", () => {
		expect(getCliSubscriptionUrl()).toBe(
			"https://app.cline.bot/promo?code=CLI-8OFF&personal=true",
		);
	});

	it("recognizes and formats organization account individual subscription errors", () => {
		const raw =
			"403 Error 403: organization accounts cannot use individual model inference subscriptions";
		const formatted = getClineOrgIndividualInferenceSubscriptionMessage();

		expect(isClineOrgIndividualInferenceSubscriptionErrorMessage(raw)).toBe(
			true,
		);
		expect(
			isClineOrgIndividualInferenceSubscriptionErrorMessage(
				new Error(formatted),
			),
		).toBe(true);
		expect(formatCliErrorMessage(new Error(raw))).toBe(formatted);
	});

	it("recognizes and formats ClinePass period limit errors with usage-billing guidance", () => {
		const raw =
			"Error: You have reached your 5-hour Clinepass limit. The limit resets in 5h, please try again later.";
		const detail =
			"You have reached your 5-hour Clinepass limit. The limit resets in 5h, please try again later.";

		expect(isClinePassLimitErrorMessage(raw)).toBe(true);
		expect(isClinePassLimitErrorMessage(new Error(raw))).toBe(true);
		expect(getClinePassLimitDetailMessage(raw)).toBe(detail);
		expect(formatCliErrorMessage(new Error(raw))).toBe(
			getCliClinePassLimitMessage(raw),
		);
		expect(formatCliErrorMessage(new Error(raw))).toContain(
			"Switch to Cline usage-based billing",
		);
		expect(formatCliErrorMessage(new Error(raw))).toContain("--provider cline");
	});
});
