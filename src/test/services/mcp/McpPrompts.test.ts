import * as assert from "assert"
import * as sinon from "sinon"
import proxyquire from "proxyquire"
import { McpPrompt, McpPromptResponse } from "../../../shared/mcp"

// Mock for VSCode module
const vscodeMock = {
	window: {
		showErrorMessage: sinon.stub(),
		showInformationMessage: sinon.stub(),
		showWarningMessage: sinon.stub(),
	},
	workspace: {
		getConfiguration: sinon.stub().returns({
			get: sinon.stub().returns("full"),
		}),
		onDidSaveTextDocument: sinon.stub().returns({ dispose: sinon.stub() }),
	},
	FileSystemWatcher: sinon.stub(),
	Disposable: {
		from: sinon.stub(),
	},
}

// Mock for fs/promises
const fsMock = {
	writeFile: sinon.stub().resolves(),
	readFile: sinon.stub().resolves("{}"),
}

// Mock for path.ts
const pathUtilsMock = {
	arePathsEqual: sinon.stub().returns(false),
	getReadablePath: sinon.stub().returns("mock/path"),
	getWorkspacePath: sinon.stub().returns("/mock/workspace"),
}

// Proxy the McpHub class to mock the vscode module
const { McpHub } = proxyquire.noCallThru().load("../../../services/mcp/McpHub", {
	vscode: vscodeMock,
	"fs/promises": fsMock,
	"../../utils/path": pathUtilsMock,
	"../../utils/fs": {
		fileExistsAtPath: sinon.stub().resolves(true),
	},
	"../../utils/time": {
		secondsToMs: sinon.stub().returns(5000),
	},
	"@modelcontextprotocol/sdk/client/index.js": {
		Client: function () {
			return {
				request: sinon.stub(),
				connect: sinon.stub().resolves(),
				close: sinon.stub().resolves(),
			}
		},
	},
	"@modelcontextprotocol/sdk/client/stdio.js": {
		StdioClientTransport: function () {
			return {
				start: sinon.stub().resolves(),
				close: sinon.stub().resolves(),
				stderr: {
					on: sinon.stub(),
				},
			}
		},
	},
	"@modelcontextprotocol/sdk/client/sse.js": {
		SSEClientTransport: function () {
			return {
				close: sinon.stub().resolves(),
			}
		},
	},
	chokidar: {
		watch: sinon.stub().returns({
			on: sinon.stub(),
			close: sinon.stub(),
		}),
	},
})

