import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import { useClineAuth } from "./context/ClineAuthContext"
import { useExtensionState } from "./context/ExtensionStateContext"

vi.mock("./Providers", () => ({
	Providers: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock("./context/ClineAuthContext", () => ({
	useClineAuth: vi.fn(),
}))

vi.mock("./context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

function createExtensionStateMock(overrides: Record<string, unknown> = {}) {
	return {
		didHydrateState: false,
		webviewBootstrapAttempt: 1,
		webviewBootstrapError: undefined,
		webviewBootstrapStatus: "hydrating",
		showWelcome: false,
		shouldShowAnnouncement: false,
		dismissedBanners: [],
		showMcp: false,
		mcpTab: undefined,
		showSettings: false,
		settingsTargetSection: undefined,
		showHistory: false,
		showAccount: false,
		showWorktrees: false,
		showAnnouncement: false,
		onboardingModels: undefined,
		setShowAnnouncement: vi.fn(),
		setShouldShowAnnouncement: vi.fn(),
		closeMcpView: vi.fn(),
		navigateToHistory: vi.fn(),
		hideSettings: vi.fn(),
		hideHistory: vi.fn(),
		hideAccount: vi.fn(),
		hideWorktrees: vi.fn(),
		hideAnnouncement: vi.fn(),
		reloadWebview: vi.fn(),
		retryWebviewBootstrap: vi.fn(),
		...overrides,
	}
}

describe("App grey-screen regression coverage", () => {
	beforeEach(() => {
		vi.mocked(useClineAuth).mockReturnValue({
			clineUser: null,
			organizations: null,
			activeOrganization: null,
		} as any)
	})

	it("renders a visible loading screen before hydration instead of returning null", () => {
		vi.mocked(useExtensionState).mockReturnValue(createExtensionStateMock() as any)

		render(<App />)

		expect(screen.getByText("Loading Cline")).toBeTruthy()
		expect(screen.getByText("Waiting for the extension to send the initial Cline state…")).toBeTruthy()
	})

	it("renders recovery actions when bootstrap degrades", () => {
		const retryWebviewBootstrap = vi.fn()
		const reloadWebview = vi.fn()

		vi.mocked(useExtensionState).mockReturnValue(
			createExtensionStateMock({
				webviewBootstrapStatus: "degraded",
				webviewBootstrapError: "Timed out waiting for the initial Cline state after 8 seconds.",
				retryWebviewBootstrap,
				reloadWebview,
			}) as any,
		)

		render(<App />)

		expect(screen.getByText("Cline is having trouble loading")).toBeTruthy()
		fireEvent.click(screen.getByRole("button", { name: "Retry connection" }))
		fireEvent.click(screen.getByRole("button", { name: "Reload webview" }))

		expect(retryWebviewBootstrap).toHaveBeenCalledTimes(1)
		expect(reloadWebview).toHaveBeenCalledTimes(1)
	})
})
