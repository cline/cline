import type { McpHub as McpHubType, McpConnection } from "../McpHub"
import type { ClineProvider } from "../../../core/webview/ClineProvider"
import type { ExtensionContext, Uri } from "vscode"
import { ServerConfigSchema, McpHub } from "../McpHub"
import fs from "fs/promises"
import { vi, Mock } from "vitest"

// Mock fs/promises before importing anything that uses it
vi.mock("fs/promises", () => ({
	default: {
		access: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue("{}"),
		unlink: vi.fn().mockResolvedValue(undefined),
		rename: vi.fn().mockResolvedValue(undefined),
		lstat: vi.fn().mockImplementation(() =>
			Promise.resolve({
				isDirectory: () => true,
			}),
		),
		mkdir: vi.fn().mockResolvedValue(undefined),
	},
	access: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue("{}"),
	unlink: vi.fn().mockResolvedValue(undefined),
	rename: vi.fn().mockResolvedValue(undefined),
	lstat: vi.fn().mockImplementation(() =>
		Promise.resolve({
			isDirectory: () => true,
		}),
	),
	mkdir: vi.fn().mockResolvedValue(undefined),
}))

// Mock safeWriteJson
vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(async (filePath, data) => {
		// Instead of trying to write to the file system, just call fs.writeFile mock
		// This avoids the complex file locking and temp file operations
		return fs.writeFile(filePath, JSON.stringify(data), "utf8")
	}),
}))

vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn().mockReturnValue({
			onDidChange: vi.fn(),
			onDidCreate: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		}),
		onDidSaveTextDocument: vi.fn(),
		onDidChangeWorkspaceFolders: vi.fn(),
		workspaceFolders: [],
	},
	window: {
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn().mockReturnValue({
			dispose: vi.fn(),
		}),
	},
	Disposable: {
		from: vi.fn(),
	},
}))
vi.mock("fs/promises")
vi.mock("../../../core/webview/ClineProvider")

// Mock the MCP SDK modules
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn(),
	getDefaultEnvironment: vi.fn().mockReturnValue({ PATH: "/usr/bin" }),
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn(),
}))

