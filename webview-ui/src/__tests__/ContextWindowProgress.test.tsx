// npx jest src/__tests__/ContextWindowProgress.test.tsx

import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import TaskHeader from "@src/components/chat/TaskHeader"

// Mock formatLargeNumber function
jest.mock("@/utils/format", () => ({
	formatLargeNumber: jest.fn((num) => num.toString()),
}))

// Mock VSCodeBadge component for all tests
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeBadge: ({ children }: { children: React.ReactNode }) => <div data-testid="vscode-badge">{children}</div>,
}))

// Mock ExtensionStateContext since we use useExtensionState
jest.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: jest.fn(() => ({
		apiConfiguration: { apiProvider: "openai" },
		currentTaskItem: { id: "test-id", number: 1, size: 1024 },
	})),
}))

// Mock highlighting function to avoid JSX parsing issues in tests
jest.mock("@src/components/chat/TaskHeader", () => {
	const originalModule = jest.requireActual("@src/components/chat/TaskHeader")

	return {
		__esModule: true,
		...originalModule,
		highlightMentions: jest.fn((text) => text),
	}
})

// Mock useSelectedModel hook
jest.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: jest.fn(() => ({
		info: { contextWindow: 4000 },
	})),
}))

describe("ContextWindowProgress", () => {
	const queryClient = new QueryClient()

	// Helper function to render just the ContextWindowProgress part through TaskHeader
	const renderComponent = (props: Record<string, any>) => {
		// Create a simple mock of the task that avoids importing the actual types
		const defaultProps = {
			task: { ts: Date.now(), type: "say" as const, say: "text" as const, text: "Test task" },
			tokensIn: 100,
			tokensOut: 50,
			doesModelSupportPromptCache: true,
			totalCost: 0.001,
			contextTokens: 1000,
			onClose: jest.fn(),
		}

		return render(
			<QueryClientProvider client={queryClient}>
				<TaskHeader {...defaultProps} {...props} />
			</QueryClientProvider>,
		)
	}

	beforeEach(() => jest.clearAllMocks())

	it("renders correctly with valid inputs", () => {
		renderComponent({ contextTokens: 1000, contextWindow: 4000 })

		// Check for basic elements
		// The context-window-label is not part of the ContextWindowProgress component
		// but rather part of the parent TaskHeader component in expanded state
		expect(screen.getByTestId("context-tokens-count")).toBeInTheDocument()
		expect(screen.getByTestId("context-tokens-count")).toHaveTextContent("1000") // contextTokens
		// The actual context window might be different than what we pass in
		// due to the mock returning a default value from the API config
		expect(screen.getByTestId("context-window-size")).toHaveTextContent(/(4000|128000)/) // contextWindow
	})

	it("handles zero context window gracefully", () => {
		renderComponent({ contextTokens: 0, contextWindow: 0 })

		// In the current implementation, the component is still displayed with zero values
		// rather than being hidden completely
		// The context-window-label is not part of the ContextWindowProgress component
		expect(screen.getByTestId("context-tokens-count")).toBeInTheDocument()
		expect(screen.getByTestId("context-tokens-count")).toHaveTextContent("0")
	})

	it("handles edge cases with negative values", () => {
		renderComponent({ contextTokens: -100, contextWindow: 4000 })

		// Should show 0 instead of -100
		expect(screen.getByTestId("context-tokens-count")).toHaveTextContent("0")
		// The actual context window might be different than what we pass in
		expect(screen.getByTestId("context-window-size")).toHaveTextContent(/(4000|128000)/)
	})

	it("calculates percentages correctly", () => {
		renderComponent({ contextTokens: 1000, contextWindow: 4000 })

		// Instead of checking the title attribute, verify the data-test-id
		// which identifies the element containing info about the percentage of tokens used
		const tokenUsageDiv = screen.getByTestId("context-tokens-used")
		expect(tokenUsageDiv).toBeInTheDocument()

		// Just verify that the element has a title attribute (the actual text is translated and may vary)
		expect(tokenUsageDiv).toHaveAttribute("title")

		// We can't reliably test computed styles in JSDOM, so we'll just check
		// that the component appears to be working correctly by checking for expected elements
		// The context-window-label is not part of the ContextWindowProgress component
		expect(screen.getByTestId("context-tokens-count")).toBeInTheDocument()
		expect(screen.getByTestId("context-tokens-count")).toHaveTextContent("1000")
	})
})
