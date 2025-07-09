import React, { createContext, useContext } from "react"
import { render, screen, act } from "@testing-library/react"

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { FollowUpSuggest } from "../FollowUpSuggest"
import { TooltipProvider } from "@radix-ui/react-tooltip"

// Mock the translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	TranslationProvider: ({ children }: { children: React.ReactNode }) => children,
	useAppTranslation: () => ({
		t: (key: string, options?: any) => {
			if (key === "chat:followUpSuggest.countdownDisplay" && options?.count !== undefined) {
				return `${options.count}s`
			}
			if (key === "chat:followUpSuggest.autoSelectCountdown" && options?.count !== undefined) {
				return `Auto-selecting in ${options.count} seconds`
			}
			if (key === "chat:followUpSuggest.copyToInput") {
				return "Copy to input"
			}
			return key
		},
	}),
}))

// Test-specific extension state context that only provides the values needed by FollowUpSuggest
interface TestExtensionState {
	autoApprovalEnabled: boolean
	alwaysAllowFollowupQuestions: boolean
	followupAutoApproveTimeoutMs: number
}

const TestExtensionStateContext = createContext<TestExtensionState | undefined>(undefined)

// Mock the useExtensionState hook to use our test context
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => {
		const context = useContext(TestExtensionStateContext)
		if (!context) {
			throw new Error("useExtensionState must be used within TestExtensionStateProvider")
		}
		return context
	},
}))

// Test provider that only provides the specific values needed by FollowUpSuggest
const TestExtensionStateProvider: React.FC<{
	children: React.ReactNode
	value: TestExtensionState
}> = ({ children, value }) => {
	return <TestExtensionStateContext.Provider value={value}>{children}</TestExtensionStateContext.Provider>
}

// Helper function to render component with test providers
const renderWithTestProviders = (component: React.ReactElement, extensionState: TestExtensionState) => {
	return render(
		<TestExtensionStateProvider value={extensionState}>
			<TooltipProvider>{component}</TooltipProvider>
		</TestExtensionStateProvider>,
	)
}

