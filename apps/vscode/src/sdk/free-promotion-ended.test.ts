import { describe, expect, it } from "vitest"
import { ClineError, ClineErrorType } from "../services/error/ClineError"
import { reshapeErrorForWebview } from "./message-translator"

// Once a free promotion ends the cline-free/ model is removed from the catalog
// and the backend answers "model not found". These tests pin the host-side
// detection that turns that answer into the webview's promotion-ended card.
describe("reshapeErrorForWebview - free promotion ended", () => {
	it("stamps the promotion-ended code when a cline-free model answers model-not-found", () => {
		const payload = reshapeErrorForWebview({ message: "Error 404: Model not found" }, "cline", "cline-free/glm-5")

		const parsed = JSON.parse(payload)
		expect(parsed.code).toBe("cline_free_promotion_ended")
		expect(parsed.modelId).toBe("cline-free/glm-5")
		expect(parsed.providerId).toBe("cline")
		expect(parsed.details?.code).toBe("cline_free_promotion_ended")
	})

	it("keeps the selected provider id, so cline-pass selections stay attributed", () => {
		const payload = reshapeErrorForWebview({ message: "Model not found" }, "cline-pass", "cline-free/glm-5")

		expect(JSON.parse(payload).providerId).toBe("cline-pass")
	})

	it("round-trips into the webview's ClineFreePromotionEnded classification", () => {
		const payload = reshapeErrorForWebview({ message: "Error 404: Model not found" }, "cline", "cline-free/glm-5")

		const clineError = ClineError.parse(payload)
		expect(clineError && ClineError.getErrorType(clineError)).toBe(ClineErrorType.ClineFreePromotionEnded)
	})

	it("leaves model-not-found for a paid model on the generic guidance path", () => {
		const payload = reshapeErrorForWebview({ message: "Model not found" }, "cline", "deepseek/deepseek-v4-flash")

		expect(payload).toBe(
			"Model not found This model may be retired or unavailable on your account. Switch to a different model in API Configuration settings, then retry.",
		)
	})

	it("leaves model-not-found on the generic guidance path when the model id is unknown", () => {
		const payload = reshapeErrorForWebview({ message: "Model not found" }, "cline")

		expect(payload).toContain("This model may be retired or unavailable")
	})

	it("does not touch unrelated errors from a cline-free model", () => {
		expect(reshapeErrorForWebview({ message: "socket hang up" }, "cline", "cline-free/glm-5")).toBe("socket hang up")
	})
})
