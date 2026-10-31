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

	describe("streaming scroll ownership", () => {
		interface ScrollMetrics {
			scrollTop: number
			scrollHeight: number
			clientHeight: number
		}

		// jsdom has no layout engine, so scroll metrics must be mocked per element
		const mockScrollMetrics = (element: HTMLElement, metrics: ScrollMetrics) => {
			Object.defineProperty(element, "scrollTop", {
				configurable: true,
				get: () => metrics.scrollTop,
				set: (value: number) => {
					metrics.scrollTop = value
				},
			})
			Object.defineProperty(element, "scrollHeight", {
				configurable: true,
				get: () => metrics.scrollHeight,
			})
			Object.defineProperty(element, "clientHeight", {
				configurable: true,
				get: () => metrics.clientHeight,
			})
		}

		const renderRow = (reasoningContent: string) => (
			<ThinkingRow
				isExpanded={true}
				isStreaming={true}
				isVisible={true}
				reasoningContent={reasoningContent}
				showTitle={true}
			/>
		)

		it("stays pinned to the bottom when a new chunk arrives while the user is at the bottom", () => {
			const { rerender } = render(renderRow("chunk 1"))
			const scrollContainer = screen.getByText("chunk 1").parentElement as HTMLElement
			const metrics: ScrollMetrics = { clientHeight: 100, scrollHeight: 300, scrollTop: 200 }
			mockScrollMetrics(scrollContainer, metrics)

			metrics.scrollHeight = 400
			rerender(renderRow("chunk 1\nchunk 2"))

			expect(metrics.scrollTop).toBe(400)
		})

		it("stops forcing the scroll position after the user scrolls up, even as new chunks arrive", () => {
			const { rerender } = render(renderRow("chunk 1"))
			const scrollContainer = screen.getByText("chunk 1").parentElement as HTMLElement
			const metrics: ScrollMetrics = { clientHeight: 100, scrollHeight: 300, scrollTop: 200 }
			mockScrollMetrics(scrollContainer, metrics)

			// user scrolls away from the bottom to read earlier reasoning
			metrics.scrollTop = 0
			fireEvent.scroll(scrollContainer)

			metrics.scrollHeight = 400
			rerender(renderRow("chunk 1\nchunk 2"))

			expect(metrics.scrollTop).toBe(0)
		})

		it("resumes following the stream once the user scrolls back to the bottom", () => {
			const { rerender } = render(renderRow("chunk 1"))
			const scrollContainer = screen.getByText("chunk 1").parentElement as HTMLElement
			const metrics: ScrollMetrics = { clientHeight: 100, scrollHeight: 300, scrollTop: 200 }
			mockScrollMetrics(scrollContainer, metrics)

			// user scrolls up, then a new chunk must not move the viewport
			metrics.scrollTop = 0
			fireEvent.scroll(scrollContainer)
			metrics.scrollHeight = 400
			rerender(renderRow("chunk 1\nchunk 2"))
			expect(metrics.scrollTop).toBe(0)

			// user returns to the bottom, so streaming should follow again
			metrics.scrollTop = 300
			fireEvent.scroll(scrollContainer)
			metrics.scrollHeight = 500
			rerender(renderRow("chunk 1\nchunk 2\nchunk 3"))

			expect(metrics.scrollTop).toBe(500)
		})

		it("follows the stream by default without any user interaction", () => {
			const { rerender } = render(renderRow("chunk 1"))
			const scrollContainer = screen.getByText("chunk 1").parentElement as HTMLElement
			const metrics: ScrollMetrics = { clientHeight: 100, scrollHeight: 300, scrollTop: 0 }
			mockScrollMetrics(scrollContainer, metrics)

			metrics.scrollHeight = 400
			rerender(renderRow("chunk 1\nchunk 2"))

			expect(metrics.scrollTop).toBe(400)
		})

		it("still follows the stream when the user is within the bottom threshold", () => {
			const { rerender } = render(renderRow("chunk 1"))
			const scrollContainer = screen.getByText("chunk 1").parentElement as HTMLElement
			// 5px above the bottom stays within the pin threshold
			const metrics: ScrollMetrics = { clientHeight: 100, scrollHeight: 300, scrollTop: 295 }
			mockScrollMetrics(scrollContainer, metrics)

			fireEvent.scroll(scrollContainer)
			metrics.scrollHeight = 400
			rerender(renderRow("chunk 1\nchunk 2"))

			expect(metrics.scrollTop).toBe(400)
		})
	})
})
