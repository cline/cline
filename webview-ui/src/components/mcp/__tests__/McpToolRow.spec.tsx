import React from "react"
import { render, fireEvent, screen } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import McpToolRow from "../McpToolRow"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"mcp:tool.alwaysAllow": "Always allow",
				"mcp:tool.parameters": "Parameters",
				"mcp:tool.noDescription": "No description",
				"mcp:tool.togglePromptInclusion": "Toggle prompt inclusion",
			}
			return translations[key] || key
		},
	}),
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: function MockVSCodeCheckbox({
		children,
		checked,
		onChange,
	}: {
		children?: React.ReactNode
		checked?: boolean
		onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
	}) {
		return (
			<label>
				<input type="checkbox" checked={checked} onChange={onChange} />
				{children}
			</label>
		)
	},
}))

describe("McpToolRow", () => {
	const mockTool = {
		name: "test-tool",
		description: "A test tool",
		alwaysAllow: false,
		enabledForPrompt: true,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders tool name and description", () => {
		render(<McpToolRow tool={mockTool} />)

		expect(screen.getByText("test-tool")).toBeInTheDocument()
		expect(screen.getByText("A test tool")).toBeInTheDocument()
	})

	it("does not show always allow checkbox when serverName is not provided", () => {
		render(<McpToolRow tool={mockTool} />)

		expect(screen.queryByText("Always allow")).not.toBeInTheDocument()
	})

	it("shows always allow checkbox when serverName and alwaysAllowMcp are provided", () => {
		render(<McpToolRow tool={mockTool} serverName="test-server" alwaysAllowMcp={true} />)

		expect(screen.getByText("Always allow")).toBeInTheDocument()
	})

	it("sends message to toggle always allow when checkbox is clicked", () => {
		render(<McpToolRow tool={mockTool} serverName="test-server" alwaysAllowMcp={true} />)

		const checkbox = screen.getByRole("checkbox")
		fireEvent.click(checkbox)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "toggleToolAlwaysAllow",
			serverName: "test-server",
			toolName: "test-tool",
			alwaysAllow: true,
			source: "global",
		})
	})

	it("reflects always allow state in checkbox", () => {
		const alwaysAllowedTool = {
			...mockTool,
			alwaysAllow: true,
		}

		render(<McpToolRow tool={alwaysAllowedTool} serverName="test-server" alwaysAllowMcp={true} />)

		const checkbox = screen.getByRole("checkbox") as HTMLInputElement
		expect(checkbox.checked).toBe(true)
	})

	it("prevents event propagation when clicking the checkbox", () => {
		const mockOnClick = vi.fn()
		render(
			<div onClick={mockOnClick}>
				<McpToolRow tool={mockTool} serverName="test-server" alwaysAllowMcp={true} />
			</div>,
		)

		const container = screen.getByTestId("tool-row-container")
		fireEvent.click(container)

		expect(mockOnClick).not.toHaveBeenCalled()
	})

	it("displays input schema parameters when provided", () => {
		const toolWithSchema = {
			...mockTool,
			inputSchema: {
				type: "object",
				properties: {
					param1: {
						type: "string",
						description: "First parameter",
					},
					param2: {
						type: "number",
						description: "Second parameter",
					},
				},
				required: ["param1"],
			},
		}

		render(<McpToolRow tool={toolWithSchema} serverName="test-server" />)

		expect(screen.getByText("Parameters")).toBeInTheDocument()
		expect(screen.getByText("param1")).toBeInTheDocument()
		expect(screen.getByText("param2")).toBeInTheDocument()
		expect(screen.getByText("First parameter")).toBeInTheDocument()
		expect(screen.getByText("Second parameter")).toBeInTheDocument()
	})

	it("shows eye button when serverName is provided and not in chat context", () => {
		render(<McpToolRow tool={mockTool} serverName="test-server" />)

		const eyeButton = screen.getByRole("button", { name: "Toggle prompt inclusion" })
		expect(eyeButton).toBeInTheDocument()
	})

	it("hides eye button when isInChatContext is true", () => {
		render(<McpToolRow tool={mockTool} serverName="test-server" isInChatContext={true} />)

		const eyeButton = screen.queryByRole("button", { name: "Toggle prompt inclusion" })
		expect(eyeButton).not.toBeInTheDocument()
	})

	it("shows correct eye icon based on enabledForPrompt state", () => {
		// Test when enabled (should show eye-closed icon)
		const { rerender } = render(<McpToolRow tool={mockTool} serverName="test-server" />)

		let eyeIcon = screen.getByRole("button", { name: "Toggle prompt inclusion" }).querySelector("span")
		expect(eyeIcon).toHaveClass("codicon-eye-closed")

		// Test when disabled (should show eye icon)
		const disabledTool = { ...mockTool, enabledForPrompt: false }
		rerender(<McpToolRow tool={disabledTool} serverName="test-server" />)

		eyeIcon = screen.getByRole("button", { name: "Toggle prompt inclusion" }).querySelector("span")
		expect(eyeIcon).toHaveClass("codicon-eye")
	})

	it("sends message to toggle enabledForPrompt when eye button is clicked", () => {
		render(<McpToolRow tool={mockTool} serverName="test-server" />)

		const eyeButton = screen.getByRole("button", { name: "Toggle prompt inclusion" })
		fireEvent.click(eyeButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "toggleToolEnabledForPrompt",
			serverName: "test-server",
			source: "global",
			toolName: "test-tool",
			isEnabled: false,
		})
	})
})
