// npx jest core/webview/__tests__/ClineProvider.test.ts

import Anthropic from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import axios from "axios"

import { type ProviderSettingsEntry, type ClineMessage, ORGANIZATION_ALLOW_ALL } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { ExtensionMessage, ExtensionState } from "../../../shared/ExtensionMessage"
import { defaultModeSlug } from "../../../shared/modes"
import { experimentDefault } from "../../../shared/experiments"
import { setTtsEnabled } from "../../../utils/tts"
import { ContextProxy } from "../../config/ContextProxy"
import { Task, TaskOptions } from "../../task/Task"

import { ClineProvider } from "../ClineProvider"

// Mock setup must come before imports
jest.mock("../../prompts/sections/custom-instructions")

jest.mock("vscode")

jest.mock("delay")

jest.mock("p-wait-for", () => ({
	__esModule: true,
	default: jest.fn().mockResolvedValue(undefined),
}))

jest.mock("fs/promises", () => ({
	mkdir: jest.fn(),
	writeFile: jest.fn(),
	readFile: jest.fn(),
	unlink: jest.fn(),
	rmdir: jest.fn(),
}))

jest.mock("axios", () => ({
	get: jest.fn().mockResolvedValue({ data: { data: [] } }),
	post: jest.fn(),
}))

jest.mock(
	"@modelcontextprotocol/sdk/types.js",
	() => ({
		CallToolResultSchema: {},
		ListResourcesResultSchema: {},
		ListResourceTemplatesResultSchema: {},
		ListToolsResultSchema: {},
		ReadResourceResultSchema: {},
		ErrorCode: {
			InvalidRequest: "InvalidRequest",
			MethodNotFound: "MethodNotFound",
			InternalError: "InternalError",
		},
		McpError: class McpError extends Error {
			code: string
			constructor(code: string, message: string) {
				super(message)
				this.code = code
				this.name = "McpError"
			}
		},
	}),
	{ virtual: true },
)

jest.mock("../../../services/browser/BrowserSession", () => ({
	BrowserSession: jest.fn().mockImplementation(() => ({
		testConnection: jest.fn().mockImplementation(async (url) => {
			if (url === "http://localhost:9222") {
				return {
					success: true,
					message: "Successfully connected to Chrome",
					endpoint: "ws://localhost:9222/devtools/browser/123",
				}
			} else {
				return {
					success: false,
					message: "Failed to connect to Chrome",
					endpoint: undefined,
				}
			}
		}),
	})),
}))

jest.mock("../../../services/browser/browserDiscovery", () => ({
	discoverChromeHostUrl: jest.fn().mockImplementation(async () => {
		return "http://localhost:9222"
	}),
	tryChromeHostUrl: jest.fn().mockImplementation(async (url) => {
		return url === "http://localhost:9222"
	}),
}))

const mockAddCustomInstructions = jest.fn().mockResolvedValue("Combined instructions")

;(jest.requireMock("../../prompts/sections/custom-instructions") as any).addCustomInstructions =
	mockAddCustomInstructions

jest.mock("delay", () => {
	const delayFn = (_ms: number) => Promise.resolve()
	delayFn.createDelay = () => delayFn
	delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
	delayFn.range = () => Promise.resolve()
	return delayFn
})

// MCP-related modules are mocked once above (lines 87-109).

jest.mock(
	"@modelcontextprotocol/sdk/client/index.js",
	() => ({
		Client: jest.fn().mockImplementation(() => ({
			connect: jest.fn().mockResolvedValue(undefined),
			close: jest.fn().mockResolvedValue(undefined),
			listTools: jest.fn().mockResolvedValue({ tools: [] }),
			callTool: jest.fn().mockResolvedValue({ content: [] }),
		})),
	}),
	{ virtual: true },
)

jest.mock(
	"@modelcontextprotocol/sdk/client/stdio.js",
	() => ({
		StdioClientTransport: jest.fn().mockImplementation(() => ({
			connect: jest.fn().mockResolvedValue(undefined),
			close: jest.fn().mockResolvedValue(undefined),
		})),
	}),
	{ virtual: true },
)

jest.mock("vscode", () => ({
	ExtensionContext: jest.fn(),
	OutputChannel: jest.fn(),
	WebviewView: jest.fn(),
	Uri: {
		joinPath: jest.fn(),
		file: jest.fn(),
	},
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	window: {
		showInformationMessage: jest.fn(),
		showErrorMessage: jest.fn(),
	},
	workspace: {
		getConfiguration: jest.fn().mockReturnValue({
			get: jest.fn().mockReturnValue([]),
			update: jest.fn(),
		}),
		onDidChangeConfiguration: jest.fn().mockImplementation(() => ({
			dispose: jest.fn(),
		})),
		onDidSaveTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		onDidOpenTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		onDidCloseTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
}))

jest.mock("../../../utils/tts", () => ({
	setTtsEnabled: jest.fn(),
	setTtsSpeed: jest.fn(),
}))

jest.mock("../../../api", () => ({
	buildApiHandler: jest.fn(),
}))

jest.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: jest.fn().mockImplementation(async () => "mocked system prompt"),
	codeMode: "code",
}))

jest.mock("../../../integrations/workspace/WorkspaceTracker", () => {
	return jest.fn().mockImplementation(() => ({
		initializeFilePaths: jest.fn(),
		dispose: jest.fn(),
	}))
})

jest.mock("../../task/Task", () => ({
	Task: jest
		.fn()
		.mockImplementation(
			(_provider, _apiConfiguration, _customInstructions, _diffEnabled, _fuzzyMatchThreshold, _task, taskId) => ({
				api: undefined,
				abortTask: jest.fn(),
				handleWebviewAskResponse: jest.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				overwriteClineMessages: jest.fn(),
				overwriteApiConversationHistory: jest.fn(),
				getTaskNumber: jest.fn().mockReturnValue(0),
				setTaskNumber: jest.fn(),
				setParentTask: jest.fn(),
				setRootTask: jest.fn(),
				taskId: taskId || "test-task-id",
			}),
		),
}))

jest.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: jest.fn().mockImplementation(async (_filePath: string) => {
		const content = "const x = 1;\nconst y = 2;\nconst z = 3;"
		const lines = content.split("\n")
		return lines.map((line, index) => `${index + 1} | ${line}`).join("\n")
	}),
}))

afterAll(() => {
	jest.restoreAllMocks()
})

