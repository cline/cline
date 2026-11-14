import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import CreditLimitError from "./CreditLimitError"

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => ({ activeOrganization: undefined }),
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
})
