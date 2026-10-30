import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CommandOutputContent, CommandOutputRow } from "./CommandOutputRow"

vi.mock("../common/CodeBlock", () => ({
	default: ({ source }: { source: string }) => <pre>{source}</pre>,
}))

describe("CommandOutputContent", () => {
	it("notifies when visible output changes", async () => {
		const onOutputChange = vi.fn()
		const { rerender } = render(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output="first line"
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(1))

		rerender(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output={"first line\nsecond line"}
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(2))
	})

	it("notifies when visible output expansion changes", async () => {
		const onOutputChange = vi.fn()
		const { rerender } = render(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output={"1\n2\n3\n4\n5\n6"}
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(1))

		rerender(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={true}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output={"1\n2\n3\n4\n5\n6"}
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(2))
	})

	it("does not notify while the container is collapsed", async () => {
		const onOutputChange = vi.fn()
		render(
			<CommandOutputContent
				isContainerExpanded={false}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output="hidden"
			/>,
		)

		await act(async () => {})
		expect(onOutputChange).not.toHaveBeenCalled()
	})
})

describe("CommandOutputRow", () => {
	it("collapses the command without hiding its output", () => {
		const { container, getByLabelText } = render(
			<CommandOutputRow
				isCommandCompleted={true}
				isOutputFullyExpanded={false}
				message={{ text: "npm test\n\nOutput:\npassed", ts: 1, type: "ask", ask: "command" } as never}
				setIsOutputFullyExpanded={vi.fn()}
			/>,
		)

		expect(getByLabelText("Collapse command")).toBeInTheDocument()

		act(() => fireEvent.click(getByLabelText("Collapse command")))

		expect(getByLabelText("Expand command")).toBeInTheDocument()
		expect(container).toHaveTextContent("Completed")
	})
})
