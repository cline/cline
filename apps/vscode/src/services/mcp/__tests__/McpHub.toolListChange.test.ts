/**
 * Tests for McpHub's tool list change detection and callback mechanism.
 *
 * These tests verify that:
 * 1. computeToolFingerprint() produces deterministic fingerprints
 * 2. The toolListChangeCallback fires only when the tool list actually changes
 * 3. The callback does NOT fire on mere status updates (error messages, etc.)
 *
 * Fingerprint assertions call the production McpHub method so the session
 * rebuild boundary cannot drift from a test-only implementation.
 */
import { describe, it } from "bun:test"
import "should"
import sinon from "sinon"
import { McpHub } from "../McpHub"

// ---------------------------------------------------------------------------
// Extract the pure logic from McpHub for testing
// (These mirror the implementations in McpHub.ts exactly)
// ---------------------------------------------------------------------------

interface MinimalConnection {
	server: {
		name: string
		config: string
		status: string
		disabled?: boolean
		tools?: Array<{ name: string; description?: string; inputSchema?: object }>
	}
}

function computeToolFingerprint(connections: MinimalConnection[]): string {
	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as unknown as { connections: MinimalConnection[] }).connections = connections
	return hub.computeToolFingerprint()
}

/**
 * Simulates the McpHub's checkToolListChanged logic.
 */
function createToolListChangeTracker() {
	let lastFingerprint = ""
	let callback: (() => void) | undefined

	return {
		setCallback(cb: () => void, connections: MinimalConnection[]) {
			callback = cb
			lastFingerprint = computeToolFingerprint(connections)
		},
		clearCallback() {
			callback = undefined
		},
		check(connections: MinimalConnection[]) {
			if (!callback) return
			const newFingerprint = computeToolFingerprint(connections)
			if (newFingerprint !== lastFingerprint) {
				lastFingerprint = newFingerprint
				try {
					callback()
				} catch {
					// Errors in callback are swallowed (logged in production)
				}
			}
		},
	}
}

