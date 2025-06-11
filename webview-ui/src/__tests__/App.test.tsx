// npx jest src/__tests__/App.test.tsx

import React from "react"
import { render, screen, act, cleanup } from "@testing-library/react"
import "@testing-library/jest-dom"

import AppWithProviders from "../App"

jest.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))

jest.mock("@src/components/chat/ChatView", () => ({
	__esModule: true,
	default: function ChatView({ isHidden }: { isHidden: boolean }) {
		return (
			<div data-testid="chat-view" data-hidden={isHidden}>
				Chat View
			</div>
		)
	},
}))

jest.mock("@src/components/settings/SettingsView", () => ({
	__esModule: true,
	default: function SettingsView({ onDone }: { onDone: () => void }) {
		return (
			<div data-testid="settings-view" onClick={onDone}>
				Settings View
			</div>
		)
	},
}))

jest.mock("@src/components/history/HistoryView", () => ({
	__esModule: true,
	default: function HistoryView({ onDone }: { onDone: () => void }) {
		return (
			<div data-testid="history-view" onClick={onDone}>
				History View
			</div>
		)
	},
}))

jest.mock("@src/components/mcp/McpView", () => ({
	__esModule: true,
	default: function McpView({ onDone }: { onDone: () => void }) {
		return (
			<div data-testid="mcp-view" onClick={onDone}>
				MCP View
			</div>
		)
	},
}))

jest.mock("@src/components/modes/ModesView", () => ({
	__esModule: true,
	default: function ModesView({ onDone }: { onDone: () => void }) {
		return (
			<div data-testid="prompts-view" onClick={onDone}>
				Modes View
			</div>
		)
	},
}))

jest.mock("@src/components/marketplace/MarketplaceView", () => ({
	MarketplaceView: function MarketplaceView({ onDone }: { onDone: () => void }) {
		return (
			<div data-testid="marketplace-view" onClick={onDone}>
				Marketplace View
			</div>
		)
	},
}))

jest.mock("@src/components/account/AccountView", () => ({
	AccountView: function AccountView({ onDone }: { onDone: () => void }) {
		return (
			<div data-testid="account-view" onClick={onDone}>
				Account View
			</div>
		)
	},
}))

const mockUseExtensionState = jest.fn()

jest.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockUseExtensionState(),
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe("App", () => {
	beforeEach(() => {
		jest.clearAllMocks()
		window.removeEventListener("message", () => {})

		// Set up default mock return value
		mockUseExtensionState.mockReturnValue({
			didHydrateState: true,
			showWelcome: false,
			shouldShowAnnouncement: false,
			experiments: { marketplace: false },
			language: "en",
		})
	})

	afterEach(() => {
		cleanup()
		window.removeEventListener("message", () => {})
	})

	const triggerMessage = (action: string) => {
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "action",
				action,
			},
		})
		window.dispatchEvent(messageEvent)
	}

	it("shows chat view by default", () => {
		render(<AppWithProviders />)

		const chatView = screen.getByTestId("chat-view")
		expect(chatView).toBeInTheDocument()
		expect(chatView.getAttribute("data-hidden")).toBe("false")
	})

	it("switches to settings view when receiving settingsButtonClicked action", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("settingsButtonClicked")
		})

		const settingsView = await screen.findByTestId("settings-view")
		expect(settingsView).toBeInTheDocument()

		const chatView = screen.getByTestId("chat-view")
		expect(chatView.getAttribute("data-hidden")).toBe("true")
	})

	it("switches to history view when receiving historyButtonClicked action", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("historyButtonClicked")
		})

		const historyView = await screen.findByTestId("history-view")
		expect(historyView).toBeInTheDocument()

		const chatView = screen.getByTestId("chat-view")
		expect(chatView.getAttribute("data-hidden")).toBe("true")
	})

	it("switches to MCP view when receiving mcpButtonClicked action", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("mcpButtonClicked")
		})

		const mcpView = await screen.findByTestId("mcp-view")
		expect(mcpView).toBeInTheDocument()

		const chatView = screen.getByTestId("chat-view")
		expect(chatView.getAttribute("data-hidden")).toBe("true")
	})

	it("switches to prompts view when receiving promptsButtonClicked action", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("promptsButtonClicked")
		})

		const promptsView = await screen.findByTestId("prompts-view")
		expect(promptsView).toBeInTheDocument()

		const chatView = screen.getByTestId("chat-view")
		expect(chatView.getAttribute("data-hidden")).toBe("true")
	})

	it("returns to chat view when clicking done in settings view", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("settingsButtonClicked")
		})

		const settingsView = await screen.findByTestId("settings-view")

		act(() => {
			settingsView.click()
		})

		const chatView = screen.getByTestId("chat-view")
		expect(chatView.getAttribute("data-hidden")).toBe("false")
		expect(screen.queryByTestId("settings-view")).not.toBeInTheDocument()
	})

	it.each(["history", "mcp", "prompts"])("returns to chat view when clicking done in %s view", async (view) => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage(`${view}ButtonClicked`)
		})

		const viewElement = await screen.findByTestId(`${view}-view`)

		act(() => {
			viewElement.click()
		})

		const chatView = screen.getByTestId("chat-view")
		expect(chatView.getAttribute("data-hidden")).toBe("false")
		expect(screen.queryByTestId(`${view}-view`)).not.toBeInTheDocument()
	})

	describe("marketplace experiment", () => {
		it("does not switch to marketplace tab when experiment is disabled", async () => {
			mockUseExtensionState.mockReturnValue({
				didHydrateState: true,
				showWelcome: false,
				shouldShowAnnouncement: false,
				experiments: { marketplace: false },
				language: "en",
			})

			render(<AppWithProviders />)

			act(() => {
				triggerMessage("marketplaceButtonClicked")
			})

			// Should remain on chat view
			const chatView = screen.getByTestId("chat-view")
			expect(chatView.getAttribute("data-hidden")).toBe("false")
			expect(screen.queryByTestId("marketplace-view")).not.toBeInTheDocument()
		})

		it("switches to marketplace tab when experiment is enabled", async () => {
			mockUseExtensionState.mockReturnValue({
				didHydrateState: true,
				showWelcome: false,
				shouldShowAnnouncement: false,
				experiments: { marketplace: true },
				language: "en",
			})

			render(<AppWithProviders />)

			act(() => {
				triggerMessage("marketplaceButtonClicked")
			})

			const marketplaceView = await screen.findByTestId("marketplace-view")
			expect(marketplaceView).toBeInTheDocument()

			const chatView = screen.getByTestId("chat-view")
			expect(chatView.getAttribute("data-hidden")).toBe("true")
		})

		it("returns to chat view when clicking done in marketplace view", async () => {
			mockUseExtensionState.mockReturnValue({
				didHydrateState: true,
				showWelcome: false,
				shouldShowAnnouncement: false,
				experiments: { marketplace: true },
				language: "en",
			})

			render(<AppWithProviders />)

			act(() => {
				triggerMessage("marketplaceButtonClicked")
			})

			const marketplaceView = await screen.findByTestId("marketplace-view")

			act(() => {
				marketplaceView.click()
			})

			const chatView = screen.getByTestId("chat-view")
			expect(chatView.getAttribute("data-hidden")).toBe("false")
			expect(screen.queryByTestId("marketplace-view")).not.toBeInTheDocument()
		})
	})
})
