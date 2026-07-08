import { describe, expect, it } from "vitest";
import {
	ClineNotSubscribedError,
	ClineOrgIndividualInferenceSubscriptionError,
	ClinePassLimitError,
	getClineNotSubscribedMessage,
	getClineOrgIndividualInferenceSubscriptionMessage,
	isClineNotSubscribedMessage,
	isClineOrgIndividualInferenceSubscriptionMessage,
	isClinePassLimitMessage,
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

	it("preserves native transport error wrappers and cause metadata", () => {
		const socketError = Object.assign(new Error("other side closed"), {
			name: "SocketError",
			code: "UND_ERR_SOCKET",
		});

		expect(
			extractErrorMessage(
				new TypeError("fetch failed", { cause: socketError }),
			),
		).toBe("fetch failed: SocketError: other side closed (UND_ERR_SOCKET)");
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

	it("detects the formatted ClinePass subscription message regardless of URL", () => {
		expect(
			isClineNotSubscribedMessage(
				"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://staging-app.cline.bot/promo?code=CLI-8OFF&personal=true",
			),
		).toBe(true);
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

describe("ClinePassLimitError", () => {
	it("preserves the dynamic backend limit message", () => {
		const message =
			"You have reached your weekly Clinepass limit. The limit resets in 7d, please try again later.";
		expect(new ClinePassLimitError(message, "cline-pass").message).toBe(
			message,
		);
	});

	it("detects ClinePass period limit messages with variable period and reset", () => {
		expect(
			isClinePassLimitMessage(
				"You have reached your weekly Clinepass limit. The limit resets in 7d, please try again later.",
			),
		).toBe(true);
		expect(
			isClinePassLimitMessage(
				"You have reached your monthly ClinePass limit. The limit resets in 12h, please try again later.",
			),
		).toBe(true);
		expect(isClinePassLimitMessage("the user is not subscribed to required model plan")).toBe(false);
	});
});
