import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import SearchResultsDisplay from "./SearchResultsDisplay"

describe("SearchResultsDisplay", () => {
	it("does not crash when approval asks have no result content yet", () => {
		const { container } = render(
			<SearchResultsDisplay content={undefined} isExpanded={false} onToggleExpand={vi.fn()} path={undefined} />,
		)

		expect(container).toBeEmptyDOMElement()
	})

	it("renders search result content when present", () => {
		render(<SearchResultsDisplay content="README.md: hello" isExpanded={false} onToggleExpand={vi.fn()} path="." />)

		expect(screen.getByRole("button", { name: "Expand code block" })).toBeInTheDocument()
	})

	it("does not render undefined when multi-workspace results have no path", () => {
		render(
			<SearchResultsDisplay
				content={`Found 1 result across 1 workspace.\n## Workspace: app\nREADME.md: hello`}
				isExpanded={false}
				onToggleExpand={vi.fn()}
				path={undefined}
			/>,
		)

		expect(screen.queryByText("undefined")).not.toBeInTheDocument()
	})
})
