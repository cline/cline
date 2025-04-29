// npx jest src/components/chat/__tests__/CommandExecution.test.tsx

import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"

import { CommandExecution } from "../CommandExecution"

jest.mock("../../../components/common/CodeBlock")

jest.mock("@src/lib/utils", () => ({
	cn: (...inputs: any[]) => inputs.filter(Boolean).join(" "),
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
		const codeBlock = screen.getByTestId("mock-code-block")
		expect(codeBlock).toHaveTextContent("ls")

		fireEvent.click(screen.getByText("commandOutput"))
		const outputBlock = screen.getAllByTestId("mock-code-block")[1]

		expect(outputBlock).toHaveTextContent("Line 1")
		expect(outputBlock).toHaveTextContent("Line 2")
		expect(outputBlock).toHaveTextContent("Line 3")
	})

	it("handles empty output", () => {
		renderComponent("ls", "")
		const codeBlock = screen.getByTestId("mock-code-block")
		expect(codeBlock).toHaveTextContent("ls")
		expect(screen.queryByText("commandOutput")).not.toBeInTheDocument()
		expect(screen.queryAllByTestId("mock-code-block")).toHaveLength(1)
	})

	it("handles large output", () => {
		const largeOutput = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`).join("\n")
		renderComponent("ls", largeOutput)
		const codeBlock = screen.getByTestId("mock-code-block")
		expect(codeBlock).toHaveTextContent("ls")

		fireEvent.click(screen.getByText("commandOutput"))
		const outputBlock = screen.getAllByTestId("mock-code-block")[1]
		expect(outputBlock).toHaveTextContent("Line 1")
		expect(outputBlock).toHaveTextContent("Line 1000")
	})
})