describe("ClineProvider", () => {
	let defaultTaskOptions: TaskOptions

	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: jest.Mock
	let updateGlobalStateSpy: jest.SpyInstance<ClineProvider["contextProxy"]["updateGlobalState"]>

	beforeEach(() => {
		jest.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		const globalState: Record<string, string | undefined> = {
			mode: "architect",
			currentApiConfigName: "current-config",
		}

		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: jest.fn().mockImplementation((key: string) => globalState[key]),
				update: jest
					.fn()
					.mockImplementation((key: string, value: string | undefined) => (globalState[key] = value)),
				keys: jest.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: jest.fn().mockImplementation((key: string) => secrets[key]),
				store: jest.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: jest.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		// Mock CustomModesManager
		const mockCustomModesManager = {
			updateCustomMode: jest.fn().mockResolvedValue(undefined),
			getCustomModes: jest.fn().mockResolvedValue([]),
			dispose: jest.fn(),
		}

		// Mock output channel
		mockOutputChannel = {
			appendLine: jest.fn(),
			clear: jest.fn(),
			dispose: jest.fn(),
		} as unknown as vscode.OutputChannel

		// Mock webview
		mockPostMessage = jest.fn()

		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: jest.fn(),
				asWebviewUri: jest.fn(),
			},
			visible: true,
			onDidDispose: jest.fn().mockImplementation((callback) => {
				callback()
				return { dispose: jest.fn() }
			}),
			onDidChangeVisibility: jest.fn().mockImplementation(() => ({ dispose: jest.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		defaultTaskOptions = {
			provider,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
		}

		// @ts-ignore - Access private property for testing
		updateGlobalStateSpy = jest.spyOn(provider.contextProxy, "setValue")

		// @ts-ignore - Accessing private property for testing.
		provider.customModesManager = mockCustomModesManager
	})

	test("constructor initializes correctly", () => {
		expect(provider).toBeInstanceOf(ClineProvider)
		// Since getVisibleInstance returns the last instance where view.visible is true
		// @ts-ignore - accessing private property for testing
		provider.view = mockWebviewView
		expect(ClineProvider.getVisibleInstance()).toBe(provider)
	})

	test("resolveWebviewView sets up webview correctly", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		expect(mockWebviewView.webview.options).toEqual({
			enableScripts: true,
			localResourceRoots: [mockContext.extensionUri],
		})

		expect(mockWebviewView.webview.html).toContain("<!DOCTYPE html>")
	})

	test("resolveWebviewView sets up webview correctly in development mode even if local server is not running", async () => {
		provider = new ClineProvider(
			{ ...mockContext, extensionMode: vscode.ExtensionMode.Development },
			mockOutputChannel,
			"sidebar",
			new ContextProxy(mockContext),
		)
		;(axios.get as jest.Mock).mockRejectedValueOnce(new Error("Network error"))

		await provider.resolveWebviewView(mockWebviewView)

		expect(mockWebviewView.webview.options).toEqual({
			enableScripts: true,
			localResourceRoots: [mockContext.extensionUri],
		})

		expect(mockWebviewView.webview.html).toContain("<!DOCTYPE html>")

		// Verify Content Security Policy contains the necessary PostHog domains
		expect(mockWebviewView.webview.html).toContain(
			"connect-src https://openrouter.ai https://api.requesty.ai https://us.i.posthog.com https://us-assets.i.posthog.com",
		)

		// Extract the script-src directive section and verify required security elements
		const html = mockWebviewView.webview.html
		const scriptSrcMatch = html.match(/script-src[^;]*;/)
		expect(scriptSrcMatch).not.toBeNull()
		expect(scriptSrcMatch![0]).toContain("'nonce-")
		// Verify wasm-unsafe-eval is present for Shiki syntax highlighting
		expect(scriptSrcMatch![0]).toContain("'wasm-unsafe-eval'")
	})

	test("postMessageToWebview sends message to webview", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		const mockState: ExtensionState = {
			version: "1.0.0",
			clineMessages: [],
			taskHistory: [],
			shouldShowAnnouncement: false,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
			customInstructions: undefined,
			alwaysAllowReadOnly: false,
			alwaysAllowReadOnlyOutsideWorkspace: false,
			alwaysAllowWrite: false,
			codebaseIndexConfig: {
				codebaseIndexEnabled: false,
				codebaseIndexQdrantUrl: "",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexEmbedderModelId: "",
			},
			alwaysAllowWriteOutsideWorkspace: false,
			alwaysAllowExecute: false,
			alwaysAllowBrowser: false,
			alwaysAllowMcp: false,
			uriScheme: "vscode",
			soundEnabled: false,
			ttsEnabled: false,
			diffEnabled: false,
			enableCheckpoints: false,
			writeDelayMs: 1000,
			browserViewportSize: "900x600",
			fuzzyMatchThreshold: 1.0,
			mcpEnabled: true,
			enableMcpServerCreation: false,
			requestDelaySeconds: 5,
			mode: defaultModeSlug,
			customModes: [],
			experiments: experimentDefault,
			maxOpenTabsContext: 20,
			maxWorkspaceFiles: 200,
			browserToolEnabled: true,
			telemetrySetting: "unset",
			showRooIgnoredFiles: true,
			renderContext: "sidebar",
			maxReadFileLine: 500,
			cloudUserInfo: null,
			organizationAllowList: ORGANIZATION_ALLOW_ALL,
			autoCondenseContext: true,
			autoCondenseContextPercent: 100,
		}

		const message: ExtensionMessage = {
			type: "state",
			state: mockState,
		}
		await provider.postMessageToWebview(message)

		expect(mockPostMessage).toHaveBeenCalledWith(message)
	})

	test("handles webviewDidLaunch message", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Get the message handler from onDidReceiveMessage
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Simulate webviewDidLaunch message
		await messageHandler({ type: "webviewDidLaunch" })

		// Should post state and theme to webview
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("clearTask aborts current task", async () => {
		// Setup Cline instance with auto-mock from the top of the file
		const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance

		// add the mock object to the stack
		await provider.addClineToStack(mockCline)

		// get the stack size before the abort call
		const stackSizeBeforeAbort = provider.getClineStackSize()

		// call the removeClineFromStack method so it will call the current cline abort and remove it from the stack
		await provider.removeClineFromStack()

		// get the stack size after the abort call
		const stackSizeAfterAbort = provider.getClineStackSize()

		// check if the abort method was called
		expect(mockCline.abortTask).toHaveBeenCalled()

		// check if the stack size was decreased
		expect(stackSizeBeforeAbort - stackSizeAfterAbort).toBe(1)
	})

	test("addClineToStack adds multiple Cline instances to the stack", async () => {
		// Setup Cline instance with auto-mock from the top of the file
		const mockCline1 = new Task(defaultTaskOptions) // Create a new mocked instance
		const mockCline2 = new Task(defaultTaskOptions) // Create a new mocked instance
		Object.defineProperty(mockCline1, "taskId", { value: "test-task-id-1", writable: true })
		Object.defineProperty(mockCline2, "taskId", { value: "test-task-id-2", writable: true })

		// add Cline instances to the stack
		await provider.addClineToStack(mockCline1)
		await provider.addClineToStack(mockCline2)

		// verify cline instances were added to the stack
		expect(provider.getClineStackSize()).toBe(2)

		// verify current cline instance is the last one added
		expect(provider.getCurrentCline()).toBe(mockCline2)
	})

	test("getState returns correct initial state", async () => {
		const state = await provider.getState()

		expect(state).toHaveProperty("apiConfiguration")
		expect(state.apiConfiguration).toHaveProperty("apiProvider")
		expect(state).toHaveProperty("customInstructions")
		expect(state).toHaveProperty("alwaysAllowReadOnly")
		expect(state).toHaveProperty("alwaysAllowWrite")
		expect(state).toHaveProperty("alwaysAllowExecute")
		expect(state).toHaveProperty("alwaysAllowBrowser")
		expect(state).toHaveProperty("taskHistory")
		expect(state).toHaveProperty("soundEnabled")
		expect(state).toHaveProperty("ttsEnabled")
		expect(state).toHaveProperty("diffEnabled")
		expect(state).toHaveProperty("writeDelayMs")
	})

	test("language is set to VSCode language", async () => {
		// Mock VSCode language as Spanish
		;(vscode.env as any).language = "pt-BR"

		const state = await provider.getState()
		expect(state.language).toBe("pt-BR")
	})

	test("diffEnabled defaults to true when not set", async () => {
		// Mock globalState.get to return undefined for diffEnabled
		;(mockContext.globalState.get as jest.Mock).mockReturnValue(undefined)

		const state = await provider.getState()

		expect(state.diffEnabled).toBe(true)
	})

	test("writeDelayMs defaults to 1000ms", async () => {
		// Mock globalState.get to return undefined for writeDelayMs
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) =>
			key === "writeDelayMs" ? undefined : null,
		)

		const state = await provider.getState()
		expect(state.writeDelayMs).toBe(1000)
	})

	test("handles writeDelayMs message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		await messageHandler({ type: "writeDelayMs", value: 2000 })

		expect(updateGlobalStateSpy).toHaveBeenCalledWith("writeDelayMs", 2000)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("writeDelayMs", 2000)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("updates sound utility when sound setting changes", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Get the message handler from onDidReceiveMessage
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Simulate setting sound to enabled
		await messageHandler({ type: "soundEnabled", bool: true })
		expect(updateGlobalStateSpy).toHaveBeenCalledWith("soundEnabled", true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("soundEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting sound to disabled
		await messageHandler({ type: "soundEnabled", bool: false })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("soundEnabled", false)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting tts to enabled
		await messageHandler({ type: "ttsEnabled", bool: true })
		expect(setTtsEnabled).toHaveBeenCalledWith(true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("ttsEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting tts to disabled
		await messageHandler({ type: "ttsEnabled", bool: false })
		expect(setTtsEnabled).toHaveBeenCalledWith(false)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("ttsEnabled", false)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("requestDelaySeconds defaults to 10 seconds", async () => {
		// Mock globalState.get to return undefined for requestDelaySeconds
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) => {
			if (key === "requestDelaySeconds") {
				return undefined
			}
			return null
		})

		const state = await provider.getState()
		expect(state.requestDelaySeconds).toBe(10)
	})

	test("alwaysApproveResubmit defaults to false", async () => {
		// Mock globalState.get to return undefined for alwaysApproveResubmit
		;(mockContext.globalState.get as jest.Mock).mockReturnValue(undefined)

		const state = await provider.getState()
		expect(state.alwaysApproveResubmit).toBe(false)
	})

	test("autoCondenseContext defaults to true", async () => {
		// Mock globalState.get to return undefined for autoCondenseContext
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) =>
			key === "autoCondenseContext" ? undefined : null,
		)
		const state = await provider.getState()
		expect(state.autoCondenseContext).toBe(true)
	})

	test("handles autoCondenseContext message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
		await messageHandler({ type: "autoCondenseContext", bool: false })
		expect(updateGlobalStateSpy).toHaveBeenCalledWith("autoCondenseContext", false)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("autoCondenseContext", false)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("autoCondenseContextPercent defaults to 100", async () => {
		// Mock globalState.get to return undefined for autoCondenseContextPercent
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) =>
			key === "autoCondenseContextPercent" ? undefined : null,
		)

		const state = await provider.getState()
		expect(state.autoCondenseContextPercent).toBe(100)
	})

	test("handles autoCondenseContextPercent message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		await messageHandler({ type: "autoCondenseContextPercent", value: 75 })

		expect(updateGlobalStateSpy).toHaveBeenCalledWith("autoCondenseContextPercent", 75)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("autoCondenseContextPercent", 75)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	it("loads saved API config when switching modes", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		const profile: ProviderSettingsEntry = { name: "test-config", id: "test-id", apiProvider: "anthropic" }

		;(provider as any).providerSettingsManager = {
			getModeConfigId: jest.fn().mockResolvedValue("test-id"),
			listConfig: jest.fn().mockResolvedValue([profile]),
			activateProfile: jest.fn().mockResolvedValue(profile),
			setModeConfig: jest.fn(),
		} as any

		// Switch to architect mode
		await messageHandler({ type: "mode", text: "architect" })

		// Should load the saved config for architect mode
		expect(provider.providerSettingsManager.getModeConfigId).toHaveBeenCalledWith("architect")
		expect(provider.providerSettingsManager.activateProfile).toHaveBeenCalledWith({ name: "test-config" })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")
	})

	it("saves current config when switching to mode without config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		;(provider as any).providerSettingsManager = {
			getModeConfigId: jest.fn().mockResolvedValue(undefined),
			listConfig: jest
				.fn()
				.mockResolvedValue([{ name: "current-config", id: "current-id", apiProvider: "anthropic" }]),
			setModeConfig: jest.fn(),
		} as any

		provider.setValue("currentApiConfigName", "current-config")

		// Switch to architect mode
		await messageHandler({ type: "mode", text: "architect" })

		// Should save current config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "current-id")
	})

	it("saves config as default for current mode when loading config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		const profile: ProviderSettingsEntry = { apiProvider: "anthropic", id: "new-id", name: "new-config" }

		;(provider as any).providerSettingsManager = {
			activateProfile: jest.fn().mockResolvedValue(profile),
			listConfig: jest.fn().mockResolvedValue([profile]),
			setModeConfig: jest.fn(),
			getModeConfigId: jest.fn().mockResolvedValue(undefined),
		} as any

		// First set the mode
		await messageHandler({ type: "mode", text: "architect" })

		// Then load the config
		await messageHandler({ type: "loadApiConfiguration", text: "new-config" })

		// Should save new config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "new-id")
	})

	it("load API configuration by ID works and updates mode config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		const profile: ProviderSettingsEntry = {
			name: "config-by-id",
			id: "config-id-123",
			apiProvider: "anthropic",
		}

		;(provider as any).providerSettingsManager = {
			activateProfile: jest.fn().mockResolvedValue(profile),
			listConfig: jest.fn().mockResolvedValue([profile]),
			setModeConfig: jest.fn(),
			getModeConfigId: jest.fn().mockResolvedValue(undefined),
		} as any

		// First set the mode
		await messageHandler({ type: "mode", text: "architect" })

		// Then load the config by ID
		await messageHandler({ type: "loadApiConfigurationById", text: "config-id-123" })

		// Should save new config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "config-id-123")

		// Ensure the `activateProfile` method was called with the correct ID
		expect(provider.providerSettingsManager.activateProfile).toHaveBeenCalledWith({ id: "config-id-123" })
	})

	test("handles browserToolEnabled setting", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Test browserToolEnabled
		await messageHandler({ type: "browserToolEnabled", bool: true })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("browserToolEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Verify state includes browserToolEnabled
		const state = await provider.getState()
		expect(state).toHaveProperty("browserToolEnabled")
		expect(state.browserToolEnabled).toBe(true) // Default value should be true
	})

	test("handles showRooIgnoredFiles setting", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Default value should be true
		expect((await provider.getState()).showRooIgnoredFiles).toBe(true)

		// Test showRooIgnoredFiles with true
		await messageHandler({ type: "showRooIgnoredFiles", bool: true })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("showRooIgnoredFiles", true)
		expect(mockPostMessage).toHaveBeenCalled()
		expect((await provider.getState()).showRooIgnoredFiles).toBe(true)

		// Test showRooIgnoredFiles with false
		await messageHandler({ type: "showRooIgnoredFiles", bool: false })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("showRooIgnoredFiles", false)
		expect(mockPostMessage).toHaveBeenCalled()
		expect((await provider.getState()).showRooIgnoredFiles).toBe(false)
	})

	test("handles request delay settings messages", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Test alwaysApproveResubmit
		await messageHandler({ type: "alwaysApproveResubmit", bool: true })
		expect(updateGlobalStateSpy).toHaveBeenCalledWith("alwaysApproveResubmit", true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("alwaysApproveResubmit", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Test requestDelaySeconds
		await messageHandler({ type: "requestDelaySeconds", value: 10 })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("requestDelaySeconds", 10)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("handles updatePrompt message correctly", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock existing prompts
		const existingPrompts = {
			code: {
				roleDefinition: "existing code role",
				customInstructions: "existing code prompt",
			},
			architect: {
				roleDefinition: "existing architect role",
				customInstructions: "existing architect prompt",
			},
		}

		provider.setValue("customModePrompts", existingPrompts)

		// Test updating a prompt
		await messageHandler({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: "new code prompt",
		})

		// Verify state was updated correctly
		expect(mockContext.globalState.update).toHaveBeenCalledWith("customModePrompts", {
			...existingPrompts,
			code: "new code prompt",
		})

		// Verify state was posted to webview
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "state",
				state: expect.objectContaining({
					customModePrompts: {
						...existingPrompts,
						code: "new code prompt",
					},
				}),
			}),
		)
	})

	test("customModePrompts defaults to empty object", async () => {
		// Mock globalState.get to return undefined for customModePrompts
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) => {
			if (key === "customModePrompts") {
				return undefined
			}
			return null
		})

		const state = await provider.getState()
		expect(state.customModePrompts).toEqual({})
	})

	test("handles maxWorkspaceFiles message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		await messageHandler({ type: "maxWorkspaceFiles", value: 300 })

		expect(updateGlobalStateSpy).toHaveBeenCalledWith("maxWorkspaceFiles", 300)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("maxWorkspaceFiles", 300)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("handles mode-specific custom instructions updates", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock existing prompts
		const existingPrompts = {
			code: {
				roleDefinition: "Code role",
				customInstructions: "Old instructions",
			},
		}
		mockContext.globalState.get = jest.fn((key: string) => {
			if (key === "customModePrompts") {
				return existingPrompts
			}
			return undefined
		})

		// Update custom instructions for code mode
		await messageHandler({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: {
				roleDefinition: "Code role",
				customInstructions: "New instructions",
			},
		})

		// Verify state was updated correctly
		expect(mockContext.globalState.update).toHaveBeenCalledWith("customModePrompts", {
			code: {
				roleDefinition: "Code role",
				customInstructions: "New instructions",
			},
		})
	})

	it("saves mode config when updating API configuration", async () => {
		// Setup mock context with mode and config name
		mockContext = {
			...mockContext,
			globalState: {
				...mockContext.globalState,
				get: jest.fn((key: string) => {
					if (key === "mode") {
						return "code"
					} else if (key === "currentApiConfigName") {
						return "test-config"
					}
					return undefined
				}),
				update: jest.fn(),
				keys: jest.fn().mockReturnValue([]),
			},
		} as unknown as vscode.ExtensionContext

		// Create new provider with updated mock context
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		;(provider as any).providerSettingsManager = {
			listConfig: jest.fn().mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			saveConfig: jest.fn().mockResolvedValue("test-id"),
			setModeConfig: jest.fn(),
		} as any

		// Update API configuration
		await messageHandler({
			type: "upsertApiConfiguration",
			text: "test-config",
			apiConfiguration: { apiProvider: "anthropic" },
		})

		// Should save config as default for current mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("code", "test-id")
	})

	test("file content includes line numbers", async () => {
		const { extractTextFromFile } = require("../../../integrations/misc/extract-text")
		const result = await extractTextFromFile("test.js")
		expect(result).toBe("1 | const x = 1;\n2 | const y = 2;\n3 | const z = 3;")
	})

	describe("deleteMessage", () => {
		beforeEach(async () => {
			// Mock window.showInformationMessage
			;(vscode.window.showInformationMessage as jest.Mock) = jest.fn()
			await provider.resolveWebviewView(mockWebviewView)
		})

		test('handles "Just this message" deletion correctly', async () => {
			// Mock user selecting "Just this message"
			;(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue("confirmation.just_this_message")

			// Setup mock messages
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback" }, // User message 1
				{ ts: 2000, type: "say", say: "tool" }, // Tool message
				{ ts: 3000, type: "say", say: "text", value: 4000 }, // Message to delete
				{ ts: 4000, type: "say", say: "browser_action" }, // Response to delete
				{ ts: 5000, type: "say", say: "user_feedback" }, // Next user message
				{ ts: 6000, type: "say", say: "user_feedback" }, // Final message
			] as ClineMessage[]

			const mockApiHistory = [
				{ ts: 1000 },
				{ ts: 2000 },
				{ ts: 3000 },
				{ ts: 4000 },
				{ ts: 5000 },
				{ ts: 6000 },
			] as (Anthropic.MessageParam & { ts?: number })[]

			// Setup Task instance with auto-mock from the top of the file
			const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance
			mockCline.clineMessages = mockMessages // Set test-specific messages
			mockCline.apiConversationHistory = mockApiHistory // Set API history
			await provider.addClineToStack(mockCline) // Add the mocked instance to the stack

			// Mock getTaskWithId
			;(provider as any).getTaskWithId = jest.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			// Trigger message deletion
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await messageHandler({ type: "deleteMessage", value: 4000 })

			// Verify correct messages were kept
			expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([
				mockMessages[0],
				mockMessages[1],
				mockMessages[4],
				mockMessages[5],
			])

			// Verify correct API messages were kept
			expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([
				mockApiHistory[0],
				mockApiHistory[1],
				mockApiHistory[4],
				mockApiHistory[5],
			])
		})

		test('handles "This and all subsequent messages" deletion correctly', async () => {
			// Mock user selecting "This and all subsequent messages"
			;(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue("confirmation.this_and_subsequent")

			// Setup mock messages
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback" },
				{ ts: 2000, type: "say", say: "text", value: 3000 }, // Message to delete
				{ ts: 3000, type: "say", say: "user_feedback" },
				{ ts: 4000, type: "say", say: "user_feedback" },
			] as ClineMessage[]

			const mockApiHistory = [
				{ ts: 1000 },
				{ ts: 2000 },
				{ ts: 3000 },
				{ ts: 4000 },
			] as (Anthropic.MessageParam & {
				ts?: number
			})[]

			// Setup Cline instance with auto-mock from the top of the file
			const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance
			mockCline.clineMessages = mockMessages
			mockCline.apiConversationHistory = mockApiHistory
			await provider.addClineToStack(mockCline)

			// Mock getTaskWithId
			;(provider as any).getTaskWithId = jest.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			// Trigger message deletion
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await messageHandler({ type: "deleteMessage", value: 3000 })

			// Verify only messages before the deleted message were kept
			expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([mockMessages[0]])

			// Verify only API messages before the deleted message were kept
			expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([mockApiHistory[0]])
		})

		test("handles Cancel correctly", async () => {
			// Mock user selecting "Cancel"
			;(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue("Cancel")

			// Setup Cline instance with auto-mock from the top of the file
			const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance
			mockCline.clineMessages = [{ ts: 1000 }, { ts: 2000 }] as ClineMessage[]
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as (Anthropic.MessageParam & {
				ts?: number
			})[]
			await provider.addClineToStack(mockCline)

			// Trigger message deletion
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await messageHandler({ type: "deleteMessage", value: 2000 })

			// Verify no messages were deleted
			expect(mockCline.overwriteClineMessages).not.toHaveBeenCalled()
			expect(mockCline.overwriteApiConversationHistory).not.toHaveBeenCalled()
		})
	})

	describe("getSystemPrompt", () => {
		beforeEach(async () => {
			mockPostMessage.mockClear()
			await provider.resolveWebviewView(mockWebviewView)
			// Reset and setup mock
			mockAddCustomInstructions.mockClear()
			mockAddCustomInstructions.mockImplementation(
				(modeInstructions: string, globalInstructions: string, _cwd: string) => {
					return Promise.resolve(modeInstructions || globalInstructions || "")
				},
			)
		})

		const getMessageHandler = () => {
			const mockCalls = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls
			expect(mockCalls.length).toBeGreaterThan(0)
			return mockCalls[0][0]
		}

		test("handles mcpEnabled setting correctly", async () => {
			// Mock getState to return mcpEnabled: true
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter" as const,
				},
				mcpEnabled: true,
				enableMcpServerCreation: false,
				mode: "code" as const,
				experiments: experimentDefault,
			} as any)

			const handler1 = getMessageHandler()
			expect(typeof handler1).toBe("function")
			await handler1({ type: "getSystemPrompt", mode: "code" })

			// Verify mcpHub is passed when mcpEnabled is true
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
				}),
			)

			// Mock getState to return mcpEnabled: false
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter" as const,
				},
				mcpEnabled: false,
				enableMcpServerCreation: false,
				mode: "code" as const,
				experiments: experimentDefault,
			} as any)

			const handler2 = getMessageHandler()
			await handler2({ type: "getSystemPrompt", mode: "code" })

			// Verify mcpHub is not passed when mcpEnabled is false
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
				}),
			)
		})

		test("handles errors gracefully", async () => {
			// Mock SYSTEM_PROMPT to throw an error
			const systemPrompt = require("../../prompts/system")
			jest.spyOn(systemPrompt, "SYSTEM_PROMPT").mockRejectedValueOnce(new Error("Test error"))

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await messageHandler({ type: "getSystemPrompt", mode: "code" })

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.get_system_prompt")
		})

		test("uses code mode custom instructions", async () => {
			// Get the mock function
			const mockAddCustomInstructions = (jest.requireMock("../../prompts/sections/custom-instructions") as any)
				.addCustomInstructions

			// Clear any previous calls
			mockAddCustomInstructions.mockClear()

			// Mock SYSTEM_PROMPT
			const systemPromptModule = require("../../prompts/system")
			jest.spyOn(systemPromptModule, "SYSTEM_PROMPT").mockImplementation(async () => {
				await mockAddCustomInstructions("Code mode specific instructions", "", "/mock/path")
				return "mocked system prompt"
			})

			// Trigger getSystemPrompt
			const promptHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await promptHandler({ type: "getSystemPrompt" })

			// Verify mock was called with code mode instructions
			expect(mockAddCustomInstructions).toHaveBeenCalledWith(
				"Code mode specific instructions",
				"",
				expect.any(String),
			)
		})

		test("passes diffStrategy and diffEnabled to SYSTEM_PROMPT when previewing", async () => {
			// Mock buildApiHandler to return an API handler with supportsComputerUse: true
			const { buildApiHandler } = require("../../../api")
			;(buildApiHandler as jest.Mock).mockImplementation(() => ({
				getModel: jest.fn().mockReturnValue({
					id: "claude-3-sonnet",
					info: { supportsComputerUse: true },
				}),
			}))

			// Mock getState to return diffEnabled and fuzzyMatchThreshold
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
					apiModelId: "test-model",
				},
				customModePrompts: {},
				mode: "code",
				enableMcpServerCreation: true,
				mcpEnabled: false,
				browserViewportSize: "900x600",
				diffEnabled: true,
				fuzzyMatchThreshold: 0.8,
				experiments: experimentDefault,
				browserToolEnabled: true,
			} as any)

			// Mock SYSTEM_PROMPT to verify diffStrategy and diffEnabled are passed
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify SYSTEM_PROMPT was called
			expect(systemPromptSpy).toHaveBeenCalled()

			// Get the actual arguments passed to SYSTEM_PROMPT
			const callArgs = systemPromptSpy.mock.calls[0]

			// Verify key parameters
			expect(callArgs[2]).toBe(true) // supportsComputerUse
			expect(callArgs[3]).toBeUndefined() // mcpHub (disabled)
			expect(callArgs[4]).toHaveProperty("getToolDescription") // diffStrategy
			expect(callArgs[5]).toBe("900x600") // browserViewportSize
			expect(callArgs[6]).toBe("code") // mode
			expect(callArgs[10]).toBe(true) // diffEnabled

			// Run the test again to verify it's consistent
			await handler({ type: "getSystemPrompt", mode: "code" })
			expect(systemPromptSpy).toHaveBeenCalledTimes(2)
		})

		test("passes diffEnabled: false to SYSTEM_PROMPT when diff is disabled", async () => {
			// Setup Task instance with mocked api.getModel()
			const mockCline = new Task(defaultTaskOptions)

			mockCline.api = {
				getModel: jest.fn().mockReturnValue({
					id: "claude-3-sonnet",
					info: { supportsComputerUse: true },
				}),
			} as any

			await provider.addClineToStack(mockCline)

			// Mock getState to return diffEnabled: false
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
					apiModelId: "test-model",
				},
				customModePrompts: {},
				mode: "code",
				mcpEnabled: false,
				browserViewportSize: "900x600",
				diffEnabled: false,
				fuzzyMatchThreshold: 0.8,
				experiments: experimentDefault,
				enableMcpServerCreation: true,
				browserToolEnabled: true,
			} as any)

			// Mock SYSTEM_PROMPT to verify diffEnabled is passed as false
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify SYSTEM_PROMPT was called
			expect(systemPromptSpy).toHaveBeenCalled()

			// Get the actual arguments passed to SYSTEM_PROMPT
			const callArgs = systemPromptSpy.mock.calls[0]

			// Verify key parameters
			expect(callArgs[2]).toBe(true) // supportsComputerUse
			expect(callArgs[3]).toBeUndefined() // mcpHub (disabled)
			expect(callArgs[4]).toHaveProperty("getToolDescription") // diffStrategy
			expect(callArgs[5]).toBe("900x600") // browserViewportSize
			expect(callArgs[6]).toBe("code") // mode
			expect(callArgs[10]).toBe(false) // diffEnabled should be true
		})

		test("uses correct mode-specific instructions when mode is specified", async () => {
			// Mock getState to return architect mode instructions
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				customModePrompts: {
					architect: { customInstructions: "Architect mode instructions" },
				},
				mode: "architect",
				enableMcpServerCreation: false,
				mcpEnabled: false,
				browserViewportSize: "900x600",
				experiments: experimentDefault,
			} as any)

			// Mock SYSTEM_PROMPT to call addCustomInstructions
			const systemPromptModule = require("../../prompts/system")
			jest.spyOn(systemPromptModule, "SYSTEM_PROMPT").mockImplementation(async () => {
				await mockAddCustomInstructions("Architect mode instructions", "", "/mock/path")
				return "mocked system prompt"
			})

			// Resolve webview and trigger getSystemPrompt
			await provider.resolveWebviewView(mockWebviewView)
			const architectHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
			await architectHandler({ type: "getSystemPrompt" })

			// Verify architect mode instructions were used
			expect(mockAddCustomInstructions).toHaveBeenCalledWith(
				"Architect mode instructions",
				"",
				expect.any(String),
			)
		})

		// Tests for browser tool support
		test("correctly determines model support for computer use without Cline instance", async () => {
			// Mock buildApiHandler to return an API handler with supportsComputerUse: true
			const { buildApiHandler } = require("../../../api")
			;(buildApiHandler as jest.Mock).mockImplementation(() => ({
				getModel: jest.fn().mockReturnValue({
					id: "claude-3-sonnet",
					info: { supportsComputerUse: true },
				}),
			}))

			// Mock SYSTEM_PROMPT to verify supportsComputerUse is passed correctly
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Mock getState to return browserToolEnabled: true and a mode that supports browser
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				browserToolEnabled: true,
				mode: "code", // code mode includes browser tool group
				experiments: experimentDefault,
			} as any)

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify SYSTEM_PROMPT was called
			expect(systemPromptSpy).toHaveBeenCalled()

			// Get the actual arguments passed to SYSTEM_PROMPT
			const callArgs = systemPromptSpy.mock.calls[0]

			// Verify the supportsComputerUse parameter (3rd parameter, index 2)
			expect(callArgs[2]).toBe(true)
		})

		test("correctly handles when model doesn't support computer use", async () => {
			// Mock buildApiHandler to return an API handler with supportsComputerUse: false
			const { buildApiHandler } = require("../../../api")
			;(buildApiHandler as jest.Mock).mockImplementation(() => ({
				getModel: jest.fn().mockReturnValue({
					id: "non-computer-use-model",
					info: { supportsComputerUse: false },
				}),
			}))

			// Mock SYSTEM_PROMPT to verify supportsComputerUse is passed correctly
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Mock getState to return browserToolEnabled: true
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				browserToolEnabled: true,
				mode: "code",
				experiments: experimentDefault,
			} as any)

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify SYSTEM_PROMPT was called
			expect(systemPromptSpy).toHaveBeenCalled()

			// Get the actual arguments passed to SYSTEM_PROMPT
			const callArgs = systemPromptSpy.mock.calls[0]

			// Verify the supportsComputerUse parameter (3rd parameter, index 2)
			// Even though browserToolEnabled is true, the model doesn't support it
			expect(callArgs[2]).toBe(false)
		})

		test("correctly handles when browserToolEnabled is false", async () => {
			// Mock buildApiHandler to return an API handler with supportsComputerUse: true
			const { buildApiHandler } = require("../../../api")
			;(buildApiHandler as jest.Mock).mockImplementation(() => ({
				getModel: jest.fn().mockReturnValue({
					id: "claude-3-sonnet",
					info: { supportsComputerUse: true },
				}),
			}))

			// Mock SYSTEM_PROMPT to verify supportsComputerUse is passed correctly
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Mock getState to return browserToolEnabled: false
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				browserToolEnabled: false,
				mode: "code",
				experiments: experimentDefault,
			} as any)

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify SYSTEM_PROMPT was called
			expect(systemPromptSpy).toHaveBeenCalled()

			// Get the actual arguments passed to SYSTEM_PROMPT
			const callArgs = systemPromptSpy.mock.calls[0]

			// Verify the supportsComputerUse parameter (3rd parameter, index 2)
			// Even though model supports it, browserToolEnabled is false
			expect(callArgs[2]).toBe(false)
		})

		test("correctly handles when mode doesn't include browser tool group", async () => {
			// Mock buildApiHandler to return an API handler with supportsComputerUse: true
			const { buildApiHandler } = require("../../../api")
			;(buildApiHandler as jest.Mock).mockImplementation(() => ({
				getModel: jest.fn().mockReturnValue({
					id: "claude-3-sonnet",
					info: { supportsComputerUse: true },
				}),
			}))

			// Mock SYSTEM_PROMPT to verify supportsComputerUse is passed correctly
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Mock getState to return a mode that doesn't include browser tool group
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				browserToolEnabled: true,
				mode: "custom-mode-without-browser", // Custom mode without browser tool group
				experiments: experimentDefault,
			} as any)

			// Mock getModeBySlug to return a mode without browser tool group
			const modesModule = require("../../../shared/modes")
			jest.spyOn(modesModule, "getModeBySlug").mockReturnValue({
				slug: "custom-mode-without-browser",
				name: "Custom Mode",
				roleDefinition: "Custom role",
				groups: ["read", "edit"], // No browser group
			})

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "custom-mode-without-browser" })

			// Verify SYSTEM_PROMPT was called
			expect(systemPromptSpy).toHaveBeenCalled()

			// Get the actual arguments passed to SYSTEM_PROMPT
			const callArgs = systemPromptSpy.mock.calls[0]

			// Verify the supportsComputerUse parameter (3rd parameter, index 2)
			// Even though model supports it and browserToolEnabled is true, the mode doesn't include browser tool group
			expect(callArgs[2]).toBe(false)
		})

		test("correctly calculates canUseBrowserTool based on all three conditions", async () => {
			// Mock buildApiHandler
			const { buildApiHandler } = require("../../../api")

			// Mock SYSTEM_PROMPT
			const systemPromptModule = require("../../prompts/system")
			const systemPromptSpy = jest.spyOn(systemPromptModule, "SYSTEM_PROMPT")

			// Mock getModeBySlug
			const modesModule = require("../../../shared/modes")

			// Test all combinations of model support, mode support, and browserToolEnabled
			const testCases = [
				{ modelSupports: true, modeSupports: true, settingEnabled: true, expected: true },
				{ modelSupports: true, modeSupports: true, settingEnabled: false, expected: false },
				{ modelSupports: true, modeSupports: false, settingEnabled: true, expected: false },
				{ modelSupports: false, modeSupports: true, settingEnabled: true, expected: false },
				{ modelSupports: false, modeSupports: false, settingEnabled: false, expected: false },
			]

			for (const testCase of testCases) {
				// Reset mocks
				systemPromptSpy.mockClear()

				// Mock buildApiHandler to return appropriate model support
				;(buildApiHandler as jest.Mock).mockImplementation(() => ({
					getModel: jest.fn().mockReturnValue({
						id: "test-model",
						info: { supportsComputerUse: testCase.modelSupports },
					}),
				}))

				// Mock getModeBySlug to return appropriate mode support
				jest.spyOn(modesModule, "getModeBySlug").mockReturnValue({
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Test role",
					groups: testCase.modeSupports ? ["read", "browser"] : ["read"],
				})

				// Mock getState
				jest.spyOn(provider, "getState").mockResolvedValue({
					apiConfiguration: {
						apiProvider: "openrouter",
					},
					browserToolEnabled: testCase.settingEnabled,
					mode: "test-mode",
					experiments: experimentDefault,
				} as any)

				// Trigger getSystemPrompt
				const handler = getMessageHandler()
				await handler({ type: "getSystemPrompt", mode: "test-mode" })

				// Verify SYSTEM_PROMPT was called
				expect(systemPromptSpy).toHaveBeenCalled()

				// Get the actual arguments passed to SYSTEM_PROMPT
				const callArgs = systemPromptSpy.mock.calls[0]

				// Verify the supportsComputerUse parameter (3rd parameter, index 2)
				expect(callArgs[2]).toBe(testCase.expected)
			}
		})
	})

	describe("handleModeSwitch", () => {
		beforeEach(async () => {
			// Set up webview for each test
			await provider.resolveWebviewView(mockWebviewView)
		})

		it("loads saved API config when switching modes", async () => {
			const profile: ProviderSettingsEntry = {
				name: "saved-config",
				id: "saved-config-id",
				apiProvider: "anthropic",
			}

			;(provider as any).providerSettingsManager = {
				getModeConfigId: jest.fn().mockResolvedValue("saved-config-id"),
				listConfig: jest.fn().mockResolvedValue([profile]),
				activateProfile: jest.fn().mockResolvedValue(profile),
				setModeConfig: jest.fn(),
			} as any

			// Switch to architect mode
			await provider.handleModeSwitch("architect")

			// Verify mode was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "architect")

			// Verify saved config was loaded
			expect(provider.providerSettingsManager.getModeConfigId).toHaveBeenCalledWith("architect")
			expect(provider.providerSettingsManager.activateProfile).toHaveBeenCalledWith({ name: "saved-config" })
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "saved-config")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})

		test("saves current config when switching to mode without config", async () => {
			;(provider as any).providerSettingsManager = {
				getModeConfigId: jest.fn().mockResolvedValue(undefined),
				listConfig: jest
					.fn()
					.mockResolvedValue([{ name: "current-config", id: "current-id", apiProvider: "anthropic" }]),
				setModeConfig: jest.fn(),
			} as any

			// Mock the ContextProxy's getValue method to return the current config name
			const contextProxy = (provider as any).contextProxy
			const getValueSpy = jest.spyOn(contextProxy, "getValue")
			getValueSpy.mockImplementation((key: any) => {
				if (key === "currentApiConfigName") return "current-config"
				return undefined
			})

			// Switch to architect mode
			await provider.handleModeSwitch("architect")

			// Verify mode was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "architect")

			// Verify current config was saved as default for new mode
			expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "current-id")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})
	})

	describe("updateCustomMode", () => {
		test("updates both file and state when updating custom mode", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Mock CustomModesManager methods
			;(provider as any).customModesManager = {
				updateCustomMode: jest.fn().mockResolvedValue(undefined),
				getCustomModes: jest.fn().mockResolvedValue([
					{
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Updated role definition",
						groups: ["read"] as const,
					},
				]),
				dispose: jest.fn(),
			} as any

			// Test updating a custom mode
			await messageHandler({
				type: "updateCustomMode",
				modeConfig: {
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Updated role definition",
					groups: ["read"] as const,
				},
			})

			// Verify CustomModesManager.updateCustomMode was called
			expect(provider.customModesManager.updateCustomMode).toHaveBeenCalledWith(
				"test-mode",
				expect.objectContaining({
					slug: "test-mode",
					roleDefinition: "Updated role definition",
				}),
			)

			// Verify state was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("customModes", [
				{ groups: ["read"], name: "Test Mode", roleDefinition: "Updated role definition", slug: "test-mode" },
			])

			// Verify state was posted to webview
			// Verify state was posted to webview with correct format
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "state",
					state: expect.objectContaining({
						customModes: [
							expect.objectContaining({
								slug: "test-mode",
								roleDefinition: "Updated role definition",
							}),
						],
					}),
				}),
			)
		})
	})

	describe("upsertApiConfiguration", () => {
		test("handles error in upsertApiConfiguration gracefully", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			;(provider as any).providerSettingsManager = {
				setModeConfig: jest.fn().mockRejectedValue(new Error("Failed to update mode config")),
				listConfig: jest
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			// Mock getState to provide necessary data
			jest.spyOn(provider, "getState").mockResolvedValue({
				mode: "code",
				currentApiConfigName: "test-config",
			} as any)

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: { apiProvider: "anthropic", apiKey: "test-key" },
			})

			// Verify error was logged and user was notified
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Error create new api configuration"),
			)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.create_api_config")
		})

		test("handles successful upsertApiConfiguration", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			;(provider as any).providerSettingsManager = {
				setModeConfig: jest.fn(),
				saveConfig: jest.fn().mockResolvedValue(undefined),
				listConfig: jest
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify config was saved
			expect(provider.providerSettingsManager.saveConfig).toHaveBeenCalledWith("test-config", testApiConfig)

			// Verify state updates
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})

		test("handles buildApiHandler error in updateApiConfiguration", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Mock buildApiHandler to throw an error
			const { buildApiHandler } = require("../../../api")

			;(buildApiHandler as jest.Mock).mockImplementationOnce(() => {
				throw new Error("API handler error")
			})
			;(provider as any).providerSettingsManager = {
				setModeConfig: jest.fn(),
				saveConfig: jest.fn().mockResolvedValue(undefined),
				listConfig: jest
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			// Setup Task instance with auto-mock from the top of the file
			const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance
			await provider.addClineToStack(mockCline)

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify error handling
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Error create new api configuration"),
			)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.create_api_config")

			// Verify state was still updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")
		})

		test("handles successful saveApiConfiguration", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			;(provider as any).providerSettingsManager = {
				setModeConfig: jest.fn(),
				saveConfig: jest.fn().mockResolvedValue(undefined),
				listConfig: jest
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "saveApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify config was saved
			expect(provider.providerSettingsManager.saveConfig).toHaveBeenCalledWith("test-config", testApiConfig)

			// Verify state updates
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(updateGlobalStateSpy).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
		})
	})

	describe("browser connection features", () => {
		beforeEach(async () => {
			// Reset mocks
			jest.clearAllMocks()
			await provider.resolveWebviewView(mockWebviewView)
		})

		// Mock BrowserSession and discoverChromeInstances
		jest.mock("../../../services/browser/BrowserSession", () => ({
			BrowserSession: jest.fn().mockImplementation(() => ({
				testConnection: jest.fn().mockImplementation(async (url) => {
					if (url === "http://localhost:9222") {
						return {
							success: true,
							message: "Successfully connected to Chrome",
							endpoint: "ws://localhost:9222/devtools/browser/123",
						}
					} else {
						return {
							success: false,
							message: "Failed to connect to Chrome",
							endpoint: undefined,
						}
					}
				}),
			})),
		}))

		jest.mock("../../../services/browser/browserDiscovery", () => ({
			discoverChromeInstances: jest.fn().mockImplementation(async () => {
				return "http://localhost:9222"
			}),
		}))

		test("handles testBrowserConnection with provided URL", async () => {
			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Test with valid URL
			await messageHandler({
				type: "testBrowserConnection",
				text: "http://localhost:9222",
			})

			// Verify postMessage was called with success result
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "browserConnectionResult",
					success: true,
					text: expect.stringContaining("Successfully connected to Chrome"),
				}),
			)

			// Reset mock
			mockPostMessage.mockClear()

			// Test with invalid URL
			await messageHandler({
				type: "testBrowserConnection",
				text: "http://inlocalhost:9222",
			})

			// Verify postMessage was called with failure result
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "browserConnectionResult",
					success: false,
					text: expect.stringContaining("Failed to connect to Chrome"),
				}),
			)
		})

		test("handles testBrowserConnection with auto-discovery", async () => {
			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

			// Test auto-discovery (no URL provided)
			await messageHandler({
				type: "testBrowserConnection",
			})

			// Verify discoverChromeHostUrl was called
			const { discoverChromeHostUrl } = require("../../../services/browser/browserDiscovery")
			expect(discoverChromeHostUrl).toHaveBeenCalled()

			// Verify postMessage was called with success result
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "browserConnectionResult",
					success: true,
					text: expect.stringContaining("Auto-discovered and tested connection to Chrome"),
				}),
			)
		})
	})
})

