import React from "react"
import { render, screen, fireEvent, waitFor, act } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import { IndexingStatusBadge } from "../IndexingStatusBadge"

vi.mock("@/i18n/setup", () => ({
	__esModule: true,
	default: {
		use: vi.fn().mockReturnThis(),
		init: vi.fn().mockReturnThis(),
		addResourceBundle: vi.fn(),
		language: "en",
		changeLanguage: vi.fn(),
	},
	loadTranslations: vi.fn(),
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: any) => {
			const translations: Record<string, string> = {
				"indexingStatus.ready": "Index ready",
				"indexingStatus.indexing": params?.progress !== undefined ? `Indexing ${params.progress}%` : "Indexing",
				"indexingStatus.error": "Index error",
				"indexingStatus.indexed": "Indexed",
				"indexingStatus.tooltip.ready": "The codebase index is ready for use",
				"indexingStatus.tooltip.indexing":
					params?.progress !== undefined
						? `Indexing in progress: ${params.progress}% complete`
						: "Indexing in progress",
				"indexingStatus.tooltip.error": "An error occurred during indexing",
				"indexingStatus.tooltip.indexed": "Codebase has been successfully indexed",
				"indexingStatus.tooltip.clickToSettings": "Click to open indexing settings",
			}
			return translations[key] || key
		},
		i18n: {
			language: "en",
			changeLanguage: vi.fn(),
		},
	}),
	initReactI18next: {
		type: "3rdParty",
		init: vi.fn(),
	},
	Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock the useTooltip hook
vi.mock("@/hooks/useTooltip", () => ({
	useTooltip: vi.fn(() => ({
		showTooltip: false,
		handleMouseEnter: vi.fn(),
		handleMouseLeave: vi.fn(),
		cleanup: vi.fn(),
	})),
}))

// Mock the ExtensionStateContext
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		version: "1.0.0",
		clineMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		language: "en",
	}),
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock TranslationContext to provide t function directly
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, params?: any) => {
			// Remove namespace prefix if present
			const cleanKey = key.includes(":") ? key.split(":")[1] : key

			const translations: Record<string, string> = {
				"indexingStatus.ready": "Index ready",
				"indexingStatus.indexing":
					params?.percentage !== undefined ? `Indexing ${params.percentage}%` : "Indexing",
				"indexingStatus.error": "Index error",
				"indexingStatus.indexed": "Indexed",
				"indexingStatus.tooltip.ready": "The codebase index is ready for use",
				"indexingStatus.tooltip.indexing":
					params?.percentage !== undefined
						? `Indexing in progress: ${params.percentage}% complete`
						: "Indexing in progress",
				"indexingStatus.tooltip.error": "An error occurred during indexing",
				"indexingStatus.tooltip.indexed": "Codebase has been successfully indexed",
				"indexingStatus.tooltip.clickToSettings": "Click to open indexing settings",
			}
			return translations[cleanKey] || cleanKey
		},
	}),
}))

describe("IndexingStatusBadge", () => {
	const renderComponent = (props = {}) => {
		return render(<IndexingStatusBadge {...props} />)
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the status dot", () => {
		renderComponent()
		const button = screen.getByRole("button")
		expect(button).toBeInTheDocument()
	})

	it("shows standby status by default", () => {
		renderComponent()
		const button = screen.getByRole("button")
		expect(button).toHaveAttribute("aria-label", "Index ready")
	})

	it("opens popover when clicked", () => {
		// Mock window.postMessage
		const postMessageSpy = vi.spyOn(window, "postMessage")

		renderComponent()

		const button = screen.getByRole("button")
		fireEvent.click(button)

		// The button should be clickable and not post a message anymore
		// Since the popover is rendered conditionally, we just verify the button is clickable
		// and doesn't throw any errors. The actual popover rendering is tested in integration tests.
		expect(postMessageSpy).not.toHaveBeenCalled()

		postMessageSpy.mockRestore()
	})

	it("requests indexing status on mount", () => {
		renderComponent()

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "requestIndexingStatus",
		})
	})

	it("updates status when receiving indexingStatusUpdate message", async () => {
		renderComponent()

		// Simulate receiving an indexing status update
		const event = new MessageEvent("message", {
			data: {
				type: "indexingStatusUpdate",
				values: {
					systemStatus: "Indexing",
					processedItems: 50,
					totalItems: 100,
					currentItemUnit: "files",
				},
			},
		})

		act(() => {
			window.dispatchEvent(event)
		})

		await waitFor(() => {
			const button = screen.getByRole("button")
			expect(button).toHaveAttribute("aria-label", "Indexing 50%")
		})
	})

	it("shows error status correctly", async () => {
		renderComponent()

		// Simulate error status
		const event = new MessageEvent("message", {
			data: {
				type: "indexingStatusUpdate",
				values: {
					systemStatus: "Error",
					processedItems: 0,
					totalItems: 0,
					currentItemUnit: "files",
				},
			},
		})

		act(() => {
			window.dispatchEvent(event)
		})

		await waitFor(() => {
			const button = screen.getByRole("button")
			expect(button).toHaveAttribute("aria-label", "Index error")
		})
	})

	it("shows indexed status correctly", async () => {
		renderComponent()

		// Simulate indexed status
		const event = new MessageEvent("message", {
			data: {
				type: "indexingStatusUpdate",
				values: {
					systemStatus: "Indexed",
					processedItems: 100,
					totalItems: 100,
					currentItemUnit: "files",
				},
			},
		})

		act(() => {
			window.dispatchEvent(event)
		})

		await waitFor(() => {
			const button = screen.getByRole("button")
			expect(button).toHaveAttribute("aria-label", "Indexed")
		})
	})

	it("cleans up event listener on unmount", () => {
		const { unmount } = renderComponent()
		const removeEventListenerSpy = vi.spyOn(window, "removeEventListener")

		unmount()

		expect(removeEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function))
	})

	it("calculates progress percentage correctly", async () => {
		renderComponent()

		// Test various progress scenarios
		const testCases = [
			{ processed: 0, total: 100, expected: 0 },
			{ processed: 25, total: 100, expected: 25 },
			{ processed: 33, total: 100, expected: 33 },
			{ processed: 100, total: 100, expected: 100 },
			{ processed: 0, total: 0, expected: 0 },
		]

		for (const testCase of testCases) {
			const event = new MessageEvent("message", {
				data: {
					type: "indexingStatusUpdate",
					values: {
						systemStatus: "Indexing",
						processedItems: testCase.processed,
						totalItems: testCase.total,
						currentItemUnit: "files",
					},
				},
			})

			act(() => {
				window.dispatchEvent(event)
			})

			await waitFor(() => {
				const button = screen.getByRole("button")
				expect(button).toHaveAttribute("aria-label", `Indexing ${testCase.expected}%`)
			})
		}
	})
})
