// npx jest src/components/chat/__tests__/CommandExecution.test.tsx

import React from "react"
import { render, screen } from "@testing-library/react"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"

import { CommandExecution } from "../CommandExecution"

jest.mock("@src/lib/utils", () => ({
	cn: (...inputs: any[]) => inputs.filter(Boolean).join(" "),
}))

jest.mock("lucide-react", () => ({
	ChevronDown: () => <div data-testid="chevron-down">ChevronDown</div>,
}))

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

describe("CommandExecution", () => {
	const renderComponent = (command: string, output: string) => {
		return render(
			<ExtensionStateContextProvider>
				<CommandExecution command={command} output={output} />
			</ExtensionStateContextProvider>,
		)
	}

	it("renders command output with virtualized list", () => {
		const testOutput = "Line 1\nLine 2\nLine 3"
		renderComponent("ls", testOutput)
		expect(screen.getByTestId("virtuoso-container")).toBeInTheDocument()
		expect(screen.getByText("Line 1")).toBeInTheDocument()
		expect(screen.getByText("Line 2")).toBeInTheDocument()
		expect(screen.getByText("Line 3")).toBeInTheDocument()
	})

	it("handles empty output", () => {
		renderComponent("ls", "")
		expect(screen.getByTestId("virtuoso-container")).toBeInTheDocument()
		expect(screen.getByTestId("virtuoso-item-0")).toBeInTheDocument()
		expect(screen.queryByTestId("virtuoso-item-1")).not.toBeInTheDocument()
	})

	it("handles large output", () => {
		const largeOutput = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`).join("\n")
		renderComponent("ls", largeOutput)
		expect(screen.getByTestId("virtuoso-container")).toBeInTheDocument()
		expect(screen.getByText("Line 1")).toBeInTheDocument()
		expect(screen.getByText("Line 1000")).toBeInTheDocument()
	})
})
