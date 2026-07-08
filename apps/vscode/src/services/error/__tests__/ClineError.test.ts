import { describe, it } from "mocha";
import "should";
import {
	ClineError,
	ClineErrorType,
	extractClinePassLimitMessage,
	isClinePassLimitMessage,
} from "../ClineError";

describe("ClineError", () => {
	describe("getErrorType", () => {
		it("should return QuotaExceeded when code is INFERENCE_CAP_ERROR", () => {
			const err = new ClineError({
				message: "Inference cap reached",
				code: "INFERENCE_CAP_ERROR",
			});
			ClineError.getErrorType(err)!.should.equal(ClineErrorType.QuotaExceeded);
		});

		it("should return Entitlement when code is ENTITLEMENT_ERROR", () => {
			const err = new ClineError({
				message:
					"403 Error 403: the user is not subscribed to required model plan",
				code: "ENTITLEMENT_ERROR",
				status: 403,
			});
			ClineError.getErrorType(err)!.should.equal(ClineErrorType.Entitlement);
		});

		it("should return Entitlement when details.code is ENTITLEMENT_ERROR", () => {
			const err = new ClineError({
				message:
					"403 Error 403: the user is not subscribed to required model plan",
				status: 403,
				details: {
					code: "ENTITLEMENT_ERROR",
					message:
						"Error 403: the user is not subscribed to required model plan",
				},
			});
			ClineError.getErrorType(err)!.should.equal(ClineErrorType.Entitlement);
		});

		it("should prefer Entitlement over Auth for 403 ENTITLEMENT_ERROR", () => {
			// status 403 would otherwise be classified as Auth; the entitlement code must win.
			const err = new ClineError({
				message:
					"403 Error 403: the user is not subscribed to required model plan",
				code: "ENTITLEMENT_ERROR",
				status: 403,
			});
			ClineError.getErrorType(err)!.should.not.equal(ClineErrorType.Auth);
			ClineError.getErrorType(err)!.should.equal(ClineErrorType.Entitlement);
		});

		it("should return Entitlement for the real Cline 403 provider error shape (nested error object)", () => {
			// ClineError maps `error.error` into `details`, so `details.code` drives classification.
			const err = new ClineError(
				{
					status: 403,
					error: {
						code: "ENTITLEMENT_ERROR",
						message:
							"Error 403: the user is not subscribed to required model plan",
					},
				},
				"cline-pass/glm-5.2",
				"cline-pass",
			);
			ClineError.getErrorType(err)!.should.equal(ClineErrorType.Entitlement);
		});

		it("should classify the organization ENTITLEMENT_ERROR variant separately from the ClinePass subscription card", () => {
			// Org accounts can't use individual subs; this case should not show the personal ClinePass
			// subscription card, but it should still get dedicated user-actionable copy.
			const err = new ClineError({
				message:
					"403 Error 403: organization accounts cannot use individual model inference subscriptions",
				code: "ENTITLEMENT_ERROR",
				status: 403,
			});
			const result = ClineError.getErrorType(err);
			result!.should.equal(ClineErrorType.OrgClinePassRestriction);
			(result !== ClineErrorType.Entitlement).should.be.true();
		});

		it("should not classify organization restriction text without ENTITLEMENT_ERROR as OrgClinePassRestriction", () => {
			const err = new ClineError({
				message:
					"Network error: organization accounts cannot use individual model inference subscriptions",
				code: "ERR_NETWORK",
			});

			const result = ClineError.getErrorType(err);
			(result !== ClineErrorType.OrgClinePassRestriction).should.be.true();
		});

		it("should classify ClinePass period limit messages as ClinePassLimit", () => {
			const err = new ClineError(
				"You have reached your weekly Clinepass limit. The limit resets in 7d, please try again later.",
			);

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.ClinePassLimit);
		});

		it("should classify nested ClinePass period limit messages as ClinePassLimit", () => {
			// ClineError maps `error.error` into `details`, matching the real provider error shape.
			const err = new ClineError({
				message: "403 Error 403",
				error: {
					message:
						"You have reached your monthly ClinePass limit. The limit resets in 12h, please try again later.",
				},
			});

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.ClinePassLimit);
		});

		it("should prefer ClinePassLimit over Auth for a 403 with the limit message", () => {
			// status 403 falls inside the generic auth-status range; the limit message must win.
			const err = new ClineError({
				message:
					"You have reached your 5-hour Clinepass limit. The limit resets in 5h, please try again later.",
				status: 403,
			});

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.ClinePassLimit);
		});
	});

	describe("isClinePassLimitMessage", () => {
		it("matches limit messages with variable period and reset", () => {
			isClinePassLimitMessage(
				"You have reached your weekly Clinepass limit. The limit resets in 7d, please try again later.",
			).should.be.true();
			isClinePassLimitMessage(
				"You have reached your 5-hour ClinePass limit. The limit resets in 5h, please try again later.",
			).should.be.true();
		});

		it("does not match unrelated or partial messages", () => {
			isClinePassLimitMessage(
				"the user is not subscribed to required model plan",
			).should.be.false();
			isClinePassLimitMessage(
				`You have reached your\t-\tClinepass limit.The limit resets in\t${"\t".repeat(10_000)}`,
			).should.be.false();
		});
	});

	describe("extractClinePassLimitMessage", () => {
		it("extracts the limit message out of a wrapped error string", () => {
			const message =
				"You have reached your weekly Clinepass limit. The limit resets in 7d, please try again later.";

			extractClinePassLimitMessage(`429 Error: ${message}`)!.should.equal(
				message,
			);
		});

		it("returns undefined when there is no limit message", () => {
			(
				extractClinePassLimitMessage("some other error") === undefined
			).should.be.true();
		});
	});
});
