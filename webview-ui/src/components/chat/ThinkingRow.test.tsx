import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ThinkingRow } from "./ThinkingRow"

describe("ThinkingRow", () => {
	it("renders streaming title styling and expanded reasoning content", () => {
		render(
			<ThinkingRow
				isExpanded={true}
				isStreaming={true}
				isVisible={true}
				reasoningContent="Inspecting files..."
				showTitle={true}
				title="Thinking..."
			/>,
		)

		const title = screen.getByText("Thinking...")
		expect(title).toBeInTheDocument()
		expect(title).toHaveClass("animate-shimmer")
		expect(screen.getByText("Inspecting files...")).toBeInTheDocument()
	})

	it("allows expanded thinking content to preserve multiline formatting", () => {
		render(<ThinkingRow isExpanded={true} isVisible={true} reasoningContent={"Step 1\nStep 2"} showTitle={true} />)

		const reasoningContent = screen.getByText(/Step 1/, { selector: "span" })
		expect(reasoningContent).toBeInTheDocument()
		expect(reasoningContent.textContent).toBe("Step 1\nStep 2")
		expect(reasoningContent.closest("div")).toHaveClass("whitespace-pre-wrap")
		expect(reasoningContent.closest("button")).toHaveClass("whitespace-normal")
		expect(reasoningContent.closest("button")).not.toHaveClass("whitespace-nowrap")
	})

	it("calls onToggle when header is clicked", () => {
		const onToggle = vi.fn()

		render(
			<ThinkingRow
				isExpanded={false}
				isVisible={true}
				onToggle={onToggle}
				reasoningContent="some reasoning"
				showTitle={true}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Thinking/i }))
		expect(onToggle).toHaveBeenCalledTimes(1)
	})
})
