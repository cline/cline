import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import * as vscode from "vscode"
import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

// Mock vscode with all required exports
vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
	},
	workspace: {
		workspaceFolders: [],
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
			update: vi.fn(),
		})),
	},
	Uri: {
		parse: vi.fn((str: string) => ({ fsPath: str })),
		file: vi.fn((str: string) => ({ fsPath: str })),
	},
	commands: {
		executeCommand: vi.fn(),
	},
	env: {
		openExternal: vi.fn(),
		clipboard: {
			writeText: vi.fn(),
		},
	},
}))

// Create AuthenticationError class for testing
class AuthenticationError extends Error {
	constructor(message = "Authentication required") {
		super(message)
		this.name = "AuthenticationError"
	}
}

// Mock CloudService with a factory function to allow resetting
const createMockCloudService = () => {
	let instance: any = null
	return {
		hasInstance: vi.fn(() => !!instance),
		instance: null as any,
		setInstance: (newInstance: any) => {
			instance = newInstance
			return instance
		},
		getInstance: () => instance,
	}
}

let mockCloudService = createMockCloudService()

// Mock CloudService
vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		get hasInstance() {
			return mockCloudService.hasInstance
		},
		get instance() {
			return mockCloudService.getInstance()
		},
	},
}))

// Mock i18n
vi.mock("../../../i18n", () => ({
	t: (key: string) => key,
	changeLanguage: vi.fn(),
}))

// Mock other dependencies that might be imported
vi.mock("../../task-persistence", () => ({
	saveTaskMessages: vi.fn(),
}))

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(),
}))

vi.mock("../../../shared/package", () => ({
	Package: {
		name: "test-package",
	},
}))

vi.mock("../../../shared/api", () => ({
	toRouterName: vi.fn((name: string) => name),
}))

vi.mock("../../../shared/experiments", () => ({
	experimentDefault: {},
}))

vi.mock("../../../shared/modes", () => ({
	defaultModeSlug: "code",
}))

vi.mock("../generateSystemPrompt", () => ({
	generateSystemPrompt: vi.fn(),
}))

vi.mock("../messageEnhancer", () => ({
	MessageEnhancer: {
		enhanceMessage: vi.fn(),
		captureTelemetry: vi.fn(),
	},
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn(() => false),
		instance: null,
	},
	TelemetryEventName: {},
}))

describe("webviewMessageHandler - getCloudAgents", () => {
	let mockProvider: Partial<ClineProvider>
	let postMessageToWebview: Mock
	let log: Mock

	beforeEach(() => {
		vi.clearAllMocks()
		// Reset CloudService mock for each test
		mockCloudService = createMockCloudService()

		postMessageToWebview = vi.fn()
		log = vi.fn()

		mockProvider = {
			postMessageToWebview,
			log,
			// Add other required provider properties as needed
		}
	})

	it("should handle CloudService not initialized", async () => {
		// CloudService.hasInstance will return false because instance is null

		await webviewMessageHandler(mockProvider as ClineProvider, { type: "getCloudAgents" })

		expect(log).toHaveBeenCalledWith("[getCloudAgents] CloudService not initialized")
		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "cloudAgents",
			agents: [],
			error: "CloudService not initialized",
		})
	})

	it("should handle CloudAPI not available", async () => {
		// Set instance with null cloudAPI
		mockCloudService.setInstance({
			cloudAPI: null,
		})

		await webviewMessageHandler(mockProvider as ClineProvider, { type: "getCloudAgents" })

		expect(log).toHaveBeenCalledWith("[getCloudAgents] CloudAPI not available")
		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "cloudAgents",
			agents: [],
			error: "CloudAPI not available",
		})
	})

	it("should successfully fetch cloud agents", async () => {
		const mockAgents = [
			{ id: "1", name: "Agent 1", type: "code", icon: "code" },
			{ id: "2", name: "Agent 2", type: "chat", icon: "chat" },
		]

		const mockCloudAPI = {
			getCloudAgents: vi.fn().mockResolvedValue(mockAgents),
		}

		// Set instance with mock cloudAPI
		mockCloudService.setInstance({
			cloudAPI: mockCloudAPI,
		})

		await webviewMessageHandler(mockProvider as ClineProvider, { type: "getCloudAgents" })

		expect(log).toHaveBeenCalledWith("[getCloudAgents] Fetching cloud agents")
		expect(log).toHaveBeenCalledWith("[getCloudAgents] Fetched 2 cloud agents")
		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "cloudAgents",
			agents: mockAgents,
		})
	})

	it("should handle authentication errors silently", async () => {
		const authError = new AuthenticationError("Authentication required")

		const mockCloudAPI = {
			getCloudAgents: vi.fn().mockRejectedValue(authError),
		}

		// Set instance with mock cloudAPI
		mockCloudService.setInstance({
			cloudAPI: mockCloudAPI,
		})

		await webviewMessageHandler(mockProvider as ClineProvider, { type: "getCloudAgents" })

		expect(log).toHaveBeenCalledWith("[getCloudAgents] Error fetching cloud agents: Authentication required")
		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "cloudAgents",
			agents: [],
			error: "Authentication required",
		})
		// Should NOT show error message - handled silently
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
	})

	it("should handle general errors without showing auth message", async () => {
		const genericError = new Error("Network error")

		const mockCloudAPI = {
			getCloudAgents: vi.fn().mockRejectedValue(genericError),
		}

		// Set instance with mock cloudAPI
		mockCloudService.setInstance({
			cloudAPI: mockCloudAPI,
		})

		await webviewMessageHandler(mockProvider as ClineProvider, { type: "getCloudAgents" })

		expect(log).toHaveBeenCalledWith("[getCloudAgents] Error fetching cloud agents: Network error")
		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "cloudAgents",
			agents: [],
			error: "Network error",
		})
		// Should NOT show auth error message for general errors
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
	})

	it("should handle 401 errors silently", async () => {
		const error401 = new Error("HTTP 401: Unauthorized")

		const mockCloudAPI = {
			getCloudAgents: vi.fn().mockRejectedValue(error401),
		}

		// Set instance with mock cloudAPI
		mockCloudService.setInstance({
			cloudAPI: mockCloudAPI,
		})

		await webviewMessageHandler(mockProvider as ClineProvider, { type: "getCloudAgents" })

		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "cloudAgents",
			agents: [],
			error: "HTTP 401: Unauthorized",
		})
		// Should NOT show error message - handled silently
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
	})
})
