import React from "react"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import CloudAgents from "../CloudAgents"
import type { CloudAgent } from "@roo-code/types"

const MOCK_AGENTS: CloudAgent[] = [
	{
		id: "agent1",
		name: "Code Assistant",
		type: "assistant",
		icon: "assistant",
	},
	{
		id: "agent2",
		name: "Test Agent",
		type: "test",
		icon: "test",
	},
]

// Mock vscode postMessage
const mockPostMessage = vi.fn()
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: (message: any) => mockPostMessage(message),
	},
}))

// Mock useExtensionState
const mockCloudIsAuthenticated = vi.fn()
const mockCloudUserInfo = vi.fn()
const mockCloudApiUrl = vi.fn()

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		cloudIsAuthenticated: mockCloudIsAuthenticated(),
		cloudUserInfo: mockCloudUserInfo(),
		cloudApiUrl: mockCloudApiUrl(),
	}),
}))

// Helper function to simulate message from extension
const simulateExtensionMessage = (data: any) => {
	const event = new MessageEvent("message", { data })
	window.dispatchEvent(event)
}

describe("CloudAgents", () => {
	beforeEach(() => {
		mockPostMessage.mockClear()
		// Set default mocked values
		mockCloudIsAuthenticated.mockReturnValue(true)
		mockCloudUserInfo.mockReturnValue({ organizationId: "org123" })
		mockCloudApiUrl.mockReturnValue("https://api.test.com")
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("should not render when not authenticated", () => {
		mockCloudIsAuthenticated.mockReturnValue(false)
		const { container } = render(<CloudAgents />)

		// Component should render nothing when not authenticated
		expect(container.firstChild).toBeNull()
		expect(mockPostMessage).not.toHaveBeenCalled()
	})

	it("should request cloud agents on mount when authenticated", async () => {
		render(<CloudAgents />)

		// Should request cloud agents from extension
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "getCloudAgents" })

		// Simulate response from extension
		simulateExtensionMessage({
			type: "cloudAgents",
			agents: MOCK_AGENTS,
		})

		// Wait for the component to render agents
		await waitFor(() => {
			expect(screen.getByText("chat:cloudAgents.title")).toBeInTheDocument()
			expect(screen.getByText("Code Assistant")).toBeInTheDocument()
			expect(screen.getByText("Test Agent")).toBeInTheDocument()
		})
	})

	it("should handle agent click and open correct URL", async () => {
		render(<CloudAgents />)

		// Simulate response from extension
		simulateExtensionMessage({
			type: "cloudAgents",
			agents: MOCK_AGENTS,
		})

		await waitFor(() => {
			expect(screen.getByText("Code Assistant")).toBeInTheDocument()
		})

		const agentElement = screen.getByText("Code Assistant").closest("div.cursor-pointer")
		fireEvent.click(agentElement!)

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "openExternal",
			url: "https://api.test.com/cloud-agents/agent1/run",
		})
	})

	it("should handle create button click", async () => {
		render(<CloudAgents />)

		// Simulate response from extension with agents
		simulateExtensionMessage({
			type: "cloudAgents",
			agents: MOCK_AGENTS,
		})

		await waitFor(() => {
			expect(screen.getByText("chat:cloudAgents.title")).toBeInTheDocument()
			expect(screen.getByText("Code Assistant")).toBeInTheDocument()
			expect(screen.getByText("Test Agent")).toBeInTheDocument()
		})

		const createButton = screen.getByTitle("chat:cloudAgents.create")
		fireEvent.click(createButton)

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "openExternal",
			url: "https://api.test.com/cloud-agents/create",
		})
	})

	it("should show empty state when no agents and handle create button", async () => {
		render(<CloudAgents />)

		// Simulate response from extension with empty agents
		simulateExtensionMessage({
			type: "cloudAgents",
			agents: [],
		})

		await waitFor(() => {
			expect(screen.getByText("chat:cloudAgents.createFirst")).toBeInTheDocument()
		})

		// Find and click the "Create your first" button in the empty state
		const createFirstButton = screen.getByText("chat:cloudAgents.createFirst")
		fireEvent.click(createFirstButton)

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "openExternal",
			url: "https://api.test.com/cloud-agents/create",
		})
	})

	it("should handle error gracefully and show nothing", async () => {
		render(<CloudAgents />)

		// Simulate error response from extension
		simulateExtensionMessage({
			type: "cloudAgents",
			error: "Failed to fetch agents",
			agents: [],
		})

		// Wait for the component to process the error
		await waitFor(() => {
			// Component should render nothing on error
			expect(screen.queryByText("chat:cloudAgents.title")).not.toBeInTheDocument()
		})
	})

	it("should not render anything while loading", () => {
		const { container } = render(<CloudAgents />)

		// Before receiving the message response, component should render nothing
		expect(container.firstChild).toBeNull()
		expect(screen.queryByText("Cloud Agents")).not.toBeInTheDocument()
	})

	it("should re-fetch agents when organization changes", async () => {
		const { rerender } = render(<CloudAgents />)

		expect(mockPostMessage).toHaveBeenCalledTimes(1)
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "getCloudAgents" })

		// Clear previous calls
		mockPostMessage.mockClear()

		// Change organization
		mockCloudUserInfo.mockReturnValue({ organizationId: "org456" })
		rerender(<CloudAgents />)

		// Should request agents again with new org
		expect(mockPostMessage).toHaveBeenCalledTimes(1)
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "getCloudAgents" })
	})

	it("should properly clean up message listener on unmount", () => {
		const removeEventListenerSpy = vi.spyOn(window, "removeEventListener")

		const { unmount } = render(<CloudAgents />)

		unmount()

		expect(removeEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function))

		removeEventListenerSpy.mockRestore()
	})
})