describe("Project MCP Settings", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: jest.Mock

	beforeEach(() => {
		jest.clearAllMocks()

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: jest.fn(),
				update: jest.fn(),
				keys: jest.fn().mockReturnValue([]),
			},
			secrets: {
				get: jest.fn(),
				store: jest.fn(),
				delete: jest.fn(),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: jest.fn(),
			clear: jest.fn(),
			dispose: jest.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = jest.fn()
		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: jest.fn(),
				asWebviewUri: jest.fn(),
			},
			visible: true,
			onDidDispose: jest.fn(),
			onDidChangeVisibility: jest.fn(),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
	})

	test("handles openProjectMcpSettings message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock workspace folders
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]

		// Mock fs functions
		const fs = require("fs/promises")
		fs.mkdir.mockResolvedValue(undefined)
		fs.writeFile.mockResolvedValue(undefined)

		// Trigger openProjectMcpSettings
		await messageHandler({
			type: "openProjectMcpSettings",
		})

		// Verify directory was created
		expect(fs.mkdir).toHaveBeenCalledWith(
			expect.stringContaining(".roo"),
			expect.objectContaining({ recursive: true }),
		)

		// Verify file was created with default content
		expect(fs.writeFile).toHaveBeenCalledWith(
			expect.stringContaining("mcp.json"),
			JSON.stringify({ mcpServers: {} }, null, 2),
		)
	})

	test("handles openProjectMcpSettings when workspace is not open", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock no workspace folders
		;(vscode.workspace as any).workspaceFolders = []

		// Trigger openProjectMcpSettings
		await messageHandler({ type: "openProjectMcpSettings" })

		// Verify error message was shown
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.no_workspace")
	})

	test.skip("handles openProjectMcpSettings file creation error", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock workspace folders
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]

		// Mock fs functions to fail
		const fs = require("fs/promises")
		fs.mkdir.mockRejectedValue(new Error("Failed to create directory"))

		// Trigger openProjectMcpSettings
		await messageHandler({
			type: "openProjectMcpSettings",
		})

		// Verify error message was shown
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("Failed to create or open .roo/mcp.json"),
		)
	})
})

