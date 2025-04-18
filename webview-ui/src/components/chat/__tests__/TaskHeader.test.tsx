// npx jest src/components/chat/__tests__/TaskHeader.test.tsx

import React from "react"
import { render, screen } from "@testing-library/react"
import TaskHeader from "../TaskHeader"
import { ApiConfiguration } from "../../../../../src/shared/api"

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
jest.mock("../../../context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: {
			apiProvider: "anthropic",
			apiKey: "test-api-key", // Add relevant fields
			apiModelId: "claude-3-opus-20240229", // Add relevant fields
		} as ApiConfiguration, // Optional: Add type assertion if ApiConfiguration is imported
		currentTaskItem: null,
	}),
}))

describe("TaskHeader", () => {
	const defaultProps = {
		task: { text: "Test task", images: [] },
		tokensIn: 100,
		tokensOut: 50,
		doesModelSupportPromptCache: true,
		totalCost: 0.05,
		contextTokens: 200,
		onClose: jest.fn(),
	}

	it("should display cost when totalCost is greater than 0", () => {
		render(
			<TaskHeader
				{...defaultProps}
				task={{
					type: "say",
					ts: Date.now(),
					text: "Test task",
					images: [],
				}}
			/>,
		)
		expect(screen.getByText("$0.05")).toBeInTheDocument()
	})

	it("should not display cost when totalCost is 0", () => {
		render(
			<TaskHeader
				{...defaultProps}
				totalCost={0}
				task={{
					type: "say",
					ts: Date.now(),
					text: "Test task",
					images: [],
				}}
			/>,
		)
		expect(screen.queryByText("$0.0000")).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is null", () => {
		render(
			<TaskHeader
				{...defaultProps}
				totalCost={null as any}
				task={{
					type: "say",
					ts: Date.now(),
					text: "Test task",
					images: [],
				}}
			/>,
		)
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is undefined", () => {
		render(
			<TaskHeader
				{...defaultProps}
				totalCost={undefined as any}
				task={{
					type: "say",
					ts: Date.now(),
					text: "Test task",
					images: [],
				}}
			/>,
		)
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is NaN", () => {
		render(
			<TaskHeader
				{...defaultProps}
				totalCost={NaN}
				task={{
					type: "say",
					ts: Date.now(),
					text: "Test task",
					images: [],
				}}
			/>,
		)
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})
})
