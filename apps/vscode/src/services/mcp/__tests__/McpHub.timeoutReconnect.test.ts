import { describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sinon from "sinon"
import { McpHub } from "../McpHub"

describe("McpHub timeout reconciliation", () => {
	it("rebuilds a connection when only its timeout changes", async () => {
		const hub = Object.create(McpHub.prototype) as McpHub
		const makeConnection = (timeout: number) => ({
			server: {
				name: "slow-server",
				config: JSON.stringify({ type: "stdio", command: "node", timeout }),
				status: "connected",
				disabled: false,
				tools: [{ name: "slow-tool", inputSchema: { type: "object" } }],
			},
			client: {},
			transport: {},
		})
		;(hub as any).connections = [makeConnection(60)]
		;(hub as any).isConnecting = false
		const toolListChanged = sinon.stub()
		hub.setToolListChangeCallback(toolListChanged)
		const deleteConnection = sinon.stub(hub as any, "deleteConnection").callsFake(async () => {
			;(hub as any).connections = []
		})
		const connectToServer = sinon.stub(hub as any, "connectToServer").callsFake(async () => {
			;(hub as any).connections = [makeConnection(120)]
		})
		sinon.stub(hub as any, "removeAllFileWatchers")
		sinon.stub(hub as any, "setupFileWatcher")

		await hub.updateServerConnectionsRPC({
			"slow-server": {
				type: "stdio",
				command: "node",
				timeout: 120,
			},
		})

		expect(deleteConnection.calledOnce).toBe(true)
		expect(connectToServer.calledOnce).toBe(true)
		expect(connectToServer.firstCall.args[1]).toMatchObject({ timeout: 120 })
		await new Promise((resolve) => setTimeout(resolve, 350))
		expect(toolListChanged.calledOnce).toBe(true)
	})

	it("reconciles the persisted timeout after an RPC update", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "mcp-timeout-rpc-"))
		try {
			await writeFile(
				join(tempDir, "cline_mcp_settings.json"),
				JSON.stringify({
					mcpServers: {
						"slow-server": {
							type: "stdio",
							command: "node",
							timeout: 60,
						},
					},
				}),
				"utf8",
			)
			const hub = Object.create(McpHub.prototype) as McpHub
			;(hub as any).getSettingsDirectoryPath = async () => tempDir
			;(hub as any).connections = [
				{
					server: {
						name: "slow-server",
						config: JSON.stringify({ type: "stdio", command: "node", timeout: 60 }),
						status: "connected",
						disabled: false,
					},
					client: {},
					transport: {},
				},
			]
			const reconcile = sinon.stub(hub, "updateServerConnectionsRPC").resolves()

			await hub.updateServerTimeoutRPC("slow-server", 120)

			expect(reconcile.calledOnce).toBe(true)
			expect(reconcile.firstCall.args[0]).toMatchObject({
				"slow-server": { timeout: 120 },
			})
		} finally {
			await rm(tempDir, { recursive: true, force: true })
		}
	})
})
