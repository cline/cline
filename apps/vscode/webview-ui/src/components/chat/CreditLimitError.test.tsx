import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import CreditLimitError from "./CreditLimitError"

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => ({ clineUser: null, activeOrganization: undefined }),
}))

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		getRedirectUrl: vi.fn().mockResolvedValue({ value: "https://example.com/callback" }),
	},
}))

describe("CreditLimitError", () => {
	it("uses the shared recovery handler when Retry Request is clicked", async () => {
		const retryFailedRequest = vi.fn().mockResolvedValue(true)
		render(<CreditLimitError currentBalance={0} message="Out of credits" retryFailedRequest={retryFailedRequest} />)

		await act(async () => {
			fireEvent.click(screen.getByText("Retry Request"))
			await Promise.resolve()
		})

		expect(retryFailedRequest).toHaveBeenCalledTimes(1)
	})

	it("keeps Buy Credits for API-key users when the error carries no buy credits URL", async () => {
		render(<CreditLimitError currentBalance={0} message="Out of credits" />)

		const link = await screen.findByText("Buy Credits")
		expect(link.closest("a")?.getAttribute("href")).toBe(
			"https://app.cline.bot/dashboard/account?tab=credits&redirect=true&client=cline-vscode&callback_url=https%3A%2F%2Fexample.com%2Fcallback",
		)
	})
})
