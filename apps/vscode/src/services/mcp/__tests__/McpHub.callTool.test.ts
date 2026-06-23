import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { McpHub } from "../McpHub"

/**
 * Unit tests for McpHub.callTool() method.
 *
 * Focuses on the fix: `arguments: toolArguments ?? {}` ensuring that
 * undefined toolArguments are sent as an empty object `{}` to comply
 * with MCP SDK's Zod validation (ZodRecord<ZodString, ZodUnknown>).
 *
 * These tests exercise the real `McpHub.callTool` method by building a
 * partially-initialized `McpHub` instance (bypassing the constructor's
 * filesystem side-effects) and injecting only the state `callTool`
 * actually touches: `connections` and `telemetryService`.
 */

/** Minimal mock for MCP Client.request() */
function createMockClient(responseOverride?: any) {
	return {
		request: sinon.stub().resolves(
			responseOverride ?? {
				content: [{ type: "text", text: "success" }],
			},
		),
	}
}

/** Minimal mock for TelemetryService */
function createMockTelemetryService() {
	return {
		captureMcpToolCall: sinon.stub(),
	}
}

/**
 * Build a real `McpHub` instance without triggering the constructor's
 * filesystem watchers / server-initialization side effects, then inject
 * the minimum state required by `callTool`.
 *
 * We use `Object.create(McpHub.prototype)` so that invoking `hub.callTool`
 * dispatches to the actual production implementation rather than a
 * re-implementation.
 */
function createMcpHub(
	options: { client?: ReturnType<typeof createMockClient>; serverName?: string; disabled?: boolean; config?: string } = {},
) {
	const client = options.client ?? createMockClient()
	const serverName = options.serverName ?? "test-server"
	const telemetryService = createMockTelemetryService()

	const connection = {
		server: {
			name: serverName,
			config: options.config ?? JSON.stringify({ type: "stdio", command: "test", timeout: 60 }),
			status: "connected",
			disabled: options.disabled ?? false,
		},
		client,
		transport: {},
	}

	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).telemetryService = telemetryService
	;(hub as any).connections = [connection]

	return { hub, client, telemetryService, connection }
}

