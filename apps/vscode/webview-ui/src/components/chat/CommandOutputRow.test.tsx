import { act, render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CommandOutputContent } from "./CommandOutputRow"

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

	it("keeps the scrollbar visible on the height-capped output container", () => {
		const { container } = render(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={false}
				onToggle={vi.fn()}
				output={"1\n2\n3\n4\n5\n6"}
			/>,
		)

		const scrollContainer = container.querySelector(".overflow-y-auto")
		expect(scrollContainer).not.toBeNull()
		expect(scrollContainer?.classList.contains("code-block-scrollable")).toBe(true)
		expect(scrollContainer?.classList.contains("max-h-[75px]")).toBe(true)
	})

	it("keeps the scrollbar visible once the output is fully expanded", () => {
		const { container } = render(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={true}
				onToggle={vi.fn()}
				output={"1\n2\n3\n4\n5\n6"}
			/>,
		)

		const scrollContainer = container.querySelector(".overflow-y-auto")
		expect(scrollContainer).not.toBeNull()
		expect(scrollContainer?.classList.contains("code-block-scrollable")).toBe(true)
		expect(scrollContainer?.classList.contains("max-h-[200px]")).toBe(true)
	})
})
