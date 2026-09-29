import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import EntitlementError from "./EntitlementError"

const mockAuth: { clineUser: { appBaseUrl?: string } | null } = {
	clineUser: null,
}

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => mockAuth,
}))

const getSubscribeHref = () => screen.getByRole("link", { name: /get clinepass/i }).getAttribute("href")
const querySubscribeLink = () => screen.queryByRole("link", { name: /get clinepass/i })

describe("EntitlementError", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.clineUser = null
	})

	it("shows friendly copy with the backend detail as muted support text", () => {
		render(<EntitlementError message="Error 403: the user is not subscribed to required model plan" />)
		expect(screen.getByText("This model requires a ClinePass subscription.")).toBeInTheDocument()
		expect(screen.getByText("Error 403: the user is not subscribed to required model plan")).toBeInTheDocument()
	})

	it("omits the subscribe link when no usable app base URL is available", () => {
		render(<EntitlementError />)
		expect(querySubscribeLink()).toBeNull()

		mockAuth.clineUser = {}
		render(<EntitlementError />)
		expect(querySubscribeLink()).toBeNull()

		mockAuth.clineUser = { appBaseUrl: "not a valid url" }
		render(<EntitlementError />)
		expect(querySubscribeLink()).toBeNull()
	})

	it("builds the subscribe link from the authenticated user's app base URL", () => {
		mockAuth.clineUser = { appBaseUrl: "https://staging-app.cline.bot" }
		const { unmount } = render(<EntitlementError />)
		expect(getSubscribeHref()).toBe("https://staging-app.cline.bot/dashboard/subscription?personal=true")
		unmount()

		mockAuth.clineUser = {
			appBaseUrl: "https://proxy.enterprise.com/cline/app",
		}
		render(<EntitlementError />)
		expect(getSubscribeHref()).toBe("https://proxy.enterprise.com/cline/app/dashboard/subscription?personal=true")
	})

	it("uses the shared recovery handler when Retry Request is clicked", () => {
		const retryFailedRequest = vi.fn().mockResolvedValue(true)
		render(<EntitlementError retryFailedRequest={retryFailedRequest} />)
		// VSCodeButton has no ARIA role in jsdom; click by label text instead.
		fireEvent.click(screen.getByText("Retry Request"))
		expect(retryFailedRequest).toHaveBeenCalledTimes(1)
	})
})