describe("FollowUpSuggest", () => {
	const mockSuggestions = [{ answer: "First suggestion" }, { answer: "Second suggestion" }]

	const mockOnSuggestionClick = vi.fn()
	const mockOnCancelAutoApproval = vi.fn()

	// Default test state with auto-approval enabled
	const defaultTestState: TestExtensionState = {
		autoApprovalEnabled: true,
		alwaysAllowFollowupQuestions: true,
		followupAutoApproveTimeoutMs: 3000, // 3 seconds for testing
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("should display countdown timer when auto-approval is enabled", () => {
		renderWithTestProviders(
			<FollowUpSuggest
				suggestions={mockSuggestions}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
			/>,
			defaultTestState,
		)

		// Should show initial countdown (3 seconds)
		expect(screen.getByText(/3s/)).toBeInTheDocument()
	})

	it("should not display countdown timer when isAnswered is true", () => {
		renderWithTestProviders(
			<FollowUpSuggest
				suggestions={mockSuggestions}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
				isAnswered={true}
			/>,
			defaultTestState,
		)

		// Should not show countdown
		expect(screen.queryByText(/\d+s/)).not.toBeInTheDocument()
	})

	it("should clear interval and call onCancelAutoApproval when component unmounts", () => {
		const { unmount } = renderWithTestProviders(
			<FollowUpSuggest
				suggestions={mockSuggestions}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
			/>,
			defaultTestState,
		)

		// Unmount the component
		unmount()

		// onCancelAutoApproval should have been called
		expect(mockOnCancelAutoApproval).toHaveBeenCalled()
	})

	it("should not show countdown when auto-approval is disabled", () => {
		const testState: TestExtensionState = {
			...defaultTestState,
			autoApprovalEnabled: false,
		}

		renderWithTestProviders(
			<FollowUpSuggest
				suggestions={mockSuggestions}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
			/>,
			testState,
		)

		// Should not show countdown
		expect(screen.queryByText(/\d+s/)).not.toBeInTheDocument()
	})

	it("should not show countdown when alwaysAllowFollowupQuestions is false", () => {
		const testState: TestExtensionState = {
			...defaultTestState,
			alwaysAllowFollowupQuestions: false,
		}

		renderWithTestProviders(
			<FollowUpSuggest
				suggestions={mockSuggestions}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
			/>,
			testState,
		)

		// Should not show countdown
		expect(screen.queryByText(/\d+s/)).not.toBeInTheDocument()
	})

	it("should use custom timeout value from extension state", () => {
		const testState: TestExtensionState = {
			...defaultTestState,
			followupAutoApproveTimeoutMs: 5000, // 5 seconds
		}

		renderWithTestProviders(
			<FollowUpSuggest
				suggestions={mockSuggestions}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
			/>,
			testState,
		)

		// Should show initial countdown (5 seconds)
		expect(screen.getByText(/5s/)).toBeInTheDocument()
	})

	it("should render suggestions without countdown when both auto-approval settings are disabled", () => {
		const testState: TestExtensionState = {
			autoApprovalEnabled: false,
			alwaysAllowFollowupQuestions: false,
			followupAutoApproveTimeoutMs: 3000,
		}

		renderWithTestProviders(
			<FollowUpSuggest
				suggestions={mockSuggestions}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
			/>,
			testState,
		)

		// Should render suggestions
		expect(screen.getByText("First suggestion")).toBeInTheDocument()
		expect(screen.getByText("Second suggestion")).toBeInTheDocument()

		// Should not show countdown
		expect(screen.queryByText(/\d+s/)).not.toBeInTheDocument()
	})

	it("should not render when no suggestions are provided", () => {
		const { container } = renderWithTestProviders(
			<FollowUpSuggest
				suggestions={[]}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
			/>,
			defaultTestState,
		)

		// Component should not render anything
		expect(container.firstChild).toBeNull()
	})

	it("should not render when onSuggestionClick is not provided", () => {
		const { container } = renderWithTestProviders(
			<FollowUpSuggest suggestions={mockSuggestions} ts={123} onCancelAutoApproval={mockOnCancelAutoApproval} />,
			defaultTestState,
		)

		// Component should not render anything
		expect(container.firstChild).toBeNull()
	})

	it("should stop countdown when user manually responds (isAnswered becomes true)", () => {
		const { rerender } = renderWithTestProviders(
			<FollowUpSuggest
				suggestions={mockSuggestions}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
				isAnswered={false}
			/>,
			defaultTestState,
		)

		// Initially should show countdown
		expect(screen.getByText(/3s/)).toBeInTheDocument()

		// Simulate user manually responding by setting isAnswered to true
		rerender(
			<TestExtensionStateProvider value={defaultTestState}>
				<TooltipProvider>
					<FollowUpSuggest
						suggestions={mockSuggestions}
						onSuggestionClick={mockOnSuggestionClick}
						ts={123}
						onCancelAutoApproval={mockOnCancelAutoApproval}
						isAnswered={true}
					/>
				</TooltipProvider>
			</TestExtensionStateProvider>,
		)

		// Countdown should no longer be visible immediately after isAnswered becomes true
		expect(screen.queryByText(/\d+s/)).not.toBeInTheDocument()

		// Advance timer to ensure countdown doesn't restart or continue
		vi.advanceTimersByTime(5000)

		// onSuggestionClick should not have been called (auto-selection stopped)
		expect(mockOnSuggestionClick).not.toHaveBeenCalled()

		// Countdown should still not be visible
		expect(screen.queryByText(/\d+s/)).not.toBeInTheDocument()

		// Verify onCancelAutoApproval was called when the countdown was stopped
		expect(mockOnCancelAutoApproval).toHaveBeenCalled()
	})

	it("should handle race condition when timeout fires but user has already responded", () => {
		// This test simulates the scenario where:
		// 1. Auto-approval countdown starts
		// 2. User manually responds (isAnswered becomes true)
		// 3. The timeout still fires (because it was already scheduled)
		// 4. The auto-selection should NOT happen because user already responded

		const { rerender } = renderWithTestProviders(
			<FollowUpSuggest
				suggestions={mockSuggestions}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
				isAnswered={false}
			/>,
			defaultTestState,
		)

		// Initially should show countdown
		expect(screen.getByText(/3s/)).toBeInTheDocument()

		// Advance timer to just before timeout completes (2.5 seconds)
		vi.advanceTimersByTime(2500)

		// User manually responds before timeout completes
		rerender(
			<TestExtensionStateProvider value={defaultTestState}>
				<TooltipProvider>
					<FollowUpSuggest
						suggestions={mockSuggestions}
						onSuggestionClick={mockOnSuggestionClick}
						ts={123}
						onCancelAutoApproval={mockOnCancelAutoApproval}
						isAnswered={true}
					/>
				</TooltipProvider>
			</TestExtensionStateProvider>,
		)

		// Countdown should be hidden immediately
		expect(screen.queryByText(/\d+s/)).not.toBeInTheDocument()

		// Now advance timer past the original timeout duration
		vi.advanceTimersByTime(1000) // Total: 3.5 seconds

		// onSuggestionClick should NOT have been called
		// This verifies the fix for the race condition
		expect(mockOnSuggestionClick).not.toHaveBeenCalled()
	})

	it("should update countdown display as time progresses", async () => {
		renderWithTestProviders(
			<FollowUpSuggest
				suggestions={mockSuggestions}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
				isAnswered={false}
			/>,
			defaultTestState,
		)

		// Initially should show 3s
		expect(screen.getByText(/3s/)).toBeInTheDocument()

		// Advance timer by 1 second and wait for React to update
		await act(async () => {
			vi.advanceTimersByTime(1000)
		})

		// Check countdown updated to 2s
		expect(screen.getByText(/2s/)).toBeInTheDocument()

		// Advance timer by another second
		await act(async () => {
			vi.advanceTimersByTime(1000)
		})

		// Check countdown updated to 1s
		expect(screen.getByText(/1s/)).toBeInTheDocument()

		// Advance timer to completion - countdown should disappear
		await act(async () => {
			vi.advanceTimersByTime(1000)
		})

		// Countdown should no longer be visible after reaching 0
		expect(screen.queryByText(/\d+s/)).not.toBeInTheDocument()

		// The component itself doesn't trigger auto-selection, that's handled by ChatView
		expect(mockOnSuggestionClick).not.toHaveBeenCalled()
	})

	it("should handle component unmounting during countdown", () => {
		const { unmount } = renderWithTestProviders(
			<FollowUpSuggest
				suggestions={mockSuggestions}
				onSuggestionClick={mockOnSuggestionClick}
				ts={123}
				onCancelAutoApproval={mockOnCancelAutoApproval}
				isAnswered={false}
			/>,
			defaultTestState,
		)

		// Initially should show countdown
		expect(screen.getByText(/3s/)).toBeInTheDocument()

		// Advance timer partially
		vi.advanceTimersByTime(1500)

		// Unmount component before countdown completes
		unmount()

		// onCancelAutoApproval should have been called
		expect(mockOnCancelAutoApproval).toHaveBeenCalled()

		// Advance timer past the original timeout
		vi.advanceTimersByTime(2000)

		// onSuggestionClick should NOT have been called (component doesn't auto-select)
		expect(mockOnSuggestionClick).not.toHaveBeenCalled()
	})
})
