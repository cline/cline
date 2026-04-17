import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import {
	appendBoundedMcpError,
	enqueuePendingMcpNotification,
	MAX_MCP_SERVER_ERROR_CHARS,
	MAX_PENDING_MCP_NOTIFICATIONS,
} from "../limits"

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
})
