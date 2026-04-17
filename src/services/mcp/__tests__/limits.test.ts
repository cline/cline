import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import {
	appendBoundedMcpError,
	enqueuePendingMcpNotification,
	MAX_MCP_SERVER_ERROR_CHARS,
	MAX_PENDING_MCP_NOTIFICATIONS,
} from "../limits"
import { McpHub } from "../McpHub"

describe("mcp limits", () => {
	it("caps pending notifications by dropping the oldest entries", () => {
		const queue = Array.from({ length: MAX_PENDING_MCP_NOTIFICATIONS }, (_, i) => ({
			serverName: `server-${i}`,
			level: "info",
			message: `message-${i}`,
			timestamp: i,
		}))

		const updated = enqueuePendingMcpNotification(queue, {
			serverName: "server-new",
			level: "warning",
			message: "message-new",
			timestamp: 999,
		})

		assert.equal(updated.queue.length, MAX_PENDING_MCP_NOTIFICATIONS)
		assert.equal(updated.droppedCount, 1)
		assert.equal(updated.queue[0]?.serverName, "server-1")
		assert.equal(updated.queue.at(-1)?.serverName, "server-new")
	})

	it("keeps accumulated MCP server error text within the configured budget", () => {
		const existing = "a".repeat(MAX_MCP_SERVER_ERROR_CHARS - 10)
		const appended = appendBoundedMcpError(existing, "b".repeat(100))

		assert.ok(appended.value.length <= MAX_MCP_SERVER_ERROR_CHARS)
		assert.equal(appended.truncated, true)
		assert.ok(appended.value.includes("truncated"))
		assert.ok(appended.value.endsWith("b".repeat(100).slice(-Math.min(100, appended.value.length))))
	})

	it("closes all MCP file watchers during repeated teardown cycles", async () => {
		for (let cycle = 0; cycle < 5; cycle++) {
			const watcherA = { close: () => undefined }
			const watcherB = { close: () => undefined }
			let closed = 0
			const hub = Object.create(McpHub.prototype) as McpHub & {
				fileWatchers: Map<string, { close: () => void }>
				settingsWatcher?: { close: () => Promise<void> }
				connections: Array<{ server: { name: string } }>
				deleteConnection: (name: string) => Promise<void>
			}

			hub.fileWatchers = new Map([
				[
					"server-a",
					{
						close: () => {
							closed += 1
							watcherA.close()
						},
					},
				],
				[
					"server-b",
					{
						close: () => {
							closed += 1
							watcherB.close()
						},
					},
				],
			])
			hub.settingsWatcher = { close: async () => undefined }
			hub.connections = []
			hub.deleteConnection = async () => undefined

			await hub.dispose()

			assert.equal(closed, 2)
			assert.equal(hub.fileWatchers.size, 0)
		}
	})

	it("bounds noisy queued notifications and flushes them when a task callback is registered", () => {
		const droppedEvents: Array<{ serverName: string; droppedCount: number; retainedCount: number }> = []
		const hub = Object.create(McpHub.prototype) as McpHub & {
			pendingNotifications: Array<{ serverName: string; level: string; message: string; timestamp: number }>
			notificationCallback?: (serverName: string, level: string, message: string) => void
			telemetryService: {
				captureMcpNotificationDropped: (serverName: string, droppedCount: number, retainedCount: number) => void
			}
		}

		hub.pendingNotifications = []
		hub.notificationCallback = undefined
		hub.telemetryService = {
			captureMcpNotificationDropped: (serverName, droppedCount, retainedCount) => {
				droppedEvents.push({ serverName, droppedCount, retainedCount })
			},
		}

		for (let i = 0; i < MAX_PENDING_MCP_NOTIFICATIONS + 3; i++) {
			;(hub as any).dispatchOrQueueNotification("server-a", "info", `message-${i}`)
		}

		assert.equal(hub.pendingNotifications.length, MAX_PENDING_MCP_NOTIFICATIONS)
		assert.equal(hub.pendingNotifications[0]?.message, "message-3")
		assert.equal(droppedEvents.length, 3)

		const delivered: string[] = []
		hub.setNotificationCallback((_serverName, _level, message) => {
			delivered.push(message)
		})

		assert.equal(hub.pendingNotifications.length, 0)
		assert.deepEqual(
			delivered,
			Array.from({ length: MAX_PENDING_MCP_NOTIFICATIONS }, (_, i) => `message-${i + 3}`),
		)

		;(hub as any).dispatchOrQueueNotification("server-a", "warning", "live-message")
		assert.deepEqual(delivered.at(-1), "live-message")
	})

	it("bounds repeated MCP server stderr accumulation and records truncation telemetry", () => {
		const truncatedEvents: Array<{ serverName: string; originalLength: number; retainedLength: number }> = []
		const hub = Object.create(McpHub.prototype) as McpHub & {
			telemetryService: {
				captureMcpErrorTruncated: (serverName: string, originalLength: number, retainedLength: number) => void
			}
		}

		hub.telemetryService = {
			captureMcpErrorTruncated: (serverName, originalLength, retainedLength) => {
				truncatedEvents.push({ serverName, originalLength, retainedLength })
			},
		}

		const connection = {
			server: {
				name: "server-a",
				error: "",
			},
		} as any

		for (let i = 0; i < 6; i++) {
			;(hub as any).appendErrorMessage(connection, `error-${i}-` + "x".repeat(MAX_MCP_SERVER_ERROR_CHARS / 2))
		}

		assert.ok(connection.server.error.length <= MAX_MCP_SERVER_ERROR_CHARS)
		assert.ok(connection.server.error.includes("truncated"))
		assert.ok(truncatedEvents.length >= 1)
		assert.equal(truncatedEvents.at(-1)?.serverName, "server-a")
	})

	it("re-establishes stdio file watchers across repeated settings refreshes", async () => {
		const closedWatchers: string[] = []
		const hub = Object.create(McpHub.prototype) as McpHub & {
			fileWatchers: Map<string, { close: () => void }>
			connections: Array<{ server: { name: string; config: string; tools?: any[] } }>
			isConnecting: boolean
			deleteConnection: (name: string) => Promise<void>
			connectToServer: (name: string, config: any, source: "rpc" | "internal") => Promise<void>
			setupFileWatcher: (name: string, config: any) => void
		}

		const serverConfig = {
			type: "stdio",
			command: "node",
			args: ["build/index.js"],
			disabled: false,
			autoApprove: [],
			timeout: 60,
		}

		hub.fileWatchers = new Map([
			[
				"server-a",
				{
					close: () => {
						closedWatchers.push("initial")
					},
				},
			],
		])
		hub.connections = [
			{
				server: {
					name: "server-a",
					config: JSON.stringify(serverConfig),
					tools: [],
				},
			},
		]
		hub.isConnecting = false
		hub.deleteConnection = async () => undefined
		hub.connectToServer = async () => undefined

		let watcherIndex = 0
		hub.setupFileWatcher = (name: string) => {
			const watcherId = `watcher-${watcherIndex++}`
			hub.fileWatchers.set(name, {
				close: () => {
					closedWatchers.push(watcherId)
				},
			})
		}

		for (let cycle = 0; cycle < 3; cycle++) {
			await hub.updateServerConnectionsRPC({ "server-a": serverConfig as any })
			assert.equal(hub.fileWatchers.size, 1)
			assert.equal(hub.isConnecting, false)
		}

		assert.equal(watcherIndex, 3)
		assert.deepEqual(closedWatchers, ["initial", "watcher-0", "watcher-1"])
	})
})