describe.skip("ContextProxy integration", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockContextProxy: any

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Setup basic mocks
		mockContext = {
			globalState: {
				get: jest.fn(),
				update: jest.fn(),
				keys: jest.fn().mockReturnValue([]),
			},
			secrets: { get: jest.fn(), store: jest.fn(), delete: jest.fn() },
			extensionUri: {} as vscode.Uri,
			globalStorageUri: { fsPath: "/test/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = { appendLine: jest.fn() } as unknown as vscode.OutputChannel
		mockContextProxy = new ContextProxy(mockContext)
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", mockContextProxy)
	})

	test("updateGlobalState uses contextProxy", async () => {
		await provider.setValue("currentApiConfigName", "testValue")
		expect(mockContextProxy.updateGlobalState).toHaveBeenCalledWith("currentApiConfigName", "testValue")
	})

	test("getGlobalState uses contextProxy", async () => {
		mockContextProxy.getGlobalState.mockResolvedValueOnce("testValue")
		const result = await provider.getValue("currentApiConfigName")
		expect(mockContextProxy.getGlobalState).toHaveBeenCalledWith("currentApiConfigName")
		expect(result).toBe("testValue")
	})

	test("storeSecret uses contextProxy", async () => {
		await provider.setValue("apiKey", "test-secret")
		expect(mockContextProxy.storeSecret).toHaveBeenCalledWith("apiKey", "test-secret")
	})

	test("contextProxy methods are available", () => {
		// Verify the contextProxy has all the required methods
		expect(mockContextProxy.getGlobalState).toBeDefined()
		expect(mockContextProxy.updateGlobalState).toBeDefined()
		expect(mockContextProxy.storeSecret).toBeDefined()
		expect(mockContextProxy.setValue).toBeDefined()
		expect(mockContextProxy.setValues).toBeDefined()
	})
})

