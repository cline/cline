import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { StateManager } from "@core/storage/StateManager"
import sinon from "sinon"
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
})
