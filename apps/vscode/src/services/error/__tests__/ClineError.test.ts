import { describe, it } from "bun:test"
import "should"
import { ClineError, ClineErrorType } from "../ClineError"

describe("ClineError", () => {
	describe("getErrorType", () => {
		it("should return QuotaExceeded when code is INFERENCE_CAP_ERROR", () => {
			const err = new ClineError({ message: "Inference cap reached", code: "INFERENCE_CAP_ERROR" })
			ClineError.getErrorType(err)!.should.equal(ClineErrorType.QuotaExceeded)
		})

		it("should return Entitlement for the SDK ClinePass subscription message", () => {
			const err = new ClineError(
				"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://app.cline.bot/promo?code=CLI-8OFF&personal=true",
			)

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.Entitlement)
		})

		it("should return Entitlement for the SDK ClinePass subscription message with a different app URL", () => {
			const err = new ClineError(
				"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://staging-app.cline.bot/promo?code=CLI-8OFF&personal=true",
			)

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.Entitlement)
		})

		it("should return Entitlement for the raw required-plan message", () => {
			const err = new ClineError("403 Error 403: the user is not subscribed to required model plan")

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.Entitlement)
		})

		it("should classify the SDK org individual subscription message separately", () => {
			const err = new ClineError(
				"Organization accounts cannot use ClinePass subscriptions. Go to /account -> change account to switch to your personal account for ClinePass",
			)

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.OrgClinePassRestriction)
		})

		it("should classify the raw organization individual subscription message separately", () => {
			const err = new ClineError("403 Error 403: organization accounts cannot use individual model inference subscriptions")

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.OrgClinePassRestriction)
		})

		it("should classify ClinePass period limit messages separately", () => {
			const err = new ClineError(
				"You have reached your weekly Clinepass limit. The limit resets in 7d, please try again later.",
			)

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.ClinePassLimit)
		})

		it("should classify nested ClinePass period limit messages separately", () => {
			const err = new ClineError({
				message: "403 Error 403",
				error: {
					message: "You have reached your monthly ClinePass limit. The limit resets in 12h, please try again later.",
				},
			})

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.ClinePassLimit)
		})
	})
})