function makeConnection(
	name: string,
	status: string,
	tools: string[],
	disabled = false,
	timeout = 60,
	toolOverrides: Record<string, Partial<{ description: string; inputSchema: object }>> = {},
): MinimalConnection {
	return {
		server: {
			name,
			config: JSON.stringify({ type: "stdio", command: "node", timeout }),
			status,
			disabled,
			tools: tools.map((toolName) => ({ name: toolName, ...toolOverrides[toolName] })),
		},
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("McpHub tool list change detection", () => {
	describe("computeToolFingerprint", () => {
		it("should return an empty structured fingerprint when no servers are connected", () => {
			computeToolFingerprint([]).should.equal("[]")
		})

		it("should include tools from connected, non-disabled servers", () => {
			const connections = [makeConnection("server-a", "connected", ["tool1", "tool2"])]
			const entries = JSON.parse(computeToolFingerprint(connections)).map((entry: string) => JSON.parse(entry))
			entries.should.deepEqual([
				["server-a", "tool1", null, {}, 60_000],
				["server-a", "tool2", null, {}, 60_000],
			])
		})

		it("should exclude tools from disconnected servers", () => {
			const connections = [
				makeConnection("server-a", "connected", ["tool1"]),
				makeConnection("server-b", "disconnected", ["tool2"]),
			]
			const entries = JSON.parse(computeToolFingerprint(connections)).map((entry: string) => JSON.parse(entry))
			entries.should.deepEqual([["server-a", "tool1", null, {}, 60_000]])
		})

		it("should exclude tools from disabled servers", () => {
			const connections = [makeConnection("server-a", "connected", ["tool1"], true)]
			computeToolFingerprint(connections).should.equal("[]")
		})

		it("should exclude tools from connecting servers", () => {
			const connections = [makeConnection("server-a", "connecting", ["tool1"])]
			computeToolFingerprint(connections).should.equal("[]")
		})

		it("should produce sorted, deterministic output regardless of insertion order", () => {
			const connections1 = [
				makeConnection("z-server", "connected", ["b-tool", "a-tool"]),
				makeConnection("a-server", "connected", ["z-tool"]),
			]
			const connections2 = [
				makeConnection("a-server", "connected", ["z-tool"]),
				makeConnection("z-server", "connected", ["a-tool", "b-tool"]),
			]
			computeToolFingerprint(connections1).should.equal(computeToolFingerprint(connections2))
		})

		it("should produce different fingerprints for different tool sets", () => {
			const fp1 = computeToolFingerprint([makeConnection("s", "connected", ["tool1"])])
			const fp2 = computeToolFingerprint([makeConnection("s", "connected", ["tool2"])])
			fp1.should.not.equal(fp2)
		})

		it("should produce different fingerprints for different wrapper timeouts", () => {
			const fp1 = computeToolFingerprint([makeConnection("s", "connected", ["tool1"], false, 60)])
			const fp2 = computeToolFingerprint([makeConnection("s", "connected", ["tool1"], false, 120)])
			fp1.should.not.equal(fp2)
		})

		it("should produce different fingerprints for different descriptions", () => {
			const fp1 = computeToolFingerprint([makeConnection("s", "connected", ["tool1"])])
			const fp2 = computeToolFingerprint([
				makeConnection("s", "connected", ["tool1"], false, 60, {
					tool1: { description: "updated" },
				}),
			])
			fp1.should.not.equal(fp2)
		})

		it("should fingerprint schemas deterministically and detect schema changes", () => {
			const fp1 = computeToolFingerprint([
				makeConnection("s", "connected", ["tool1"], false, 60, {
					tool1: { inputSchema: { type: "object", properties: { a: { type: "string" } } } },
				}),
			])
			const sameSchemaDifferentKeyOrder = computeToolFingerprint([
				makeConnection("s", "connected", ["tool1"], false, 60, {
					tool1: { inputSchema: { properties: { a: { type: "string" } }, type: "object" } },
				}),
			])
			const changedSchema = computeToolFingerprint([
				makeConnection("s", "connected", ["tool1"], false, 60, {
					tool1: { inputSchema: { type: "object", properties: { b: { type: "number" } } } },
				}),
			])
			fp1.should.equal(sameSchemaDifferentKeyOrder)
			fp1.should.not.equal(changedSchema)
		})
	})

	describe("tool list change callback", () => {
		it("should fire callback when tool list changes", () => {
			const tracker = createToolListChangeTracker()
			const callback = sinon.stub()

			// Set callback with initial empty state
			tracker.setCallback(callback, [])
			callback.called.should.be.false()

			// Add a server with tools — fingerprint changes
			const connections = [makeConnection("server-a", "connected", ["tool1"])]
			tracker.check(connections)
			callback.calledOnce.should.be.true()
		})

		it("should NOT fire callback when fingerprint is unchanged", () => {
			const connections = [makeConnection("server-a", "connected", ["tool1"])]
			const tracker = createToolListChangeTracker()
			const callback = sinon.stub()

			tracker.setCallback(callback, connections)

			// Check again with same state — should not fire
			tracker.check(connections)
			callback.called.should.be.false()
		})

		it("should fire callback when a server disconnects (tools lost)", () => {
			const connections = [makeConnection("server-a", "connected", ["tool1"])]
			const tracker = createToolListChangeTracker()
			const callback = sinon.stub()

			tracker.setCallback(callback, connections)

			// Simulate server disconnect
			connections[0].server.status = "disconnected"
			tracker.check(connections)
			callback.calledOnce.should.be.true()
		})

		it("should fire callback when new tools are added to a server", () => {
			const connections = [makeConnection("server-a", "connected", ["tool1"])]
			const tracker = createToolListChangeTracker()
			const callback = sinon.stub()

			tracker.setCallback(callback, connections)

			// Add a new tool
			connections[0].server.tools!.push({ name: "tool2" })
			tracker.check(connections)
			callback.calledOnce.should.be.true()
		})

		it("should fire callback when a new server connects", () => {
			const connections = [makeConnection("server-a", "connected", ["tool1"])]
			const tracker = createToolListChangeTracker()
			const callback = sinon.stub()

			tracker.setCallback(callback, connections)

			// Add a new server
			connections.push(makeConnection("server-b", "connected", ["tool2"]))
			tracker.check(connections)
			callback.calledOnce.should.be.true()
		})

		it("should NOT fire callback when no callback is set", () => {
			const tracker = createToolListChangeTracker()
			const connections = [makeConnection("server-a", "connected", ["tool1"])]

			// No callback set — should not throw
			tracker.check(connections)
		})

		it("should handle callback errors gracefully", () => {
			const tracker = createToolListChangeTracker()
			const callback = sinon.stub().throws(new Error("callback error"))

			tracker.setCallback(callback, [])
			const connections = [makeConnection("server-a", "connected", ["tool1"])]

			// Should not throw even though callback throws
			;(() => tracker.check(connections)).should.not.throw()
		})

		it("should stop firing after clearCallback", () => {
			const tracker = createToolListChangeTracker()
			const callback = sinon.stub()

			tracker.setCallback(callback, [])
			tracker.clearCallback()

			const connections = [makeConnection("server-a", "connected", ["tool1"])]
			tracker.check(connections)
			callback.called.should.be.false()
		})

		it("should track cumulative changes correctly", () => {
			const tracker = createToolListChangeTracker()
			const callback = sinon.stub()

			tracker.setCallback(callback, [])

			// First change: add server
			const connections = [makeConnection("server-a", "connected", ["tool1"])]
			tracker.check(connections)
			callback.callCount.should.equal(1)

			// No change: same state
			tracker.check(connections)
			callback.callCount.should.equal(1)

			// Second change: add tool
			connections[0].server.tools!.push({ name: "tool2" })
			tracker.check(connections)
			callback.callCount.should.equal(2)

			// Third change: server disconnects
			connections[0].server.status = "disconnected"
			tracker.check(connections)
			callback.callCount.should.equal(3)
		})
	})
})
