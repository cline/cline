// npx jest src/components/chat/__tests__/TaskHeader.test.tsx

import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { ProviderSettings } from "@roo-code/types"

import TaskHeader, { TaskHeaderProps } from "../TaskHeader"

// Mock i18n
jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key, // Simple mock that returns the key
	}),
	// Mock initReactI18next to prevent initialization errors in tests
	initReactI18next: {
		type: "3rdParty",
		init: jest.fn(),
	},
}))

// Mock the vscode API
jest.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))

// Mock the VSCodeBadge component
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeBadge: ({ children }: { children: React.ReactNode }) => <div data-testid="vscode-badge">{children}</div>,
}))

// Mock the ExtensionStateContext
jest.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: {
			apiProvider: "anthropic",
			apiKey: "test-api-key", // Add relevant fields
			apiModelId: "claude-3-opus-20240229", // Add relevant fields
		} as ProviderSettings, // Optional: Add type assertion if ProviderSettings is imported
		currentTaskItem: { id: "test-task-id" },
	}),
}))

describe("TaskHeader", () => {
	const defaultProps: TaskHeaderProps = {
		task: { type: "say", ts: Date.now(), text: "Test task", images: [] },
		tokensIn: 100,
		tokensOut: 50,
		doesModelSupportPromptCache: true,
		totalCost: 0.05,
		contextTokens: 200,
		buttonsDisabled: false,
		handleCondenseContext: jest.fn(),
		onClose: jest.fn(),
	}

	const queryClient = new QueryClient()

	const renderTaskHeader = (props: Partial<TaskHeaderProps> = {}) => {
		return render(
			<QueryClientProvider client={queryClient}>
				<TaskHeader {...defaultProps} {...props} />
			</QueryClientProvider>,
		)
	}

	it("should display cost when totalCost is greater than 0", () => {
		renderTaskHeader()
		expect(screen.getByText("$0.05")).toBeInTheDocument()
	})

	it("should not display cost when totalCost is 0", () => {
		renderTaskHeader({ totalCost: 0 })
		expect(screen.queryByText("$0.0000")).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is null", () => {
		renderTaskHeader({ totalCost: null as any })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is undefined", () => {
		renderTaskHeader({ totalCost: undefined as any })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is NaN", () => {
		renderTaskHeader({ totalCost: NaN })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should render the condense context button", () => {
		renderTaskHeader()
		expect(screen.getByTitle("chat:task.condenseContext")).toBeInTheDocument()
	})

	it("should call handleCondenseContext when condense context button is clicked", () => {
		const handleCondenseContext = jest.fn()
		renderTaskHeader({ handleCondenseContext })
		const condenseButton = screen.getByTitle("chat:task.condenseContext")
		fireEvent.click(condenseButton)
		expect(handleCondenseContext).toHaveBeenCalledWith("test-task-id")
	})

	it("should disable the condense context button when buttonsDisabled is true", () => {
		const handleCondenseContext = jest.fn()
		renderTaskHeader({ buttonsDisabled: true, handleCondenseContext })
		const condenseButton = screen.getByTitle("chat:task.condenseContext")
		fireEvent.click(condenseButton)
		expect(handleCondenseContext).not.toHaveBeenCalled()
	})
})