describe("getTelemetryProperties", () => {
	let defaultTaskOptions: TaskOptions
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockCline: any

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Setup basic mocks
		mockContext = {
			globalState: {
				get: jest.fn().mockImplementation((key: string) => {
					if (key === "mode") return "code"
					if (key === "apiProvider") return "anthropic"
					return undefined
				}),
				update: jest.fn(),
				keys: jest.fn().mockReturnValue([]),
			},
			secrets: { get: jest.fn(), store: jest.fn(), delete: jest.fn() },
			extensionUri: {} as vscode.Uri,
			globalStorageUri: { fsPath: "/test/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = { appendLine: jest.fn() } as unknown as vscode.OutputChannel
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		defaultTaskOptions = {
			provider,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
		}

		// Setup Task instance with mocked getModel method
		mockCline = new Task(defaultTaskOptions)
		mockCline.api = {
			getModel: jest.fn().mockReturnValue({
				id: "claude-sonnet-4-20250514",
				info: { contextWindow: 200000 },
			}),
		}
	})

	test("includes basic properties in telemetry", async () => {
		const properties = await provider.getTelemetryProperties()

		expect(properties).toHaveProperty("vscodeVersion")
		expect(properties).toHaveProperty("platform")
		expect(properties).toHaveProperty("appVersion", "1.0.0")
	})

	test("includes model ID from current Cline instance if available", async () => {
		// Add mock Cline to stack
		await provider.addClineToStack(mockCline)

		const properties = await provider.getTelemetryProperties()

		expect(properties).toHaveProperty("modelId", "claude-sonnet-4-20250514")
	})
})

