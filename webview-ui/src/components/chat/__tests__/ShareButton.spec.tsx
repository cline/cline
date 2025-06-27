import { describe, test, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@/utils/test-utils"
import { ShareButton } from "../ShareButton"
import { useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"

// Mock the vscode utility
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock react-i18next
vi.mock("react-i18next")

// Mock the extension state context
vi.mock("@/context/ExtensionStateContext", () => ({
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => children,
	useExtensionState: () => ({
		sharingEnabled: true,
		cloudIsAuthenticated: true,
		cloudUserInfo: {
			id: "test-user",
			email: "test@example.com",
			organizationName: "Test Organization",
		},
	}),
}))

// Mock telemetry client
vi.mock("@/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: vi.fn(),
	},
}))

const mockUseTranslation = vi.mocked(useTranslation)
const mockVscode = vi.mocked(vscode)

describe("ShareButton", () => {
	const mockT = vi.fn((key: string) => key)
	const mockItem = {
		id: "test-task-id",
		number: 1,
		ts: Date.now(),
		task: "Test Task",
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.01,
	}

	beforeEach(() => {
		vi.clearAllMocks()

		mockUseTranslation.mockReturnValue({
			t: mockT,
			i18n: {} as any,
			ready: true,
		} as any)
	})

	test("renders share button", () => {
		render(<ShareButton item={mockItem} />)

		const button = screen.getByRole("button")
		expect(button).toBeInTheDocument()
	})

	test("opens popover when clicked", async () => {
		render(<ShareButton item={mockItem} />)

		const button = screen.getByRole("button")
		fireEvent.click(button)

		await waitFor(() => {
			expect(screen.getByText("chat:task.shareWithOrganization")).toBeInTheDocument()
		})
	})

	test("sends organization share message when organization button clicked", async () => {
		render(<ShareButton item={mockItem} />)

		// Open popover
		const button = screen.getByRole("button")
		fireEvent.click(button)

		await waitFor(() => {
			expect(screen.getByText("chat:task.shareWithOrganization")).toBeInTheDocument()
		})

		// Click organization share button
		const orgButton = screen.getByText("chat:task.shareWithOrganization")
		fireEvent.click(orgButton)

		expect(mockVscode.postMessage).toHaveBeenCalledWith({
			type: "shareCurrentTask",
			visibility: "organization",
		})
	})

	test("sends public share message when public button clicked", async () => {
		render(<ShareButton item={mockItem} />)

		// Open popover
		const button = screen.getByRole("button")
		fireEvent.click(button)

		await waitFor(() => {
			expect(screen.getByText("chat:task.sharePublicly")).toBeInTheDocument()
		})

		// Click public share button
		const publicButton = screen.getByText("chat:task.sharePublicly")
		fireEvent.click(publicButton)

		expect(mockVscode.postMessage).toHaveBeenCalledWith({
			type: "shareCurrentTask",
			visibility: "public",
		})
	})

	test("displays success message when shareTaskSuccess message received", async () => {
		const mockAddEventListener = vi.fn()
		const mockRemoveEventListener = vi.fn()

		// Mock window.addEventListener
		Object.defineProperty(window, "addEventListener", {
			value: mockAddEventListener,
			writable: true,
		})
		Object.defineProperty(window, "removeEventListener", {
			value: mockRemoveEventListener,
			writable: true,
		})

		render(<ShareButton item={mockItem} />)

		// Get the message event listener that was registered
		const messageListener = mockAddEventListener.mock.calls.find((call) => call[0] === "message")?.[1]

		expect(messageListener).toBeDefined()

		// Open popover first
		const button = screen.getByRole("button")
		fireEvent.click(button)

		await waitFor(() => {
			expect(screen.getByText("chat:task.shareWithOrganization")).toBeInTheDocument()
		})

		// Simulate receiving a shareTaskSuccess message
		const mockEvent = {
			data: {
				type: "shareTaskSuccess",
				visibility: "organization",
				text: "https://example.com/share/123",
			},
		}

		messageListener(mockEvent)

		await waitFor(() => {
			expect(screen.getByText("chat:task.shareSuccessOrganization")).toBeInTheDocument()
		})
	})

	test("displays different success messages based on visibility", async () => {
		const mockAddEventListener = vi.fn()

		Object.defineProperty(window, "addEventListener", {
			value: mockAddEventListener,
			writable: true,
		})

		render(<ShareButton item={mockItem} />)

		const messageListener = mockAddEventListener.mock.calls.find((call) => call[0] === "message")?.[1]

		// Open popover
		const button = screen.getByRole("button")
		fireEvent.click(button)

		await waitFor(() => {
			expect(screen.getByText("chat:task.shareWithOrganization")).toBeInTheDocument()
		})

		// Test public visibility success message
		const publicEvent = {
			data: {
				type: "shareTaskSuccess",
				visibility: "public",
				text: "https://example.com/share/456",
			},
		}

		messageListener(publicEvent)

		await waitFor(() => {
			expect(screen.getByText("chat:task.shareSuccessPublic")).toBeInTheDocument()
		})
	})

	test("auto-hides success message after 5 seconds", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })

		const mockAddEventListener = vi.fn()

		Object.defineProperty(window, "addEventListener", {
			value: mockAddEventListener,
			writable: true,
		})

		render(<ShareButton item={mockItem} />)

		const messageListener = mockAddEventListener.mock.calls.find((call) => call[0] === "message")?.[1]

		// Open popover
		const button = screen.getByRole("button")
		fireEvent.click(button)

		await vi.waitFor(() => {
			expect(screen.getByText("chat:task.shareWithOrganization")).toBeInTheDocument()
		})

		// Simulate success message
		const mockEvent = {
			data: {
				type: "shareTaskSuccess",
				visibility: "organization",
				text: "https://example.com/share/123",
			},
		}

		messageListener(mockEvent)

		await vi.waitFor(() => {
			expect(screen.getByText("chat:task.shareSuccessOrganization")).toBeInTheDocument()
		})

		// Fast-forward 5 seconds
		await vi.advanceTimersByTimeAsync(5000)

		// The success message and share options should both be gone (popover closed)
		expect(screen.queryByText("chat:task.shareSuccessOrganization")).not.toBeInTheDocument()
		expect(screen.queryByText("chat:task.shareWithOrganization")).not.toBeInTheDocument()

		vi.useRealTimers()
	})

	test("clears previous success state when sharing again", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })

		const mockAddEventListener = vi.fn()

		Object.defineProperty(window, "addEventListener", {
			value: mockAddEventListener,
			writable: true,
		})

		render(<ShareButton item={mockItem} />)

		const messageListener = mockAddEventListener.mock.calls.find((call) => call[0] === "message")?.[1]

		// Open popover
		const button = screen.getByRole("button")
		fireEvent.click(button)

		await vi.waitFor(() => {
			expect(screen.getByText("chat:task.shareWithOrganization")).toBeInTheDocument()
		})

		// Click organization share button first time
		const orgButton = screen.getByText("chat:task.shareWithOrganization")
		fireEvent.click(orgButton)

		// Verify first share message was sent
		expect(mockVscode.postMessage).toHaveBeenCalledWith({
			type: "shareCurrentTask",
			visibility: "organization",
		})

		// Clear mock to track new calls
		mockVscode.postMessage.mockClear()

		// Show success message
		const mockEvent = {
			data: {
				type: "shareTaskSuccess",
				visibility: "organization",
				text: "https://example.com/share/123",
			},
		}

		messageListener(mockEvent)

		await vi.waitFor(() => {
			expect(screen.getByText("chat:task.shareSuccessOrganization")).toBeInTheDocument()
		})

		// Wait for success message to auto-hide after 5 seconds
		await vi.advanceTimersByTimeAsync(5000)

		// Success message should be gone and popover should be closed
		expect(screen.queryByText("chat:task.shareSuccessOrganization")).not.toBeInTheDocument()

		// Open popover again
		fireEvent.click(button)
		await vi.waitFor(() => {
			expect(screen.getByText("chat:task.shareWithOrganization")).toBeInTheDocument()
		})

		// Click share again
		const orgButton2 = screen.getByText("chat:task.shareWithOrganization")
		fireEvent.click(orgButton2)

		// Verify the share message was sent again (no success message should be showing)
		expect(mockVscode.postMessage).toHaveBeenCalledWith({
			type: "shareCurrentTask",
			visibility: "organization",
		})

		vi.useRealTimers()
	})
})
