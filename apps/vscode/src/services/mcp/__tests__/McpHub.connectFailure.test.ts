import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StateManager } from "@core/storage/StateManager"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { McpHub } from "../McpHub"

/**
 * A server whose connection attempt fails must remain visible in the
 * in-memory server list as a disconnected entry carrying the error, and
 * reconciliation must notify the webview of that state. These tests drive
 * the real `connectToServer` failure path (a stdio command that cannot
 * spawn) rather than stubbing it.
 */

describe("McpHub connect failure", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		sandbox.stub(StateManager, "get").returns({
			getRemoteConfigSettings: () => ({}),
		} as unknown as StateManager)
	})

	afterEach(() => {
		sandbox.restore()
	})

	function createHub() {
		const hub = Object.create(McpHub.prototype) as McpHub
		;(hub as any).connections = []
		;(hub as any).isConnecting = false
		;(hub as any).clientVersion = "0.0.0"
		sandbox.stub(hub as any, "notifyWebviewOfServerChanges").resolves()
		return hub
	}

	it("keeps a failed server visible as disconnected with its error", async () => {
		const hub = createHub()
		const config = {
			type: "stdio" as const,
			command: "this-command-does-not-exist-anywhere",
			args: [],
			autoApprove: [],
			disabled: false,
			timeout: 60,
		}

		await expect((hub as any).connectToServer("broken-server", config, "internal")).rejects.toThrow()

		const connection = (hub as any).connections.find((conn: any) => conn.server.name === "broken-server")
		expect(connection).toBeDefined()
		expect(connection.server.status).toBe("disconnected")
		expect(connection.server.error.length).toBeGreaterThan(0)
	})

	it("notifies the webview when a reconnect after a config change fails", async () => {
		const hub = createHub()
		sandbox.stub(hub as any, "removeAllFileWatchers")
		sandbox.stub(hub as any, "setupFileWatcher")
		sandbox.stub(hub as any, "deleteConnection").callsFake(async () => {
			;(hub as any).connections = []
		})
		;(hub as any).connections = [
			{
				server: {
					name: "broken-server",
					config: JSON.stringify({ type: "stdio", command: "old-command", timeout: 60 }),
					status: "connected",
					disabled: false,
				},
				client: {},
				transport: {},
			},
		]

		await hub.updateServerConnections({
			"broken-server": {
				type: "stdio",
				command: "this-command-does-not-exist-anywhere",
				args: [],
				autoApprove: [],
				disabled: false,
				timeout: 60,
			} as any,
		})

		const connection = (hub as any).connections.find((conn: any) => conn.server.name === "broken-server")
		expect(connection).toBeDefined()
		expect(connection.server.status).toBe("disconnected")
		// The final notification must fire so the webview leaves "connecting"
		// and shows the errored entry.
		expect(((hub as any).notifyWebviewOfServerChanges as sinon.SinonStub).callCount).toBeGreaterThanOrEqual(2)
	})

	it("keeps the server enabled when enabling it cannot reconnect", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "mcp-toggle-connect-failure-"))
		try {
			const serverConfig = {
				type: "stdio",
				command: "this-command-does-not-exist-anywhere",
				args: [],
				timeout: 60,
				disabled: true,
			}
			const settingsPath = join(tempDir, "cline_mcp_settings.json")
			await writeFile(settingsPath, JSON.stringify({ mcpServers: { "broken-server": serverConfig } }), "utf8")

			// A regression that restores the rethrow lands in the outer catch, which
			// calls HostProvider.window.showMessage; stub the static getter so that
			// failure reports the connection error rather than an uninitialized host.
			sandbox.stub(HostProvider, "window").get(() => ({ showMessage: sinon.stub().resolves({}) }))

			const hub = createHub()
			;(hub as any).getSettingsDirectoryPath = async () => tempDir
			;(hub as any).connections = [
				{
					server: {
						name: "broken-server",
						config: JSON.stringify(serverConfig),
						status: "disconnected",
						disabled: true,
					},
					client: null,
					transport: null,
				},
			]

			const servers = await hub.toggleServerDisabledRPC("broken-server", false)

			const server = servers.find((entry) => entry.name === "broken-server")
			expect(server).toBeDefined()
			expect(server?.disabled).toBe(false)
			expect(server?.status).toBe("disconnected")
			expect((server?.error ?? "").length).toBeGreaterThan(0)

			const persisted = JSON.parse(await readFile(settingsPath, "utf8"))
			expect(persisted.mcpServers["broken-server"].disabled).toBe(false)
		} finally {
			await rm(tempDir, { recursive: true, force: true })
		}
	})
})