// Mock getModels for router model tests
jest.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: jest.fn(),
	flushModels: jest.fn(),
}))

describe("ClineProvider - Router Models", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: jest.Mock

	beforeEach(() => {
		jest.clearAllMocks()

		const globalState: Record<string, string | undefined> = {}
		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: jest.fn().mockImplementation((key: string) => globalState[key]),
				update: jest
					.fn()
					.mockImplementation((key: string, value: string | undefined) => (globalState[key] = value)),
				keys: jest.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: jest.fn().mockImplementation((key: string) => secrets[key]),
				store: jest.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: jest.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: jest.fn(),
			clear: jest.fn(),
			dispose: jest.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = jest.fn()
		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: jest.fn(),
				asWebviewUri: jest.fn(),
			},
			visible: true,
			onDidDispose: jest.fn().mockImplementation((callback) => {
				callback()
				return { dispose: jest.fn() }
			}),
			onDidChangeVisibility: jest.fn().mockImplementation(() => ({ dispose: jest.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
	})

	test("handles requestRouterModels with successful responses", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock getState to return API configuration
		jest.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				glamaApiKey: "glama-key",
				unboundApiKey: "unbound-key",
				litellmApiKey: "litellm-key",
				litellmBaseUrl: "http://localhost:4000",
			},
		} as any)

		const mockModels = {
			"model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model 1" },
			"model-2": { maxTokens: 8192, contextWindow: 16384, description: "Test model 2" },
		}

		const { getModels } = require("../../../api/providers/fetchers/modelCache")
		getModels.mockResolvedValue(mockModels)

		await messageHandler({ type: "requestRouterModels" })

		// Verify getModels was called for each provider with correct options
		expect(getModels).toHaveBeenCalledWith({ provider: "openrouter" })
		expect(getModels).toHaveBeenCalledWith({ provider: "requesty", apiKey: "requesty-key" })
		expect(getModels).toHaveBeenCalledWith({ provider: "glama" })
		expect(getModels).toHaveBeenCalledWith({ provider: "unbound", apiKey: "unbound-key" })
		expect(getModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "litellm-key",
			baseUrl: "http://localhost:4000",
		})

		// Verify response was sent
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: mockModels,
				glama: mockModels,
				unbound: mockModels,
				litellm: mockModels,
			},
		})
	})

	test("handles requestRouterModels with individual provider failures", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		jest.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				glamaApiKey: "glama-key",
				unboundApiKey: "unbound-key",
				litellmApiKey: "litellm-key",
				litellmBaseUrl: "http://localhost:4000",
			},
		} as any)

		const mockModels = { "model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model" } }
		const { getModels } = require("../../../api/providers/fetchers/modelCache")

		// Mock some providers to succeed and others to fail
		getModels
			.mockResolvedValueOnce(mockModels) // openrouter success
			.mockRejectedValueOnce(new Error("Requesty API error")) // requesty fail
			.mockResolvedValueOnce(mockModels) // glama success
			.mockRejectedValueOnce(new Error("Unbound API error")) // unbound fail
			.mockRejectedValueOnce(new Error("LiteLLM connection failed")) // litellm fail

		await messageHandler({ type: "requestRouterModels" })

		// Verify main response includes successful providers and empty objects for failed ones
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: {},
				glama: mockModels,
				unbound: {},
				litellm: {},
			},
		})

		// Verify error messages were sent for failed providers
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Requesty API error",
			values: { provider: "requesty" },
		})

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Unbound API error",
			values: { provider: "unbound" },
		})

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "LiteLLM connection failed",
			values: { provider: "litellm" },
		})
	})

	test("handles requestRouterModels with LiteLLM values from message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock state without LiteLLM config
		jest.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				glamaApiKey: "glama-key",
				unboundApiKey: "unbound-key",
				// No litellm config
			},
		} as any)

		const mockModels = { "model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model" } }
		const { getModels } = require("../../../api/providers/fetchers/modelCache")
		getModels.mockResolvedValue(mockModels)

		await messageHandler({
			type: "requestRouterModels",
			values: {
				litellmApiKey: "message-litellm-key",
				litellmBaseUrl: "http://message-url:4000",
			},
		})

		// Verify LiteLLM was called with values from message
		expect(getModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "message-litellm-key",
			baseUrl: "http://message-url:4000",
		})
	})

	test("skips LiteLLM when neither config nor message values are provided", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		jest.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				glamaApiKey: "glama-key",
				unboundApiKey: "unbound-key",
				// No litellm config
			},
		} as any)

		const mockModels = { "model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model" } }
		const { getModels } = require("../../../api/providers/fetchers/modelCache")
		getModels.mockResolvedValue(mockModels)

		await messageHandler({ type: "requestRouterModels" })

		// Verify LiteLLM was NOT called
		expect(getModels).not.toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "litellm",
			}),
		)

		// Verify response includes empty object for LiteLLM
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: mockModels,
				glama: mockModels,
				unbound: mockModels,
				litellm: {},
			},
		})
	})
})
