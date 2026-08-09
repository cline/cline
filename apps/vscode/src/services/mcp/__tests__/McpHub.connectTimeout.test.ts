import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StateManager } from "@core/storage/StateManager"
import sinon from "sinon"
import { McpHub } from "../McpHub"

/**
 * Connect/initialize budget policy, driven through the real connectToServer
 * path with real child processes (no stubbed clients or transports):
 *
 * - A stdio server with no explicit `timeout` must fail initialize after the
 *   3s connect budget (SDK core's DEFAULT_MCP_CONNECT_TIMEOUT_MS), not the
 *   60s request default, with the actionable timeout message surfaced on the
 *   server entry the MCP settings UI renders.
 * - An explicit `timeout` overrides the budget in either direction: a low
 *   value fails a hung server even faster, a high value lets a slow starter
 *   connect.
 * - A fast server with no `timeout` still connects normally.
 */

/**
 * Minimal newline-delimited stdio MCP server. Responds to initialize and
 * tools/list; MCP_STARTUP_DELAY_MS simulates a slow-starting server by
 * buffering requests and answering only after the delay.
 */
const TINY_MCP_SERVER_SOURCE = `
const readline = require("node:readline")
const delayMs = Number(process.env.MCP_STARTUP_DELAY_MS || "0")
const rl = readline.createInterface({ input: process.stdin })
const reply = (payload) => process.stdout.write(JSON.stringify(payload) + "\\n")
const handle = (line) => {
	if (!line.trim()) {
		return
	}
	const msg = JSON.parse(line)
	if (msg.method === "initialize") {
		reply({
			jsonrpc: "2.0",
			id: msg.id,
			result: {
				protocolVersion: msg.params.protocolVersion,
				capabilities: { tools: {} },
				serverInfo: { name: "tiny-test-server", version: "1.0.0" },
			},
		})
	} else if (msg.method === "tools/list") {
		reply({
			jsonrpc: "2.0",
			id: msg.id,
			result: { tools: [{ name: "echo", description: "Echoes input", inputSchema: { type: "object" } }] },
		})
	} else if (msg.id !== undefined) {
		reply({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } })
	}
}
if (delayMs > 0) {
	const buffered = []
	const buffer = (line) => buffered.push(line)
	rl.on("line", buffer)
	setTimeout(() => {
		rl.off("line", buffer)
		for (const line of buffered) {
			handle(line)
		}
		rl.on("line", handle)
	}, delayMs)
} else {
	rl.on("line", handle)
}
`

