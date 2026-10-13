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
				"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan:",
			)

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.Entitlement)
		})

		it("should return Entitlement for the SDK ClinePass subscription message with a different app URL", () => {
			const err = new ClineError(
				"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan:",
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

		it("should classify daily Cline free model limits separately", () => {
			const err = new ClineError(
				"Error: Error 429: Daily free limit reached on model deepseek/deepseek-v4-flash. Try again in 23h 59m",
			)

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.ClineFreeModelLimit)
		})

		it("should classify the host-stamped promotion-ended code as ClineFreePromotionEnded", () => {
			// reshapeErrorForWebview stamps this code when the active model is a
			// retired cline-free/ id (see message-translator).
			const err = new ClineError({
				message: "Model not found",
				code: "cline_free_promotion_ended",
			})

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.ClineFreePromotionEnded)
		})

		it("should classify model-not-found for a cline-free model as ClineFreePromotionEnded", () => {
			const err = new ClineError({ message: "Error 404: Model not found" }, "cline-free/glm-5")

			ClineError.getErrorType(err)!.should.equal(ClineErrorType.ClineFreePromotionEnded)
		})

		it("should prefer ClineFreePromotionEnded over Auth for a 404 with a cline-free model", () => {
			// A 404 falls inside the generic 401-428 auth-status range; the
			// promotion-ended classification must win.
			const err = new ClineError({ message: "Error 404: Model not found", status: 404 }, "cline-free/glm-5")

			const result = ClineError.getErrorType(err)
			result!.should.equal(ClineErrorType.ClineFreePromotionEnded)
		})

		it("should keep model-not-found for a non-free model on the generic path", () => {
			const err = new ClineError({ message: "Error 404: Model not found", status: 404 }, "deepseek/deepseek-v4-flash")

			const result = ClineError.getErrorType(err)
			;(result !== ClineErrorType.ClineFreePromotionEnded).should.be.true()
		})

		it("should not classify unrelated cline-free errors as ClineFreePromotionEnded", () => {
			const err = new ClineError({ message: "Network error: socket hang up" }, "cline-free/glm-5")

			const result = ClineError.getErrorType(err)
			;(result !== ClineErrorType.ClineFreePromotionEnded).should.be.true()
		})

		describe("HTTP status", () => {
			// A BYOK provider answering with a bare status: the message carries
			// no auth / rate-limit wording, so the status alone decides.
			const withStatus = (status: number, message = `Request failed with status code ${status}`) =>
				new ClineError({ message, status }, "qwen3-coder", "openai-compatible")

			it("classifies 401 and 403 as Auth", () => {
				for (const status of [401, 403]) {
					ClineError.getErrorType(withStatus(status))!.should.equal(ClineErrorType.Auth)
				}
			})

			it("leaves 407 on the generic row: the proxy rejected credentials, not the provider", () => {
				;(ClineError.getErrorType(withStatus(407)) === undefined).should.be.true()
			})

			it("classifies 402 as Balance, not Auth", () => {
				ClineError.getErrorType(withStatus(402))!.should.equal(ClineErrorType.Balance)
			})

			it("classifies 404, 405 and 410 as NotFound, not Auth", () => {
				for (const status of [404, 405, 410]) {
					ClineError.getErrorType(withStatus(status))!.should.equal(ClineErrorType.NotFound)
				}
			})

			it("leaves 400, 413 and 422 unclassified so the generic row shows the real status", () => {
				for (const status of [400, 413, 422]) {
					;(ClineError.getErrorType(withStatus(status)) === undefined).should.be.true()
				}
			})

			it("still classifies 429 by its rate-limit wording", () => {
				ClineError.getErrorType(withStatus(429, "Error 429: Too many requests"))!.should.equal(ClineErrorType.RateLimit)
			})

			it("lets the HTTP status override axios' ERR_BAD_REQUEST code", () => {
				// axios stamps ERR_BAD_REQUEST on every 4xx; a 404 carrying it is
				// still a not-found answer.
				const err = new ClineError({
					message: "Request failed with status code 404",
					status: 404,
					code: "ERR_BAD_REQUEST",
				})

				ClineError.getErrorType(err)!.should.equal(ClineErrorType.NotFound)
			})

			it("keeps ERR_BAD_REQUEST without a status as Auth", () => {
				const err = new ClineError({ message: "Request failed", code: "ERR_BAD_REQUEST" })

				ClineError.getErrorType(err)!.should.equal(ClineErrorType.Auth)
			})

			it("keeps message-based auth detection for status-less errors", () => {
				ClineError.getErrorType(new ClineError("Invalid API key"))!.should.equal(ClineErrorType.Auth)
			})

			it("keeps message-based auth detection for statuses outside the dedicated sets", () => {
				// Gemini answers an invalid key with HTTP 400, not 401; only the
				// wording identifies it as a credential problem.
				const err = new ClineError(
					{ message: "API key not valid. Please pass a valid API key.", status: 400 },
					"gemini-2.5-pro",
					"gemini",
				)

				ClineError.getErrorType(err)!.should.equal(ClineErrorType.Auth)
			})

			it("classifies a serialized 404 payload parsed by the webview as NotFound", () => {
				// llama-swap answers 404 for a model id it no longer serves.
				const payload = JSON.stringify({
					message: 'model "qwen3-coder" not found',
					status: 404,
					providerId: "openai-compatible",
				})

				const err = ClineError.parse(payload)!
				ClineError.getErrorType(err)!.should.equal(ClineErrorType.NotFound)
				err.isErrorType(ClineErrorType.Auth).should.be.false()
			})
		})
	})
})
