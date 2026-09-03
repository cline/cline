import { describe, expect, it, vi } from "vitest"

vi.mock("@/services/grpc-client", () => ({
	UiServiceClient: {
		openUrl: vi.fn(() => Promise.resolve({})),
	},
}))

import { buildClinePassSubscribeUrl, buildClinePassSubscriptionPageUrl } from "../clinePassSubscribe"

describe("ClinePass subscription URLs", () => {
	it("falls back to the default app base URL", () => {
		expect(buildClinePassSubscribeUrl(undefined)).toBe("https://app.cline.bot/onboarding/individual-plan")
		expect(buildClinePassSubscriptionPageUrl(undefined)).toBe("https://app.cline.bot/dashboard/subscription?personal=true")
	})

	it("preserves a path-prefixed app base URL", () => {
		expect(buildClinePassSubscribeUrl("https://proxy.example.com/cline")).toBe(
			"https://proxy.example.com/cline/onboarding/individual-plan",
		)
		expect(buildClinePassSubscriptionPageUrl("https://proxy.example.com/cline")).toBe(
			"https://proxy.example.com/cline/dashboard/subscription?personal=true",
		)
	})

	it("trims trailing slashes from the base URL", () => {
		expect(buildClinePassSubscribeUrl("https://app.cline.bot/")).toBe("https://app.cline.bot/onboarding/individual-plan")
	})
})
