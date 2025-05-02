import { ExtensionMessage } from "@shared/ExtensionMessage"
import { DEFAULT_MCP_TIMEOUT_SECONDS } from "@shared/mcp"
import { describe, it } from "mocha"
import proxyquire from "proxyquire"
import "should"

describe("McpHub Command Transformation", () => {
	let mcpHub: any
	let lastTransportOptions: any
	let currentPlatform = "darwin"

	// Setup test doubles
	const StdioTransportDouble = function (options: any) {
		lastTransportOptions = options
		return {
			onerror: null,
			onclose: null,
			close: async () => {},
			start: async () => {},
			stderr: { on: () => {} },
		}
	}

	// Helper to create McpHub instance
	const createMcpHub = () => {
		const getMcpServersPath = () => Promise.resolve("/test/path")
		const getSettingsDirectoryPath = () => Promise.resolve("/test/settings")
		const postMessageToWebview = async (_: ExtensionMessage) => {}
		const clientVersion = "1.0.0"

		// Mock dependencies
		const McpHubModule = proxyquire("../../../services/mcp/McpHub", {
			os: {
				platform: () => currentPlatform,
			},
			"@modelcontextprotocol/sdk/client/stdio.js": {
				StdioClientTransport: StdioTransportDouble,
			},
		}).McpHub

		return new McpHubModule(getMcpServersPath, getSettingsDirectoryPath, postMessageToWebview, clientVersion)
	}

	beforeEach(() => {
		lastTransportOptions = null
		mcpHub = createMcpHub()
	})

	describe("npx command handling", () => {
		it("transforms npx command on Windows", async () => {
			currentPlatform = "win32"
			const config = {
				command: "npx",
				args: ["-y", "kusto-mcp"],
				transportType: "stdio" as const,
				timeout: DEFAULT_MCP_TIMEOUT_SECONDS,
			}

			await mcpHub.connectToServer("test-server", config)

			lastTransportOptions.command.should.equal("cmd")
			lastTransportOptions.args.should.deepEqual(["/c", "npx", "-y", "kusto-mcp"])
			lastTransportOptions.should.have.property("stderr", "pipe")
		})

		it("leaves npx command unchanged on non-Windows", async () => {
			currentPlatform = "darwin"
			const config = {
				command: "npx",
				args: ["-y", "kusto-mcp"],
				transportType: "stdio" as const,
				timeout: DEFAULT_MCP_TIMEOUT_SECONDS,
			}

			await mcpHub.connectToServer("test-server", config)

			lastTransportOptions.command.should.equal("npx")
			lastTransportOptions.args.should.deepEqual(["-y", "kusto-mcp"])
			lastTransportOptions.should.have.property("stderr", "pipe")
		})

		it("handles undefined args on Windows", async () => {
			currentPlatform = "win32"
			const config = {
				command: "npx",
				transportType: "stdio" as const,
				timeout: DEFAULT_MCP_TIMEOUT_SECONDS,
			}

			await mcpHub.connectToServer("test-server", config)

			lastTransportOptions.command.should.equal("cmd")
			lastTransportOptions.args.should.deepEqual(["/c", "npx"])
			lastTransportOptions.should.have.property("stderr", "pipe")
		})

		it("preserves non-npx commands on Windows", async () => {
			currentPlatform = "win32"
			const config = {
				command: "other-command",
				args: ["arg1", "arg2"],
				transportType: "stdio" as const,
				timeout: DEFAULT_MCP_TIMEOUT_SECONDS,
			}

			await mcpHub.connectToServer("test-server", config)

			lastTransportOptions.command.should.equal("other-command")
			lastTransportOptions.args.should.deepEqual(["arg1", "arg2"])
			lastTransportOptions.should.have.property("stderr", "pipe")
		})
	})
})
