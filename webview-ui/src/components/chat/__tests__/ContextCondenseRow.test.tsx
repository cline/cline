import { render, screen, fireEvent } from "@testing-library/react"
import { ContextCondenseRow } from "../ContextCondenseRow"
import { ContextCondense } from "@roo/schemas"

// Mock the i18n hook
jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			// Return mock translations for the keys used in the component
			const translations: Record<string, string> = {
				"chat:contextCondense.title": "Context Condensed",
				"chat:contextCondense.conversationSummary": "Conversation Summary",
				tokens: "tokens",
			}
			return translations[key] || key
		},
	}),
}))

// Mock the VSCodeBadge component
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeBadge: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
		<div data-testid="vscode-badge" style={style}>
			{children}
		</div>
	),
}))

describe("ContextCondenseRow", () => {
	const defaultProps: ContextCondense = {
		cost: 0.05,
		prevContextTokens: 10000,
		newContextTokens: 5000,
		summary: "This is a test summary of the conversation.",
	}

	it("renders with correct token counts", () => {
		render(<ContextCondenseRow {...defaultProps} />)

		// Check if the component renders the title
		expect(screen.getByText("Context Condensed")).toBeInTheDocument()

		// Check if it displays the token counts correctly
		const tokenText = screen.getByText(/10,000 → 5,000 tokens/)
		expect(tokenText).toBeInTheDocument()
	})

	it("displays cost badge when cost is greater than 0", () => {
		render(<ContextCondenseRow {...defaultProps} />)

		const costBadge = screen.getByTestId("vscode-badge")
		expect(costBadge).toBeInTheDocument()
		expect(costBadge).toHaveTextContent("$0.05")
		expect(costBadge).not.toHaveStyle("opacity: 0")
	})

	it("hides cost badge when cost is 0", () => {
		render(<ContextCondenseRow {...defaultProps} cost={0} />)

		const costBadge = screen.getByTestId("vscode-badge")
		expect(costBadge).toBeInTheDocument()
		expect(costBadge).toHaveStyle("opacity: 0")
	})

	it("initially renders in collapsed state", () => {
		render(<ContextCondenseRow {...defaultProps} />)

		// Check if the chevron is pointing down (collapsed)
		expect(screen.getByText("", { selector: ".codicon-chevron-down" })).toBeInTheDocument()

		// Check that the summary is not visible
		expect(screen.queryByText("This is a test summary of the conversation.")).not.toBeInTheDocument()
	})

	it("expands when clicked", () => {
		render(<ContextCondenseRow {...defaultProps} />)

		// Click the row to expand it
		fireEvent.click(screen.getByText("Context Condensed"))

		// Check if the chevron is pointing up (expanded)
		expect(screen.getByText("", { selector: ".codicon-chevron-up" })).toBeInTheDocument()

		// Check if the summary is now visible
		expect(screen.getByText("This is a test summary of the conversation.")).toBeInTheDocument()
		expect(screen.getByText("Conversation Summary")).toBeInTheDocument()
	})

	it("collapses when clicked again", () => {
		render(<ContextCondenseRow {...defaultProps} />)

		// Click to expand
		fireEvent.click(screen.getByText("Context Condensed"))

		// Click again to collapse
		fireEvent.click(screen.getByText("Context Condensed"))

		// Check if the chevron is pointing down again (collapsed)
		expect(screen.getByText("", { selector: ".codicon-chevron-down" })).toBeInTheDocument()

		// Check that the summary is not visible again
		expect(screen.queryByText("This is a test summary of the conversation.")).not.toBeInTheDocument()
	})

	it("formats large token numbers with commas", () => {
		const props = {
			...defaultProps,
			prevContextTokens: 1234567,
			newContextTokens: 567890,
		}

		render(<ContextCondenseRow {...props} />)

		// Check if the numbers are formatted with commas
		const tokenText = screen.getByText(/1,234,567 → 567,890 tokens/)
		expect(tokenText).toBeInTheDocument()
	})

	it("formats cost to 2 decimal places", () => {
		const props = {
			...defaultProps,
			cost: 0.12345,
		}

		render(<ContextCondenseRow {...props} />)

		const costBadge = screen.getByTestId("vscode-badge")
		expect(costBadge).toHaveTextContent("$0.12")
	})
})