describe("McpHub Prompts", () => {
	let mcpHub: any
	let mockController: any
	let mockClient: any
	let mockTransport: any
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Create mock controller
		mockController = {
			context: {
				extension: {
					packageJSON: {
						version: "1.0.0",
					},
				},
			},
			ensureMcpServersDirectoryExists: sandbox.stub().resolves("/mock/path/mcpServers"),
			ensureSettingsDirectoryExists: sandbox.stub().resolves("/mock/path/settings"),
			postMessageToWebview: sandbox.stub().resolves(),
		}

		// Mock the deref method because WeakRef is used
		const originalWeakRef = global.WeakRef
		// @ts-ignore
		global.WeakRef = function (obj: any) {
			return {
				deref: () => obj,
			}
		}

		mcpHub = new McpHub(mockController)

		// Restore original WeakRef
		global.WeakRef = originalWeakRef

		// Create mock client and transport
		mockClient = {
			request: sandbox.stub(),
			connect: sandbox.stub().resolves(),
			close: sandbox.stub().resolves(),
		}

		mockTransport = {
			close: sandbox.stub().resolves(),
			start: sandbox.stub().resolves(),
		}

		// Directly set mcpHub.connections
		mcpHub.connections = [
			{
				server: {
					name: "test-server",
					config: JSON.stringify({
						command: "test-command",
						args: [],
						transportType: "stdio",
					}),
					status: "connected",
					disabled: false,
				},
				client: mockClient,
				transport: mockTransport,
			},
		]
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("fetchPromptsList", () => {
		it("should fetch prompts list from server", async () => {
			// Test prompt list
			const mockPrompts: McpPrompt[] = [
				{
					name: "test-prompt-1",
					description: "Test prompt 1",
					arguments: [
						{
							name: "arg1",
							description: "Argument 1",
							required: true,
						},
					],
				},
				{
					name: "test-prompt-2",
					description: "Test prompt 2",
				},
			]

			// Mock the client's request method
			mockClient.request.resolves({ prompts: mockPrompts })

			// Cast to any to call private method
			const result = await (mcpHub as any).fetchPromptsList("test-server")

			// Verify the result
			assert.deepStrictEqual(result, mockPrompts)

			// Ensure the request method was called correctly
			sinon.assert.calledWith(mockClient.request, { method: "prompts/list" }, sinon.match.any, sinon.match.any)
		})

		it("should return empty array if server returns no prompts", async () => {
			// Response with no prompts
			mockClient.request.resolves({ prompts: [] })

			// Cast to any to call private method
			const result = await (mcpHub as any).fetchPromptsList("test-server")

			// Verify the result
			assert.deepStrictEqual(result, [])
		})

		it("should return empty array if request fails", async () => {
			// Simulate request failure
			mockClient.request.rejects(new Error("Request failed"))

			// Cast to any to call private method
			const result = await (mcpHub as any).fetchPromptsList("test-server")

			// Verify the result
			assert.deepStrictEqual(result, [])
		})
	})

	describe("getPrompt", () => {
		it("should get prompt from server", async () => {
			// Test prompt response
			const mockPromptResponse: McpPromptResponse = {
				description: "Test prompt",
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: "Hello, arg1!",
						},
					},
				],
			}

			// Mock the client's request method
			mockClient.request.resolves(mockPromptResponse)

			// Call getPrompt method
			const result = await mcpHub.getPrompt("test-server", "test-prompt", { arg1: "world" })

			// Verify the result
			assert.deepStrictEqual(result, mockPromptResponse)

			// Ensure the request method was called correctly
			sinon.assert.calledWith(
				mockClient.request,
				{
					method: "prompts/get",
					params: {
						name: "test-prompt",
						arguments: { arg1: "world" },
					},
				},
				sinon.match.any,
				sinon.match.any,
			)
		})

		it("should throw error if server is not found", async () => {
			try {
				await mcpHub.getPrompt("non-existent-server", "test-prompt")
				assert.fail("Expected error was not thrown")
			} catch (error: any) {
				assert.strictEqual(error.message, "No connection found for server: non-existent-server")
			}
		})

		it("should throw error if server is disabled", async () => {
			// Disable the server
			mcpHub.connections[0].server.disabled = true

			try {
				await mcpHub.getPrompt("test-server", "test-prompt")
				assert.fail("Expected error was not thrown")
			} catch (error: any) {
				assert.strictEqual(error.message, 'Server "test-server" is disabled')
			}
		})
	})

	describe("connectToServer", () => {
		it("should fetch prompts during server connection", async () => {
			// Spy on fetchPromptsList method
			const fetchPromptsListSpy = sandbox.spy(mcpHub as any, "fetchPromptsList")

			// Set up mocks
			sandbox.stub(mcpHub as any, "fetchToolsList").resolves([])
			sandbox.stub(mcpHub as any, "fetchResourcesList").resolves([])
			sandbox.stub(mcpHub as any, "fetchResourceTemplatesList").resolves([])

			// Mock new client and transport
			const newMockClient = {
				request: sandbox.stub(),
				connect: sandbox.stub().resolves(),
			}

			const newMockTransport = {
				start: sandbox.stub().resolves(),
				onerror: null as any,
				onclose: null as any,
			}

			// Mock Client constructor
			const originalClient = require("@modelcontextprotocol/sdk/client/index.js").Client
			require("@modelcontextprotocol/sdk/client/index.js").Client = function () {
				return newMockClient
			}

			// Mock StdioClientTransport constructor
			const originalStdioClientTransport = require("@modelcontextprotocol/sdk/client/stdio.js").StdioClientTransport
			require("@modelcontextprotocol/sdk/client/stdio.js").StdioClientTransport = function () {
				return newMockTransport
			}

			// Call connectToServer method
			await (mcpHub as any).connectToServer("new-server", {
				command: "test-command",
				args: [],
				transportType: "stdio",
			})

			// Verify fetchPromptsList was called
			sinon.assert.calledWith(fetchPromptsListSpy, "new-server")

			// Restore original mocks
			require("@modelcontextprotocol/sdk/client/index.js").Client = originalClient
			require("@modelcontextprotocol/sdk/client/stdio.js").StdioClientTransport = originalStdioClientTransport
		})
	})
})
