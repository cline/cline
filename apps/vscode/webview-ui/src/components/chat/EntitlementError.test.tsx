import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import EntitlementError from "./EntitlementError"

// Mocks are mutated per-test to simulate different auth/environment states.
const mockAuth: { clineUser: { appBaseUrl?: string } | null } = { clineUser: null }
const mockExtensionState: { environment?: string } = { environment: undefined }

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => mockAuth,
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}))

const askResponseMock = vi.fn()
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		askResponse: (...args: unknown[]) => askResponseMock(...args),
	},
}))

const getSubscribeHref = () => screen.getByRole("link", { name: /get cline pass/i }).getAttribute("href")

describe("EntitlementError", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.clineUser = null
		mockExtensionState.environment = undefined
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

	it("defaults the subscribe link to production when no auth/environment is available", () => {
		render(<EntitlementError />)
		expect(getSubscribeHref()).toBe("https://app.cline.bot/dashboard/subscription")
	})

	it("prefers the authenticated user's app base URL (staging)", () => {
		mockAuth.clineUser = { appBaseUrl: "https://staging-app.cline.bot" }
		render(<EntitlementError />)
		expect(getSubscribeHref()).toBe("https://staging-app.cline.bot/dashboard/subscription")
	})

	it("falls back to the current environment when the user app base URL is unavailable (staging)", () => {
		mockExtensionState.environment = "staging"
		render(<EntitlementError />)
		expect(getSubscribeHref()).toBe("https://staging-app.cline.bot/dashboard/subscription")
	})

	it("sends yesButtonClicked when Retry Request is clicked", () => {
		render(<EntitlementError />)
		// VSCodeButton has no ARIA role in jsdom; click by label text instead.
		fireEvent.click(screen.getByText("Retry Request"))
		expect(askResponseMock).toHaveBeenCalledTimes(1)
	})
})
