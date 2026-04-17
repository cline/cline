import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { measureAsyncOperation } from "@/test/stress-utils"
import { MAX_PENDING_MCP_NOTIFICATIONS } from "../limits"
import { McpHub } from "../McpHub"

describe("mcp soak", () => {
	it("handles a noisy queued notification run within bounded queue and delivery budgets", async function () {
		this.timeout(20_000)

		const droppedEvents: Array<{ serverName: string; droppedCount: number; retainedCount: number }> = []
		const hub = Object.create(McpHub.prototype) as any

		hub.pendingNotifications = []
		hub.notificationCallback = undefined
		hub.telemetryService = {
			captureMcpNotificationDropped: (serverName: string, droppedCount: number, retainedCount: number) => {
				droppedEvents.push({ serverName, droppedCount, retainedCount })
			},
		}

		const measured = await measureAsyncOperation("mcp noisy queued notification soak", async () => {
			for (let i = 0; i < 10_000; i++) {
				;(hub as any).dispatchOrQueueNotification("server-a", i % 2 === 0 ? "info" : "warning", `message-${i}`)
			}

			const delivered: string[] = []
			hub.setNotificationCallback((_serverName: string, _level: string, message: string) => {
				delivered.push(message)
			})

			return delivered
		})

		assert.equal(hub.pendingNotifications.length, 0)
		assert.equal(measured.result.length, MAX_PENDING_MCP_NOTIFICATIONS)
		assert.equal(measured.result[0], `message-${10_000 - MAX_PENDING_MCP_NOTIFICATIONS}`)
		assert.equal(measured.result.at(-1), "message-9999")
		assert.equal(droppedEvents.length, 10_000 - MAX_PENDING_MCP_NOTIFICATIONS)
		assert.ok(measured.durationMs < 20_000)
		assert.ok(measured.diff.heapUsedDelta < 128 * 1024 * 1024)
	})
})
