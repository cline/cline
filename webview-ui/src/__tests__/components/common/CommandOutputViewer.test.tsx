import React from "react"
import { render, screen } from "@testing-library/react"
import CommandOutputViewer from "../../../components/common/CommandOutputViewer"

// Mock the cn utility function
jest.mock("../../../lib/utils", () => ({
	cn: (...inputs: any[]) => inputs.filter(Boolean).join(" "),
}))

// Mock the Virtuoso component
jest.mock("react-virtuoso", () => ({
	Virtuoso: React.forwardRef(({ totalCount, itemContent }: any, ref: any) => (
		<div ref={ref} data-testid="virtuoso-container">
			{Array.from({ length: totalCount }).map((_, index) => (
				<div key={index} data-testid={`virtuoso-item-${index}`}>
					{itemContent(index)}
				</div>
			))}
		</div>
	)),
	VirtuosoHandle: jest.fn(),
}))

describe("CommandOutputViewer", () => {
	it("renders command output with virtualized list", () => {
		const testOutput = "Line 1\nLine 2\nLine 3"

		render(<CommandOutputViewer output={testOutput} />)

		// Check if Virtuoso container is rendered
		expect(screen.getByTestId("virtuoso-container")).toBeInTheDocument()

		// Check if all lines are rendered
		expect(screen.getByText("Line 1")).toBeInTheDocument()
		expect(screen.getByText("Line 2")).toBeInTheDocument()
		expect(screen.getByText("Line 3")).toBeInTheDocument()
	})

	it("handles empty output", () => {
		render(<CommandOutputViewer output="" />)

		// Should still render the container but with no items
		expect(screen.getByTestId("virtuoso-container")).toBeInTheDocument()

		// No virtuoso items should be rendered for empty string (which creates one empty line)
		expect(screen.getByTestId("virtuoso-item-0")).toBeInTheDocument()
		expect(screen.queryByTestId("virtuoso-item-1")).not.toBeInTheDocument()
	})

	it("handles large output", () => {
		// Create a large output with 1000 lines
		const largeOutput = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`).join("\n")

		render(<CommandOutputViewer output={largeOutput} />)

		// Check if Virtuoso container is rendered
		expect(screen.getByTestId("virtuoso-container")).toBeInTheDocument()

		// Check if first and last lines are rendered
		expect(screen.getByText("Line 1")).toBeInTheDocument()
		expect(screen.getByText("Line 1000")).toBeInTheDocument()
	})
})
