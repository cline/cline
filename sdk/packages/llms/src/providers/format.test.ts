import { describe, expect, it } from "vitest";
import {
	ClineNotSubscribedError,
	ClineOrgIndividualInferenceSubscriptionError,
	getClineOrgIndividualInferenceSubscriptionMessage,
	getClineNotSubscribedMessage,
	isClineNotSubscribedMessage,
	isClineOrgIndividualInferenceSubscriptionMessage,
} from "./errors";
import { extractErrorMessage } from "./format";

describe("extractErrorMessage", () => {
	it("extracts structured provider errors without fallback branches", () => {
		expect(
			extractErrorMessage({
				statusCode: 400,
				responseBody: {
					error: {
						message: "Bad request detail",
					},
				},
				message: "Bad Request",
			}),
		).toBe("Bad request detail");

		expect(
			extractErrorMessage({
				cause: new Error("Nested failure"),
			}),
		).toBe("Nested failure");

		expect(extractErrorMessage(new Error("Plain failure"))).toBe(
			"Plain failure",
		);
	});

	it("prefers nested stream error details over generic wrapper messages", () => {
		expect(
			extractErrorMessage({
				message: "Stream error occurred",
				errors: [
					{
						responseBody: JSON.stringify({
							error: { message: "Missing upstream API key" },
						}),
					},
				],
			}),
		).toBe("Missing upstream API key");
	});
});

describe("ClineNotSubscribedError", () => {
	it("uses the user-facing subscription message", () => {
		expect(new ClineNotSubscribedError("cline-pass").message).toBe(
			getClineNotSubscribedMessage(),
		);
	});

	it("detects the ClinePass required-plan message", () => {
		expect(
			isClineNotSubscribedMessage(
				JSON.stringify({
					error: {
						message: "the user is not subscribed to required model plan",
					},
				}),
			),
		).toBe(true);
		expect(isClineNotSubscribedMessage("different forbidden error")).toBe(
			false,
		);
	});
});

describe("ClineOrgIndividualInferenceSubscriptionError", () => {
	it("uses the user-facing organization account message", () => {
		expect(
			new ClineOrgIndividualInferenceSubscriptionError("cline").message,
		).toBe(getClineOrgIndividualInferenceSubscriptionMessage());
	});

	it("detects the organization individual-subscription entitlement message", () => {
		expect(
			isClineOrgIndividualInferenceSubscriptionMessage(
				JSON.stringify({
					error: {
						code: "ENTITLEMENT_ERROR",
						message:
							"organization accounts cannot use individual model inference subscriptions",
					},
				}),
			),
		).toBe(true);
		expect(
			isClineOrgIndividualInferenceSubscriptionMessage(
				"the user is not subscribed to required model plan",
			),
		).toBe(false);
	});
});
