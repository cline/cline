/**
 * UserMessage – memo behavior test
 * --------------------------------------------------
 * Verifies the V12 方案1 memoization: the row must NOT re-render when only
 * the unstable `sendMessageFromChatRow` callback changes (it is never invoked
 * by UserMessage), and MUST re-render when the message content changes.
 *
 * Render detection: UserMessage renders `Thumbnails` whenever images/files are
 * present, so we mock Thumbnails with a render counter. A memo hit skips the
 * entire subtree (counter unchanged); a memo miss re-renders it (counter up).
 */

import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const thumbnailsRenderCount = { current: 0 }

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		editMessageAndRegenerate: vi.fn(),
	},
}))

vi.mock("@/components/common/Thumbnails", () => ({
	default: () => {
		thumbnailsRenderCount.current++
		return null
	},
}))

import UserMessage from "../UserMessage"

describe("UserMessage memoization (V12 方案1)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		thumbnailsRenderCount.current = 0
	})

	it("skips re-render when only sendMessageFromChatRow changes", () => {
		const { rerender } = render(<UserMessage files={[]} images={["a"]} messageTs={1} text="hello" />)
		const afterFirst = thumbnailsRenderCount.current
		expect(afterFirst).toBeGreaterThan(0)

		rerender(<UserMessage files={[]} images={["a"]} messageTs={1} sendMessageFromChatRow={() => {}} text="hello" />)

		expect(thumbnailsRenderCount.current).toBe(afterFirst)
	})

	it("re-renders when message text changes", () => {
		const { rerender } = render(<UserMessage files={[]} images={["a"]} messageTs={1} text="hello" />)
		const afterFirst = thumbnailsRenderCount.current

		rerender(<UserMessage files={[]} images={["a"]} messageTs={1} text="world" />)

		expect(screen.getByText("world")).toBeInTheDocument()
		expect(thumbnailsRenderCount.current).toBeGreaterThan(afterFirst)
	})

	it("re-renders when images content changes", () => {
		const { rerender } = render(<UserMessage files={[]} images={["a"]} messageTs={1} text="hello" />)
		const afterFirst = thumbnailsRenderCount.current

		rerender(<UserMessage files={[]} images={["b"]} messageTs={1} text="hello" />)

		expect(thumbnailsRenderCount.current).toBeGreaterThan(afterFirst)
	})

	it("skips re-render when identical props are passed as new object references", () => {
		const { rerender } = render(<UserMessage files={["f.ts"]} images={["a"]} messageTs={1} text="hello" />)
		const afterFirst = thumbnailsRenderCount.current

		// Same content, but freshly allocated arrays (reference change only).
		rerender(<UserMessage files={["f.ts"]} images={["a"]} messageTs={1} text="hello" />)

		expect(thumbnailsRenderCount.current).toBe(afterFirst)
	})
})
