import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import EntitlementError from "./EntitlementError"

const mockAuth: { clineUser: { appBaseUrl?: string } | null } = { clineUser: null }

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => mockAuth,
}))

const askResponseMock = vi.fn()
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		askResponse: (...args: unknown[]) => askResponseMock(...args),
	},
}))

const getSubscribeHref = () => screen.getByRole("link", { name: /get cline pass/i }).getAttribute("href")
const querySubscribeLink = () => screen.queryByRole("link", { name: /get cline pass/i })

describe("EntitlementError", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.clineUser = null
	})

	it("shows the friendly headline regardless of the backend message", () => {
		render(<EntitlementError message="Error 403: the user is not subscribed to required model plan" />)
		expect(screen.getByText("This model requires a Cline Pass subscription.")).toBeInTheDocument()
	})

	it("surfaces the backend detail as muted support text when it differs from the headline", () => {
		render(<EntitlementError message="Error 403: the user is not subscribed to required model plan" />)
		expect(screen.getByText("Error 403: the user is not subscribed to required model plan")).toBeInTheDocument()
	})

	it("does not duplicate the headline when no backend detail is provided", () => {
		render(<EntitlementError />)
		expect(screen.getAllByText("This model requires a Cline Pass subscription.")).toHaveLength(1)
	})

	it("omits the subscribe link when there is no signed-in user", () => {
		render(<EntitlementError />)
		expect(querySubscribeLink()).toBeNull()
	})

	it("omits the subscribe link when the signed-in user has no app base URL", () => {
		mockAuth.clineUser = {}
		render(<EntitlementError />)
		expect(querySubscribeLink()).toBeNull()
	})

	it("prefers the authenticated user's app base URL (staging)", () => {
		mockAuth.clineUser = { appBaseUrl: "https://staging-app.cline.bot" }
		render(<EntitlementError />)
		expect(getSubscribeHref()).toBe("https://staging-app.cline.bot/dashboard/subscription")
	})

	it("appends to a path-prefixed app base URL (self-hosted/proxy) instead of resetting to origin", () => {
		mockAuth.clineUser = { appBaseUrl: "https://proxy.enterprise.com/cline/app" }
		render(<EntitlementError />)
		expect(getSubscribeHref()).toBe("https://proxy.enterprise.com/cline/app/dashboard/subscription")
	})

	it("sends a yesButtonClicked askResponse when Retry Request is clicked", () => {
		render(<EntitlementError />)
		// VSCodeButton has no ARIA role in jsdom; click by label text instead.
		fireEvent.click(screen.getByText("Retry Request"))
		expect(askResponseMock).toHaveBeenCalledTimes(1)
		expect(askResponseMock.mock.calls[0][0]).toMatchObject({ responseType: "yesButtonClicked" })
	})
})