describe("McpHub connect timeout policy", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let serverScriptPath: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		sandbox.stub(StateManager, "get").returns({
			getRemoteConfigSettings: () => ({}),
		} as unknown as StateManager)
		tempDir = await mkdtemp(join(tmpdir(), "mcp-connect-timeout-"))
		serverScriptPath = join(tempDir, "tiny-mcp-server.js")
		await writeFile(serverScriptPath, TINY_MCP_SERVER_SOURCE, "utf8")
		await writeFile(join(tempDir, "cline_mcp_settings.json"), JSON.stringify({ mcpServers: {} }), "utf8")
	})

	afterEach(async () => {
		sandbox.restore()
		await rm(tempDir, { recursive: true, force: true })
	})

	function createHub() {
		const hub = Object.create(McpHub.prototype) as McpHub
		;(hub as any).connections = []
		;(hub as any).isConnecting = false
		;(hub as any).clientVersion = "0.0.0"
		;(hub as any).getSettingsDirectoryPath = async () => tempDir
		;(hub as any).pendingNotifications = []
		// deleteConnection touches the list_changed refresh bookkeeping, which is
		// normally set up by field initializers that Object.create bypasses.
		;(hub as any).listChangedRefreshTimers = new Map()
		;(hub as any).listChangedRefreshInFlight = new Map()
		;(hub as any).listChangedRefreshGeneration = new Map()
		;(hub as any).listChangedRefreshDeadlines = new Map()
		// Plain instance override (not a sandbox stub): killed child processes
		// fire transport onclose/onerror after the test body ends, and a
		// restored stub would let those late events hit the real
		// notifyWebviewOfServerChanges against the removed temp dir.
		;(hub as any).notifyWebviewOfServerChanges = async () => {}
		return hub
	}

	async function deleteAllConnections(hub: McpHub) {
		for (const conn of [...(hub as any).connections]) {
			await (hub as any).deleteConnection(conn.server.name)
		}
	}

	function hungServerConfig(timeout?: number) {
		return {
			type: "stdio" as const,
			command: "sh",
			args: ["-c", "cat > /dev/null"],
			autoApprove: [],
			disabled: false,
			...(timeout !== undefined ? { timeout } : {}),
		}
	}

	function tinyServerConfig(options: { startupDelayMs?: number; timeout?: number } = {}) {
		return {
			type: "stdio" as const,
			command: "node",
			args: [serverScriptPath],
			env: options.startupDelayMs ? { MCP_STARTUP_DELAY_MS: String(options.startupDelayMs) } : undefined,
			autoApprove: [],
			disabled: false,
			...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
		}
	}

	it("fails a hung stdio server with no timeout after the 3s connect budget, not 60s", async () => {
		const hub = createHub()
		const startedAt = Date.now()

		await expect((hub as any).connectToServer("hung-server", hungServerConfig(), "internal")).rejects.toThrow(
			/timed out after 3s/,
		)

		const elapsedMs = Date.now() - startedAt
		expect(elapsedMs).toBeGreaterThanOrEqual(2_500)
		expect(elapsedMs).toBeLessThan(15_000)

		// The failure must stay visible on the server's entry (the MCP
		// settings card) with the actionable message.
		const connection = (hub as any).connections.find((conn: any) => conn.server.name === "hung-server")
		expect(connection.server.status).toBe("disconnected")
		expect(connection.server.error).toContain('MCP request to "hung-server"')
		expect(connection.server.error).toContain("timed out after 3s")
		expect(connection.server.error).toContain('Increase the "timeout" field')

		await deleteAllConnections(hub)
	}, 20_000)

	it("lets an explicit low timeout fail a hung server even faster than the budget", async () => {
		const hub = createHub()
		const startedAt = Date.now()

		await expect((hub as any).connectToServer("hung-server", hungServerConfig(1), "internal")).rejects.toThrow(
			/timed out after 1s/,
		)

		const elapsedMs = Date.now() - startedAt
		expect(elapsedMs).toBeLessThan(3_000)

		await deleteAllConnections(hub)
	}, 10_000)

	it("fails a slow starter with no timeout at the budget, and connects it with an explicit higher timeout", async () => {
		const hub = createHub()

		// Without a configured timeout, a server that needs ~4.5s to start
		// initializing loses the 3s budget.
		await expect(
			(hub as any).connectToServer("slow-starter", tinyServerConfig({ startupDelayMs: 4_500 }), "internal"),
		).rejects.toThrow(/timed out after 3s/)
		await deleteAllConnections(hub)

		// An explicit timeout above the budget lets the same server connect.
		await (hub as any).connectToServer("slow-starter", tinyServerConfig({ startupDelayMs: 4_500, timeout: 30 }), "rpc")

		const connection = (hub as any).connections.find((conn: any) => conn.server.name === "slow-starter")
		expect(connection.server.status).toBe("connected")
		expect((connection.server.tools ?? []).map((tool: any) => tool.name)).toContain("echo")

		await deleteAllConnections(hub)
	}, 30_000)

	it("still connects a normal fast stdio server with no timeout configured", async () => {
		const hub = createHub()

		await (hub as any).connectToServer("fast-server", tinyServerConfig(), "internal")

		const connection = (hub as any).connections.find((conn: any) => conn.server.name === "fast-server")
		expect(connection.server.status).toBe("connected")
		expect((connection.server.tools ?? []).map((tool: any) => tool.name)).toContain("echo")

		await deleteAllConnections(hub)
	}, 15_000)
})
