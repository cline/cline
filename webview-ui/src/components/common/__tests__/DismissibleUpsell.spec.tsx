import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import DismissibleUpsell from "../DismissibleUpsell"
import { TelemetryEventName } from "@roo-code/types"

// Mock the vscode API
const mockPostMessage = vi.fn()
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (message: any) => mockPostMessage(message),
	},
}))

// Mock telemetryClient
const mockCapture = vi.fn()
vi.mock("@src/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: (eventName: string, properties?: Record<string, any>) => mockCapture(eventName, properties),
	},
}))

// Mock the translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"common:dismiss": "Dismiss",
				"common:dismissAndDontShowAgain": "Dismiss and don't show again",
			}
			return translations[key] || key
		},
	}),
}))

describe("DismissibleUpsell", () => {
	beforeEach(() => {
		mockPostMessage.mockClear()
		mockCapture.mockClear()
		vi.clearAllTimers()
	})

	afterEach(() => {
		vi.clearAllTimers()
	})

	// Helper function to make the component visible
	const makeUpsellVisible = () => {
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "dismissedUpsells",
				list: [], // Empty list means no upsells are dismissed
			},
		})
		window.dispatchEvent(messageEvent)
	}

	it("renders children content", async () => {
		render(
			<DismissibleUpsell upsellId="test-upsell">
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Component starts hidden, make it visible
		makeUpsellVisible()

		// Wait for component to become visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})
	})

	it("requests dismissed upsells list on mount", () => {
		render(
			<DismissibleUpsell upsellId="test-upsell">
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "getDismissedUpsells",
		})
	})

	it("hides the upsell when dismiss button is clicked and tracks telemetry", async () => {
		const onDismiss = vi.fn()
		const { container } = render(
			<DismissibleUpsell upsellId="test-upsell" onDismiss={onDismiss}>
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible first
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		// Find and click the dismiss button
		const dismissButton = screen.getByRole("button", { name: /dismiss/i })
		fireEvent.click(dismissButton)

		// Check that telemetry was tracked
		expect(mockCapture).toHaveBeenCalledWith(TelemetryEventName.UPSELL_DISMISSED, {
			upsellId: "test-upsell",
		})

		// Check that the dismiss message was sent BEFORE hiding
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "dismissUpsell",
			upsellId: "test-upsell",
		})

		// Check that the component is no longer visible
		await waitFor(() => {
			expect(container.firstChild).toBeNull()
		})

		// Check that the callback was called
		expect(onDismiss).toHaveBeenCalled()
	})

	it("hides the upsell if it's in the dismissed list", async () => {
		const { container } = render(
			<DismissibleUpsell upsellId="test-upsell">
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Component starts hidden by default
		expect(container.firstChild).toBeNull()

		// Simulate receiving a message that this upsell is dismissed
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "dismissedUpsells",
				list: ["test-upsell", "other-upsell"],
			},
		})
		window.dispatchEvent(messageEvent)

		// Check that the component remains hidden
		await waitFor(() => {
			expect(container.firstChild).toBeNull()
		})
	})

	it("remains visible if not in the dismissed list", async () => {
		render(
			<DismissibleUpsell upsellId="test-upsell">
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Simulate receiving a message that doesn't include this upsell
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "dismissedUpsells",
				list: ["other-upsell"],
			},
		})
		window.dispatchEvent(messageEvent)

		// Check that the component is still visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})
	})

	it("applies the className prop to the container", async () => {
		const { container } = render(
			<DismissibleUpsell upsellId="test-upsell" className="custom-class">
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(container.firstChild).not.toBeNull()
		})

		expect(container.firstChild).toHaveClass("custom-class")
	})

	it("dismiss button has proper accessibility attributes", async () => {
		render(
			<DismissibleUpsell upsellId="test-upsell">
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		const dismissButton = screen.getByRole("button", { name: /dismiss/i })
		expect(dismissButton).toHaveAttribute("aria-label", "Dismiss")
		expect(dismissButton).toHaveAttribute("title", "Dismiss and don't show again")
	})

	// New edge case tests
	it("handles multiple rapid dismissals of the same component", async () => {
		const onDismiss = vi.fn()
		render(
			<DismissibleUpsell upsellId="test-upsell" onDismiss={onDismiss}>
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		const dismissButton = screen.getByRole("button", { name: /dismiss/i })

		// Click multiple times rapidly
		fireEvent.click(dismissButton)
		fireEvent.click(dismissButton)
		fireEvent.click(dismissButton)

		// Should only send one message
		expect(mockPostMessage).toHaveBeenCalledTimes(2) // 1 for getDismissedUpsells, 1 for dismissUpsell
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "dismissUpsell",
			upsellId: "test-upsell",
		})

		// Callback should only be called once
		expect(onDismiss).toHaveBeenCalledTimes(1)
	})

	it("does not update state after component unmounts", async () => {
		const { unmount } = render(
			<DismissibleUpsell upsellId="test-upsell">
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Unmount the component
		unmount()

		// Simulate receiving a message after unmount
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "dismissedUpsells",
				list: ["test-upsell"],
			},
		})

		// This should not cause any errors
		act(() => {
			window.dispatchEvent(messageEvent)
		})

		// No errors should be thrown
		expect(true).toBe(true)
	})

	it("handles invalid/malformed messages gracefully", async () => {
		render(
			<DismissibleUpsell upsellId="test-upsell">
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// First make it visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		// Send various malformed messages
		const malformedMessages = [
			{ type: "dismissedUpsells", list: null },
			{ type: "dismissedUpsells", list: "not-an-array" },
			{ type: "dismissedUpsells" }, // missing list
			{ type: "wrongType", list: ["test-upsell"] },
			null,
			undefined,
			"string-message",
		]

		malformedMessages.forEach((data) => {
			const messageEvent = new MessageEvent("message", { data })
			window.dispatchEvent(messageEvent)
		})

		// Component should still be visible
		expect(screen.getByText("Test content")).toBeInTheDocument()
	})

	it("ensures message is sent before component unmounts on dismiss", async () => {
		const { unmount } = render(
			<DismissibleUpsell upsellId="test-upsell">
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		const dismissButton = screen.getByRole("button", { name: /dismiss/i })
		fireEvent.click(dismissButton)

		// Message should be sent immediately
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "dismissUpsell",
			upsellId: "test-upsell",
		})

		// Unmount immediately after clicking
		unmount()

		// Message was already sent before unmount
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "dismissUpsell",
			upsellId: "test-upsell",
		})
	})

	it("uses separate id and className props correctly", async () => {
		const { container } = render(
			<DismissibleUpsell upsellId="unique-id" className="styling-class">
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(container.firstChild).not.toBeNull()
		})

		// className should be applied to the container
		expect(container.firstChild).toHaveClass("styling-class")

		// When dismissed, should use the id, not className
		const dismissButton = screen.getByRole("button", { name: /dismiss/i })
		fireEvent.click(dismissButton)

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "dismissUpsell",
			upsellId: "unique-id",
		})
	})

	it("calls onClick when the container is clicked and tracks telemetry", async () => {
		const onClick = vi.fn()
		render(
			<DismissibleUpsell upsellId="test-upsell" onClick={onClick}>
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		// Click on the container (not the dismiss button)
		const container = screen.getByText("Test content").parentElement as HTMLElement
		fireEvent.click(container)

		expect(onClick).toHaveBeenCalledTimes(1)

		// Check that telemetry was tracked
		expect(mockCapture).toHaveBeenCalledWith(TelemetryEventName.UPSELL_CLICKED, {
			upsellId: "test-upsell",
		})
	})

	it("does not call onClick when dismiss button is clicked", async () => {
		const onClick = vi.fn()
		const onDismiss = vi.fn()
		render(
			<DismissibleUpsell upsellId="test-upsell" onClick={onClick} onDismiss={onDismiss}>
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		// Click the dismiss button
		const dismissButton = screen.getByRole("button", { name: /dismiss/i })
		fireEvent.click(dismissButton)

		// onClick should not be called, but onDismiss should
		expect(onClick).not.toHaveBeenCalled()
		expect(onDismiss).toHaveBeenCalledTimes(1)
	})

	it("adds cursor-pointer class when onClick is provided", async () => {
		const { container, rerender } = render(
			<DismissibleUpsell upsellId="test-upsell" onClick={() => {}}>
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(container.firstChild).not.toBeNull()
		})

		// Should have cursor-pointer when onClick is provided
		expect(container.firstChild).toHaveClass("cursor-pointer")

		// Re-render without onClick
		rerender(
			<DismissibleUpsell upsellId="test-upsell">
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Should not have cursor-pointer when onClick is not provided
		expect(container.firstChild).not.toHaveClass("cursor-pointer")
	})

	it("handles both onClick and onDismiss independently", async () => {
		const onClick = vi.fn()
		const onDismiss = vi.fn()
		const { container } = render(
			<DismissibleUpsell upsellId="test-upsell" onClick={onClick} onDismiss={onDismiss}>
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		// Click on the container
		const containerDiv = screen.getByText("Test content").parentElement as HTMLElement
		fireEvent.click(containerDiv)
		expect(onClick).toHaveBeenCalledTimes(1)
		expect(onDismiss).not.toHaveBeenCalled()

		// Reset mocks
		onClick.mockClear()
		onDismiss.mockClear()

		// Click the dismiss button
		const dismissButton = screen.getByRole("button", { name: /dismiss/i })
		fireEvent.click(dismissButton)

		// Only onDismiss should be called
		expect(onClick).not.toHaveBeenCalled()
		expect(onDismiss).toHaveBeenCalledTimes(1)

		// Component should be hidden after dismiss
		await waitFor(() => {
			expect(container.firstChild).toBeNull()
		})
	})

	it("dismisses when clicked if dismissOnClick is true and tracks both telemetry events", async () => {
		const onClick = vi.fn()
		const onDismiss = vi.fn()
		const { container } = render(
			<DismissibleUpsell upsellId="test-upsell" onClick={onClick} onDismiss={onDismiss} dismissOnClick={true}>
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		const containerDiv = screen.getByText("Test content").parentElement as HTMLElement
		fireEvent.click(containerDiv)

		expect(onClick).toHaveBeenCalledTimes(1)
		expect(onDismiss).toHaveBeenCalledTimes(1)

		// Check that both telemetry events were tracked
		expect(mockCapture).toHaveBeenCalledWith(TelemetryEventName.UPSELL_CLICKED, {
			upsellId: "test-upsell",
		})
		expect(mockCapture).toHaveBeenCalledWith(TelemetryEventName.UPSELL_DISMISSED, {
			upsellId: "test-upsell",
		})

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "dismissUpsell",
			upsellId: "test-upsell",
		})

		await waitFor(() => {
			expect(container.firstChild).toBeNull()
		})
	})

	it("dismisses on container click when dismissOnClick is true and no onClick is provided; tracks only dismissal", async () => {
		const onDismiss = vi.fn()
		const { container } = render(
			<DismissibleUpsell upsellId="test-upsell" onDismiss={onDismiss} dismissOnClick={true}>
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		// Click on the container (not the dismiss button)
		const containerDiv = screen.getByText("Test content").parentElement as HTMLElement
		fireEvent.click(containerDiv)

		// onDismiss should be called
		expect(onDismiss).toHaveBeenCalledTimes(1)

		// Telemetry: only dismissal should be tracked
		expect(mockCapture).toHaveBeenCalledWith(TelemetryEventName.UPSELL_DISMISSED, {
			upsellId: "test-upsell",
		})
		expect(mockCapture).not.toHaveBeenCalledWith(TelemetryEventName.UPSELL_CLICKED, expect.anything())

		// Dismiss message should be sent
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "dismissUpsell",
			upsellId: "test-upsell",
		})

		// Component should be hidden
		await waitFor(() => {
			expect(container.firstChild).toBeNull()
		})
	})
	it("does not dismiss when clicked if dismissOnClick is false", async () => {
		const onClick = vi.fn()
		const onDismiss = vi.fn()
		render(
			<DismissibleUpsell upsellId="test-upsell" onClick={onClick} onDismiss={onDismiss} dismissOnClick={false}>
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		const containerDiv = screen.getByText("Test content").parentElement as HTMLElement
		fireEvent.click(containerDiv)

		expect(onClick).toHaveBeenCalledTimes(1)
		expect(onDismiss).not.toHaveBeenCalled()

		expect(mockPostMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "dismissUpsell" }))
		expect(screen.getByText("Test content")).toBeInTheDocument()
	})

	it("does not dismiss when clicked if dismissOnClick is not provided (defaults to false)", async () => {
		const onClick = vi.fn()
		const onDismiss = vi.fn()
		render(
			<DismissibleUpsell upsellId="test-upsell" onClick={onClick} onDismiss={onDismiss}>
				<div>Test content</div>
			</DismissibleUpsell>,
		)

		// Make component visible
		makeUpsellVisible()

		// Wait for component to be visible
		await waitFor(() => {
			expect(screen.getByText("Test content")).toBeInTheDocument()
		})

		const containerDiv = screen.getByText("Test content").parentElement as HTMLElement
		fireEvent.click(containerDiv)

		expect(onClick).toHaveBeenCalledTimes(1)
		expect(onDismiss).not.toHaveBeenCalled()
		expect(screen.getByText("Test content")).toBeInTheDocument()
	})
})