describe("McpHub.callTool", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	// ── Core fix: undefined arguments → empty object ────────────────────

	describe("arguments fallback to empty object", () => {
		it("should pass empty object {} when toolArguments is undefined", async () => {
			const { hub, client } = createMcpHub()

			await hub.callTool("test-server", "list_pages", undefined, "ulid-001")

			client.request.calledOnce.should.be.true()
			const requestArgs = client.request.firstCall.args[0]
			requestArgs.params.arguments.should.deepEqual({})
		})

		it("should pass the provided arguments object when toolArguments is defined", async () => {
			const { hub, client } = createMcpHub()
			const args = { url: "https://example.com", verbose: true }

			await hub.callTool("test-server", "navigate_page", args, "ulid-002")

			client.request.calledOnce.should.be.true()
			const requestArgs = client.request.firstCall.args[0]
			requestArgs.params.arguments.should.deepEqual({ url: "https://example.com", verbose: true })
		})

		it("should pass empty object {} when toolArguments is explicitly passed as undefined", async () => {
			const { hub, client } = createMcpHub()

			await hub.callTool("test-server", "take_screenshot", undefined, "ulid-003")

			const requestArgs = client.request.firstCall.args[0]
			requestArgs.params.arguments.should.deepEqual({})
			// Ensure it's an object, not null or undefined
			;(typeof requestArgs.params.arguments).should.equal("object")
			;(requestArgs.params.arguments === null).should.be.false()
		})

		it("should preserve arguments with falsy values inside the object", async () => {
			const { hub, client } = createMcpHub()
			const args = { enabled: false, count: 0, name: "" }

			await hub.callTool("test-server", "configure", args, "ulid-004")

			const requestArgs = client.request.firstCall.args[0]
			requestArgs.params.arguments.should.deepEqual({ enabled: false, count: 0, name: "" })
		})

		it("should pass an already-empty object through unchanged", async () => {
			const { hub, client } = createMcpHub()

			await hub.callTool("test-server", "list_pages", {}, "ulid-005")

			const requestArgs = client.request.firstCall.args[0]
			requestArgs.params.arguments.should.deepEqual({})
		})
	})

	// ── Request structure validation ────────────────────────────────────

	describe("request structure", () => {
		it("should always include method 'tools/call' in the request", async () => {
			const { hub, client } = createMcpHub()

			await hub.callTool("test-server", "any_tool", undefined, "ulid-006")

			const requestArgs = client.request.firstCall.args[0]
			requestArgs.method.should.equal("tools/call")
		})

		it("should set the tool name in params.name", async () => {
			const { hub, client } = createMcpHub()

			await hub.callTool("test-server", "list_pages", undefined, "ulid-007")

			const requestArgs = client.request.firstCall.args[0]
			requestArgs.params.name.should.equal("list_pages")
		})

		it("should pass timeout in request options", async () => {
			const { hub, client } = createMcpHub()

			await hub.callTool("test-server", "slow_tool", { query: "test" }, "ulid-008")

			const requestOptions = client.request.firstCall.args[2]
			requestOptions.should.have.property("timeout")
			requestOptions.timeout.should.be.a.Number()
			requestOptions.timeout.should.be.above(0)
		})
	})

	// ── Error handling ──────────────────────────────────────────────────

	describe("error handling", () => {
		it("should throw when server connection is not found", async () => {
			const { hub } = createMcpHub({ serverName: "existing-server" })

			let threw = false
			try {
				await hub.callTool("nonexistent-server", "some_tool", undefined, "ulid-009")
			} catch (error: any) {
				threw = true
				error.message.should.containEql("No connection found for server: nonexistent-server")
			}
			threw.should.be.true()
		})

		it("should throw when server is disabled", async () => {
			const { hub } = createMcpHub({ disabled: true })

			let threw = false
			try {
				await hub.callTool("test-server", "some_tool", undefined, "ulid-010")
			} catch (error: any) {
				threw = true
				error.message.should.containEql("disabled")
			}
			threw.should.be.true()
		})

		it("should capture error telemetry when client.request fails", async () => {
			const client = createMockClient()
			client.request.rejects(new Error("Network timeout"))
			const { hub, telemetryService } = createMcpHub({ client })

			let threw = false
			try {
				await hub.callTool("test-server", "failing_tool", { key: "value" }, "ulid-011")
			} catch {
				threw = true
			}

			threw.should.be.true()
			telemetryService.captureMcpToolCall.calledTwice.should.be.true()

			// First call: "started"
			const startedCall = telemetryService.captureMcpToolCall.firstCall.args
			startedCall[3].should.equal("started")

			// Second call: "error"
			const errorCall = telemetryService.captureMcpToolCall.secondCall.args
			errorCall[3].should.equal("error")
			errorCall[4].should.equal("Network timeout")
		})
	})

	// ── Telemetry ───────────────────────────────────────────────────────

	describe("telemetry", () => {
		it("should capture 'started' telemetry before request and 'success' after", async () => {
			const { hub, telemetryService } = createMcpHub()

			await hub.callTool("test-server", "list_pages", undefined, "ulid-012")

			telemetryService.captureMcpToolCall.calledTwice.should.be.true()
			telemetryService.captureMcpToolCall.firstCall.args[3].should.equal("started")
			telemetryService.captureMcpToolCall.secondCall.args[3].should.equal("success")
		})

		it("should report undefined for argument keys when toolArguments is undefined", async () => {
			const { hub, telemetryService } = createMcpHub()

			await hub.callTool("test-server", "list_pages", undefined, "ulid-013")

			// Both started and success should report undefined argument keys
			const startedArgKeys = telemetryService.captureMcpToolCall.firstCall.args[5]
			should(startedArgKeys).be.undefined()

			const successArgKeys = telemetryService.captureMcpToolCall.secondCall.args[5]
			should(successArgKeys).be.undefined()
		})

		it("should report argument keys when toolArguments is provided", async () => {
			const { hub, telemetryService } = createMcpHub()

			await hub.callTool("test-server", "navigate", { url: "https://x.com", timeout: 5000 }, "ulid-014")

			const startedArgKeys = telemetryService.captureMcpToolCall.firstCall.args[5]
			startedArgKeys.should.deepEqual(["url", "timeout"])
		})
	})

	// ── Response handling ───────────────────────────────────────────────

	describe("response handling", () => {
		it("should return content array from successful response", async () => {
			const client = createMockClient({
				content: [{ type: "text", text: "page list result" }],
			})
			const { hub } = createMcpHub({ client })

			const result = await hub.callTool("test-server", "list_pages", undefined, "ulid-015")

			result.content.should.be.an.Array()
			result.content.should.have.length(1)
			;(result.content[0] as { type: "text"; text: string }).text.should.equal("page list result")
		})

		it("should default content to empty array when response content is undefined", async () => {
			const client = createMockClient({ content: undefined })
			const { hub } = createMcpHub({ client })

			const result = await hub.callTool("test-server", "list_pages", undefined, "ulid-016")

			result.content.should.be.an.Array()
			result.content.should.have.length(0)
		})
	})
})