describe("McpHub", () => {
	let mcpHub: McpHubType
	let mockProvider: Partial<ClineProvider>

	// Store original console methods
	const originalConsoleError = console.error
	const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")

	beforeEach(() => {
		vi.clearAllMocks()

		// Mock console.error to suppress error messages during tests
		console.error = vi.fn()


		const mockUri: Uri = {
			scheme: "file",
			authority: "",
			path: "/test/path",
			query: "",
			fragment: "",
			fsPath: "/test/path",
			with: vi.fn(),
			toJSON: vi.fn(),
		}

		mockProvider = {
			ensureSettingsDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
			ensureMcpServersDirectoryExists: vi.fn().mockResolvedValue("/mock/settings/path"),
			postMessageToWebview: vi.fn(),
			context: {
				subscriptions: [],
				workspaceState: {} as any,
				globalState: {} as any,
				secrets: {} as any,
				extensionUri: mockUri,
				extensionPath: "/test/path",
				storagePath: "/test/storage",
				globalStoragePath: "/test/global-storage",
				environmentVariableCollection: {} as any,
				extension: {
					id: "test-extension",
					extensionUri: mockUri,
					extensionPath: "/test/path",
					extensionKind: 1,
					isActive: true,
					packageJSON: {
						version: "1.0.0",
					},
					activate: vi.fn(),
					exports: undefined,
				} as any,
				asAbsolutePath: (path: string) => path,
				storageUri: mockUri,
				globalStorageUri: mockUri,
				logUri: mockUri,
				extensionMode: 1,
				logPath: "/test/path",
				languageModelAccessInformation: {} as any,
			} as ExtensionContext,
		}

		// Mock fs.readFile for initial settings
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						alwaysAllow: ["allowed-tool"],
						disabledTools: ["disabled-tool"],
					},
				},
			}),
		)

		mcpHub = new McpHub(mockProvider as ClineProvider)
	})

	afterEach(() => {
		// Restore original console methods
		console.error = originalConsoleError
		// Restore original platform
		if (originalPlatform) {
			Object.defineProperty(process, "platform", originalPlatform)
		}
	})

	describe("toggleToolAlwaysAllow", () => {
		it("should add tool to always allow list when enabling", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						alwaysAllow: [],
					},
				},
			}

			// Mock reading initial config
			vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

			// Set up mock connection without alwaysAllow
			const mockConnection: McpConnection = {
				server: {
					name: "test-server",
					type: "stdio",
					command: "node",
					args: ["test.js"],
					source: "global",
				} as any,
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			await mcpHub.toggleToolAlwaysAllow("test-server", "global", "new-tool", true)

			// Verify the config was updated correctly
			const writeCalls = vi.mocked(fs.writeFile).mock.calls
			expect(writeCalls.length).toBeGreaterThan(0)

			// Find the write call
			const callToUse = writeCalls[writeCalls.length - 1]
			expect(callToUse).toBeTruthy()

			// The path might be normalized differently on different platforms,
			// so we'll just check that we have a call with valid content
			const writtenConfig = JSON.parse(callToUse[1] as string)
			expect(writtenConfig.mcpServers).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"]).toBeDefined()
			expect(Array.isArray(writtenConfig.mcpServers["test-server"].alwaysAllow)).toBe(true)
			expect(writtenConfig.mcpServers["test-server"].alwaysAllow).toContain("new-tool")
		})

		it("should remove tool from always allow list when disabling", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						alwaysAllow: ["existing-tool"],
					},
				},
			}

			// Mock reading initial config
			vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

			// Set up mock connection
			const mockConnection: McpConnection = {
				server: {
					name: "test-server",
					type: "stdio",
					command: "node",
					args: ["test.js"],
					alwaysAllow: ["existing-tool"],
					source: "global",
				} as any,
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			await mcpHub.toggleToolAlwaysAllow("test-server", "global", "existing-tool", false)

			// Verify the config was updated correctly
			const writeCalls = vi.mocked(fs.writeFile).mock.calls
			expect(writeCalls.length).toBeGreaterThan(0)

			// Find the write call
			const callToUse = writeCalls[writeCalls.length - 1]
			expect(callToUse).toBeTruthy()

			// The path might be normalized differently on different platforms,
			// so we'll just check that we have a call with valid content
			const writtenConfig = JSON.parse(callToUse[1] as string)
			expect(writtenConfig.mcpServers).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"]).toBeDefined()
			expect(Array.isArray(writtenConfig.mcpServers["test-server"].alwaysAllow)).toBe(true)
			expect(writtenConfig.mcpServers["test-server"].alwaysAllow).not.toContain("existing-tool")
		})

		it("should initialize alwaysAllow if it does not exist", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
					},
				},
			}

			// Mock reading initial config
			vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

			// Set up mock connection
			const mockConnection: McpConnection = {
				server: {
					name: "test-server",
					type: "stdio",
					command: "node",
					args: ["test.js"],
					alwaysAllow: [],
					source: "global",
				} as any,
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			await mcpHub.toggleToolAlwaysAllow("test-server", "global", "new-tool", true)

			// Verify the config was updated with initialized alwaysAllow
			// Find the write call with the normalized path
			const normalizedSettingsPath = "/mock/settings/path/cline_mcp_settings.json"
			const writeCalls = vi.mocked(fs.writeFile).mock.calls

			// Find the write call with the normalized path
			const writeCall = writeCalls.find((call: any) => call[0] === normalizedSettingsPath)
			const callToUse = writeCall || writeCalls[0]

			const writtenConfig = JSON.parse(callToUse[1] as string)
			expect(writtenConfig.mcpServers["test-server"].alwaysAllow).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"].alwaysAllow).toContain("new-tool")
		})
	})

	describe("toggleToolEnabledForPrompt", () => {
		it("should add tool to disabledTools list when enabling", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						disabledTools: [],
					},
				},
			}

			// Set up mock connection
			const mockConnection: McpConnection = {
				server: {
					name: "test-server",
					config: "test-server-config",
					status: "connected",
					source: "global",
				},
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			// Mock reading initial config
			;(fs.readFile as Mock).mockResolvedValueOnce(JSON.stringify(mockConfig))

			await mcpHub.toggleToolEnabledForPrompt("test-server", "global", "new-tool", false)

			// Verify the config was updated correctly
			const writeCalls = (fs.writeFile as Mock).mock.calls
			expect(writeCalls.length).toBeGreaterThan(0)

			// Find the write call
			const callToUse = writeCalls[writeCalls.length - 1]
			expect(callToUse).toBeTruthy()

			// The path might be normalized differently on different platforms,
			// so we'll just check that we have a call with valid content
			const writtenConfig = JSON.parse(callToUse[1])
			expect(writtenConfig.mcpServers).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"]).toBeDefined()
			expect(Array.isArray(writtenConfig.mcpServers["test-server"].enabledForPrompt)).toBe(false)
			expect(writtenConfig.mcpServers["test-server"].disabledTools).toContain("new-tool")
		})

		it("should remove tool from disabledTools list when disabling", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						disabledTools: ["existing-tool"],
					},
				},
			}

			// Set up mock connection
			const mockConnection: McpConnection = {
				server: {
					name: "test-server",
					config: "test-server-config",
					status: "connected",
					source: "global",
				},
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			// Mock reading initial config
			;(fs.readFile as Mock).mockResolvedValueOnce(JSON.stringify(mockConfig))

			await mcpHub.toggleToolEnabledForPrompt("test-server", "global", "existing-tool", true)

			// Verify the config was updated correctly
			const writeCalls = (fs.writeFile as Mock).mock.calls
			expect(writeCalls.length).toBeGreaterThan(0)

			// Find the write call
			const callToUse = writeCalls[writeCalls.length - 1]
			expect(callToUse).toBeTruthy()

			// The path might be normalized differently on different platforms,
			// so we'll just check that we have a call with valid content
			const writtenConfig = JSON.parse(callToUse[1])
			expect(writtenConfig.mcpServers).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"]).toBeDefined()
			expect(Array.isArray(writtenConfig.mcpServers["test-server"].enabledForPrompt)).toBe(false)
			expect(writtenConfig.mcpServers["test-server"].disabledTools).not.toContain("existing-tool")
		})

		it("should initialize disabledTools if it does not exist", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
					},
				},
			}

			// Set up mock connection
			const mockConnection: McpConnection = {
				server: {
					name: "test-server",
					config: "test-server-config",
					status: "connected",
					source: "global",
				},
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			// Mock reading initial config
			;(fs.readFile as Mock).mockResolvedValueOnce(JSON.stringify(mockConfig))

			// Call with false because of "true" is default value
			await mcpHub.toggleToolEnabledForPrompt("test-server", "global", "new-tool", false)

			// Verify the config was updated with initialized disabledTools
			// Find the write call with the normalized path
			const normalizedSettingsPath = "/mock/settings/path/cline_mcp_settings.json"
			const writeCalls = (fs.writeFile as Mock).mock.calls

			// Find the write call with the normalized path
			const writeCall = writeCalls.find((call) => call[0] === normalizedSettingsPath)
			const callToUse = writeCall || writeCalls[0]

			const writtenConfig = JSON.parse(callToUse[1])
			expect(writtenConfig.mcpServers["test-server"].disabledTools).toBeDefined()
			expect(writtenConfig.mcpServers["test-server"].disabledTools).toContain("new-tool")
		})
	})

	describe("server disabled state", () => {
		it("should toggle server disabled state", async () => {
			const mockConfig = {
				mcpServers: {
					"test-server": {
						type: "stdio",
						command: "node",
						args: ["test.js"],
						disabled: false,
					},
				},
			}

			// Mock reading initial config
			vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

			// Set up mock connection
			const mockConnection: McpConnection = {
				server: {
					name: "test-server",
					type: "stdio",
					command: "node",
					args: ["test.js"],
					disabled: false,
					source: "global",
				} as any,
				client: {} as any,
				transport: {} as any,
			}
			mcpHub.connections = [mockConnection]

			await mcpHub.toggleServerDisabled("test-server", true)

			// Verify the config was updated correctly
			// Find the write call with the normalized path
			const normalizedSettingsPath = "/mock/settings/path/cline_mcp_settings.json"
			const writeCalls = vi.mocked(fs.writeFile).mock.calls

			// Find the write call with the normalized path
			const writeCall = writeCalls.find((call: any) => call[0] === normalizedSettingsPath)
			const callToUse = writeCall || writeCalls[0]

			const writtenConfig = JSON.parse(callToUse[1] as string)
			expect(writtenConfig.mcpServers["test-server"].disabled).toBe(true)
		})

		it("should filter out disabled servers from getServers", () => {
			const mockConnections: McpConnection[] = [
				{
					server: {
						name: "enabled-server",
						config: "{}",
						status: "connected",
						disabled: false,
					},
					client: {} as any,
					transport: {} as any,
				},
				{
					server: {
						name: "disabled-server",
						config: "{}",
						status: "connected",
						disabled: true,
					},
					client: {} as any,
					transport: {} as any,
				},
			]

			mcpHub.connections = mockConnections
			const servers = mcpHub.getServers()

			expect(servers.length).toBe(1)
			expect(servers[0].name).toBe("enabled-server")
		})

		it("should prevent calling tools on disabled servers", async () => {
			const mockConnection: McpConnection = {
				server: {
					name: "disabled-server",
					config: "{}",
					status: "connected",
					disabled: true,
				},
				client: {
					request: vi.fn().mockResolvedValue({ result: "success" }),
				} as any,
				transport: {} as any,
			}

			mcpHub.connections = [mockConnection]

			await expect(mcpHub.callTool("disabled-server", "some-tool", {})).rejects.toThrow(
				'Server "disabled-server" is disabled and cannot be used',
			)
		})

		it("should prevent reading resources from disabled servers", async () => {
			const mockConnection: McpConnection = {
				server: {
					name: "disabled-server",
					config: "{}",
					status: "connected",
					disabled: true,
				},
				client: {
					request: vi.fn(),
				} as any,
				transport: {} as any,
			}

			mcpHub.connections = [mockConnection]

			await expect(mcpHub.readResource("disabled-server", "some/uri")).rejects.toThrow(
				'Server "disabled-server" is disabled',
			)
		})
	})

	describe("callTool", () => {
		it("should execute tool successfully", async () => {
			// Mock the connection with a minimal client implementation
			const mockConnection: McpConnection = {
				server: {
					name: "test-server",
					config: JSON.stringify({}),
					status: "connected" as const,
				},
				client: {
					request: vi.fn().mockResolvedValue({ result: "success" }),
				} as any,
				transport: {
					start: vi.fn(),
					close: vi.fn(),
					stderr: { on: vi.fn() },
				} as any,
			}

			mcpHub.connections = [mockConnection]

			await mcpHub.callTool("test-server", "some-tool", {})

			// Verify the request was made with correct parameters
			expect(mockConnection.client.request).toHaveBeenCalledWith(
				{
					method: "tools/call",
					params: {
						name: "some-tool",
						arguments: {},
					},
				},
				expect.any(Object),
				expect.objectContaining({ timeout: 60000 }), // Default 60 second timeout
			)
		})

		it("should throw error if server not found", async () => {
			await expect(mcpHub.callTool("non-existent-server", "some-tool", {})).rejects.toThrow(
				"No connection found for server: non-existent-server",
			)
		})

		describe("timeout configuration", () => {
			it("should validate timeout values", () => {
				// Test valid timeout values
				const validConfig = {
					type: "stdio",
					command: "test",
					timeout: 60,
				}
				expect(() => ServerConfigSchema.parse(validConfig)).not.toThrow()

				// Test invalid timeout values
				const invalidConfigs = [
					{ type: "stdio", command: "test", timeout: 0 }, // Too low
					{ type: "stdio", command: "test", timeout: 3601 }, // Too high
					{ type: "stdio", command: "test", timeout: -1 }, // Negative
				]

				invalidConfigs.forEach((config) => {
					expect(() => ServerConfigSchema.parse(config)).toThrow()
				})
			})

			it("should use default timeout of 60 seconds if not specified", async () => {
				const mockConnection: McpConnection = {
					server: {
						name: "test-server",
						config: JSON.stringify({ type: "stdio", command: "test" }), // No timeout specified
						status: "connected",
					},
					client: {
						request: vi.fn().mockResolvedValue({ content: [] }),
					} as any,
					transport: {} as any,
				}

				mcpHub.connections = [mockConnection]
				await mcpHub.callTool("test-server", "test-tool")

				expect(mockConnection.client.request).toHaveBeenCalledWith(
					expect.anything(),
					expect.anything(),
					expect.objectContaining({ timeout: 60000 }), // 60 seconds in milliseconds
				)
			})

			it("should apply configured timeout to tool calls", async () => {
				const mockConnection: McpConnection = {
					server: {
						name: "test-server",
						config: JSON.stringify({ type: "stdio", command: "test", timeout: 120 }), // 2 minutes
						status: "connected",
					},
					client: {
						request: vi.fn().mockResolvedValue({ content: [] }),
					} as any,
					transport: {} as any,
				}

				mcpHub.connections = [mockConnection]
				await mcpHub.callTool("test-server", "test-tool")

				expect(mockConnection.client.request).toHaveBeenCalledWith(
					expect.anything(),
					expect.anything(),
					expect.objectContaining({ timeout: 120000 }), // 120 seconds in milliseconds
				)
			})
		})

		describe("updateServerTimeout", () => {
			it("should update server timeout in settings file", async () => {
				const mockConfig = {
					mcpServers: {
						"test-server": {
							type: "stdio",
							command: "node",
							args: ["test.js"],
							timeout: 60,
						},
					},
				}

				// Mock reading initial config
				vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

				// Set up mock connection
				const mockConnection: McpConnection = {
					server: {
						name: "test-server",
						type: "stdio",
						command: "node",
						args: ["test.js"],
						timeout: 60,
						source: "global",
					} as any,
					client: {} as any,
					transport: {} as any,
				}
				mcpHub.connections = [mockConnection]

				await mcpHub.updateServerTimeout("test-server", 120)

				// Verify the config was updated correctly
				// Find the write call with the normalized path
				const normalizedSettingsPath = "/mock/settings/path/cline_mcp_settings.json"
				const writeCalls = vi.mocked(fs.writeFile).mock.calls

				// Find the write call with the normalized path
				const writeCall = writeCalls.find((call: any) => call[0] === normalizedSettingsPath)
				const callToUse = writeCall || writeCalls[0]

				const writtenConfig = JSON.parse(callToUse[1] as string)
				expect(writtenConfig.mcpServers["test-server"].timeout).toBe(120)
			})

			it("should fallback to default timeout when config has invalid timeout", async () => {
				const mockConfig = {
					mcpServers: {
						"test-server": {
							type: "stdio",
							command: "node",
							args: ["test.js"],
							timeout: 60,
						},
					},
				}

				// Mock initial read
				vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

				// Set up mock connection before updating
				const mockConnectionInitial: McpConnection = {
					server: {
						name: "test-server",
						type: "stdio",
						command: "node",
						args: ["test.js"],
						timeout: 60,
						source: "global",
					} as any,
					client: {
						request: vi.fn().mockResolvedValue({ content: [] }),
					} as any,
					transport: {} as any,
				}
				mcpHub.connections = [mockConnectionInitial]

				// Update with invalid timeout
				await mcpHub.updateServerTimeout("test-server", 3601)

				// Config is written
				expect(fs.writeFile).toHaveBeenCalled()

				// Setup connection with invalid timeout
				const mockConnectionInvalid: McpConnection = {
					server: {
						name: "test-server",
						config: JSON.stringify({
							type: "stdio",
							command: "node",
							args: ["test.js"],
							timeout: 3601, // Invalid timeout
						}),
						status: "connected",
					},
					client: {
						request: vi.fn().mockResolvedValue({ content: [] }),
					} as any,
					transport: {} as any,
				}

				mcpHub.connections = [mockConnectionInvalid]

				// Call tool - should use default timeout
				await mcpHub.callTool("test-server", "test-tool")

				// Verify default timeout was used
				expect(mockConnectionInvalid.client.request).toHaveBeenCalledWith(
					expect.anything(),
					expect.anything(),
					expect.objectContaining({ timeout: 60000 }), // Default 60 seconds
				)
			})

			it("should accept valid timeout values", async () => {
				const mockConfig = {
					mcpServers: {
						"test-server": {
							type: "stdio",
							command: "node",
							args: ["test.js"],
							timeout: 60,
						},
					},
				}

				vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

				// Set up mock connection
				const mockConnection: McpConnection = {
					server: {
						name: "test-server",
						type: "stdio",
						command: "node",
						args: ["test.js"],
						timeout: 60,
						source: "global",
					} as any,
					client: {} as any,
					transport: {} as any,
				}
				mcpHub.connections = [mockConnection]

				// Test valid timeout values
				const validTimeouts = [1, 60, 3600]
				for (const timeout of validTimeouts) {
					await mcpHub.updateServerTimeout("test-server", timeout)
					expect(fs.writeFile).toHaveBeenCalled()
					vi.clearAllMocks() // Reset for next iteration
					;(fs.readFile as any).mockResolvedValueOnce(JSON.stringify(mockConfig))
				}
			})

			it("should notify webview after updating timeout", async () => {
				const mockConfig = {
					mcpServers: {
						"test-server": {
							type: "stdio",
							command: "node",
							args: ["test.js"],
							timeout: 60,
						},
					},
				}

				vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockConfig))

				// Set up mock connection
				const mockConnection: McpConnection = {
					server: {
						name: "test-server",
						type: "stdio",
						command: "node",
						args: ["test.js"],
						timeout: 60,
						source: "global",
					} as any,
					client: {} as any,
					transport: {} as any,
				}
				mcpHub.connections = [mockConnection]

				await mcpHub.updateServerTimeout("test-server", 120)

				expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith(
					expect.objectContaining({
						type: "mcpServers",
					}),
				)
			})
		})
	})

	describe("Windows command wrapping", () => {
		let StdioClientTransport: ReturnType<typeof vi.fn>
		let Client: ReturnType<typeof vi.fn>

		beforeEach(async () => {
			// Reset mocks
			vi.clearAllMocks()

			// Get references to the mocked constructors
			const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js")
			const clientModule = await import("@modelcontextprotocol/sdk/client/index.js")
			StdioClientTransport = stdioModule.StdioClientTransport as ReturnType<typeof vi.fn>
			Client = clientModule.Client as ReturnType<typeof vi.fn>

			// Mock Windows platform
			Object.defineProperty(process, "platform", {
				value: "win32",
				writable: true,
				enumerable: true,
				configurable: true,
			})
		})

		it("should wrap commands with cmd.exe on Windows", async () => {
			// Mock StdioClientTransport
			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation((config: any) => {
				// Verify that cmd.exe wrapping is applied
				expect(config.command).toBe("cmd.exe")
				expect(config.args).toEqual([
					"/c",
					"npx",
					"-y",
					"@modelcontextprotocol/server-filesystem",
					"/test/path",
				])
				return mockTransport
			})

			// Mock Client
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// Create a new McpHub instance
			const mcpHub = new McpHub(mockProvider as ClineProvider)

			// Mock the config file read
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"test-npx-server": {
							command: "npx",
							args: ["-y", "@modelcontextprotocol/server-filesystem", "/test/path"],
						},
					},
				}),
			)

			// Initialize servers (this will trigger connectToServer)
			await mcpHub["initializeGlobalMcpServers"]()

			// Verify StdioClientTransport was called with wrapped command
			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "cmd.exe",
					args: ["/c", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/test/path"],
				}),
			)
		})

		it("should not wrap commands on non-Windows platforms", async () => {
			// Mock non-Windows platform
			Object.defineProperty(process, "platform", {
				value: "darwin",
				writable: true,
				enumerable: true,
				configurable: true,
			})

			// Mock StdioClientTransport
			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation((config: any) => {
				// Verify that no cmd.exe wrapping is applied
				expect(config.command).toBe("npx")
				expect(config.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/test/path"])
				return mockTransport
			})

			// Mock Client
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// Create a new McpHub instance
			const mcpHub = new McpHub(mockProvider as ClineProvider)

			// Mock the config file read
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"test-npx-server": {
							command: "npx",
							args: ["-y", "@modelcontextprotocol/server-filesystem", "/test/path"],
						},
					},
				}),
			)

			// Initialize servers (this will trigger connectToServer)
			await mcpHub["initializeGlobalMcpServers"]()

			// Verify StdioClientTransport was called without wrapping
			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-filesystem", "/test/path"],
				}),
			)
		})

		it("should not double-wrap commands that are already cmd.exe", async () => {
			// Mock Windows platform
			Object.defineProperty(process, "platform", {
				value: "win32",
				writable: true,
				enumerable: true,
				configurable: true,
			})

			// Mock StdioClientTransport
			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation((config: any) => {
				// Verify that cmd.exe is not double-wrapped
				expect(config.command).toBe("cmd.exe")
				expect(config.args).toEqual(["/c", "echo", "test"])
				return mockTransport
			})

			// Mock Client
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// Create a new McpHub instance
			const mcpHub = new McpHub(mockProvider as ClineProvider)

			// Mock the config file read with cmd.exe already as command
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"test-cmd-server": {
							command: "cmd.exe",
							args: ["/c", "echo", "test"],
						},
					},
				}),
			)

			// Initialize servers (this will trigger connectToServer)
			await mcpHub["initializeGlobalMcpServers"]()

			// Verify StdioClientTransport was called without double-wrapping
			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "cmd.exe",
					args: ["/c", "echo", "test"],
				}),
			)
		})

		it("should handle npx.ps1 scenario from node version managers", async () => {
			// Mock Windows platform
			Object.defineProperty(process, "platform", {
				value: "win32",
				writable: true,
				enumerable: true,
				configurable: true,
			})

			// Mock StdioClientTransport to simulate the ENOENT error without wrapping
			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			let callCount = 0
			StdioClientTransport.mockImplementation((config: any) => {
				callCount++
				// First call would fail with ENOENT if not wrapped
				// Second call should be wrapped with cmd.exe
				if (callCount === 1) {
					// This simulates what would happen without wrapping
					expect(config.command).toBe("cmd.exe")
					expect(config.args[0]).toBe("/c")
					expect(config.args[1]).toBe("npx")
				}
				return mockTransport
			})

			// Mock Client
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// Create a new McpHub instance
			const mcpHub = new McpHub(mockProvider as ClineProvider)

			// Mock the config file read - simulating fnm/nvm-windows scenario
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"test-fnm-npx-server": {
							command: "npx",
							args: ["-y", "@modelcontextprotocol/server-example"],
							env: {
								// Simulate fnm environment
								FNM_DIR: "C:\\Users\\test\\.fnm",
								FNM_NODE_DIST_MIRROR: "https://nodejs.org/dist",
								FNM_ARCH: "x64",
							},
						},
					},
				}),
			)

			// Initialize servers (this will trigger connectToServer)
			await mcpHub["initializeGlobalMcpServers"]()

			// Verify that the command was wrapped with cmd.exe
			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "cmd.exe",
					args: ["/c", "npx", "-y", "@modelcontextprotocol/server-example"],
					env: expect.objectContaining({
						FNM_DIR: "C:\\Users\\test\\.fnm",
						FNM_NODE_DIST_MIRROR: "https://nodejs.org/dist",
						FNM_ARCH: "x64",
					}),
				}),
			)
		})

		it("should handle case-insensitive cmd command check", async () => {
			// Mock Windows platform
			Object.defineProperty(process, "platform", {
				value: "win32",
				writable: true,
				enumerable: true,
				configurable: true,
			})

			// Mock StdioClientTransport
			const mockTransport = {
				start: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				stderr: {
					on: vi.fn(),
				},
				onerror: null,
				onclose: null,
			}

			StdioClientTransport.mockImplementation((config: any) => {
				// Verify that CMD (uppercase) is not double-wrapped
				expect(config.command).toBe("CMD")
				expect(config.args).toEqual(["/c", "echo", "test"])
				return mockTransport
			})

			// Mock Client
			Client.mockImplementation(() => ({
				connect: vi.fn().mockResolvedValue(undefined),
				close: vi.fn().mockResolvedValue(undefined),
				getInstructions: vi.fn().mockReturnValue("test instructions"),
				request: vi.fn().mockResolvedValue({ tools: [], resources: [], resourceTemplates: [] }),
			}))

			// Create a new McpHub instance
			const mcpHub = new McpHub(mockProvider as ClineProvider)

			// Mock the config file read with CMD (uppercase) as command
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						"test-cmd-uppercase-server": {
							command: "CMD",
							args: ["/c", "echo", "test"],
						},
					},
				}),
			)

			// Initialize servers (this will trigger connectToServer)
			await mcpHub["initializeGlobalMcpServers"]()

			// Verify StdioClientTransport was called without double-wrapping
			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "CMD",
					args: ["/c", "echo", "test"],
				}),
			)
		})
	})
})
