import { describe, it } from "bun:test"
import "should"
import { ClineError, ClineErrorType } from "../ClineError"

describe("ClineError", () => {
	describe("getErrorType", () => {
		it("should return QuotaExceeded when code is INFERENCE_CAP_ERROR", () => {
			const err = new ClineError({ message: "Inference cap reached", code: "INFERENCE_CAP_ERROR" })
			ClineError.getErrorType(err)!.should.equal(ClineErrorType.QuotaExceeded)
		})

		it("should return Entitlement for the SDK ClineNotSubscribedError name", () => {
			const err = new ClineError({
				name: "ClineNotSubscribedError",
				message:
					"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://app.cline.bot/promo?code=CLI-100&personal=true",
			})

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.Entitlement)
		})

		it("should return Entitlement for the SDK ClinePass subscription message", () => {
			const err = new ClineError(
				"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://app.cline.bot/promo?code=CLI-100&personal=true",
			)

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.Entitlement)
		})

		it("should return Entitlement for the raw required-plan message", () => {
			const err = new ClineError("403 Error 403: the user is not subscribed to required model plan")

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.Entitlement)
		})

		it("should classify the SDK org individual subscription error separately", () => {
			const err = new ClineError({
				name: "ClineOrgIndividualInferenceSubscriptionError",
				message:
					"Organization accounts cannot use ClinePass subscriptions. Go to /account -> change account to switch to your personal account for ClinePass",
			})

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.OrgClinePassRestriction)
		})

		it("should classify the raw organization individual subscription message separately", () => {
			const err = new ClineError("403 Error 403: organization accounts cannot use individual model inference subscriptions")

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.OrgClinePassRestriction)
		})
	})
})
