/**
 * Tests for McpHub's tool list change detection and callback mechanism.
 *
 * These tests verify that:
 * 1. computeToolFingerprint() produces deterministic fingerprints
 * 2. The toolListChangeCallback fires only when the tool list actually changes
 * 3. The callback does NOT fire on mere status updates (error messages, etc.)
 *
 * We avoid importing McpHub directly (too many transitive deps for unit tests).
 * Instead we extract the pure logic and test it in isolation.
 */
import { describe, it } from "mocha"
import "should"
import sinon from "sinon"

// ---------------------------------------------------------------------------
// Extract the pure logic from McpHub for testing
// (These mirror the implementations in McpHub.ts exactly)
// ---------------------------------------------------------------------------

interface MinimalConnection {
	server: {
		name: string
		status: string
		disabled?: boolean
		tools?: Array<{ name: string }>
	}
}

function computeToolFingerprint(connections: MinimalConnection[]): string {
	const entries: string[] = []
	for (const conn of connections) {
		if (conn.server.disabled || conn.server.status !== "connected") {
			continue
		}
		for (const tool of conn.server.tools ?? []) {
			entries.push(`${conn.server.name}:${tool.name}`)
		}
	}
	entries.sort()
	return entries.join("|")
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

function makeConnection(name: string, status: string, tools: string[], disabled = false): MinimalConnection {
	return {
		server: {
			name,
			status,
			disabled,
			tools: tools.map((t) => ({ name: t })),
		},
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("McpHub tool list change detection", () => {
	describe("computeToolFingerprint", () => {
		it("should return empty string when no servers are connected", () => {
			computeToolFingerprint([]).should.equal("")
		})

		it("should include tools from connected, non-disabled servers", () => {
			const connections = [makeConnection("server-a", "connected", ["tool1", "tool2"])]
			const fp = computeToolFingerprint(connections)
			fp.should.containEql("server-a:tool1")
			fp.should.containEql("server-a:tool2")
		})

		it("should exclude tools from disconnected servers", () => {
			const connections = [
				makeConnection("server-a", "connected", ["tool1"]),
				makeConnection("server-b", "disconnected", ["tool2"]),
			]
			const fp = computeToolFingerprint(connections)
			fp.should.containEql("server-a:tool1")
			fp.should.not.containEql("server-b:tool2")
		})

		it("should exclude tools from disabled servers", () => {
			const connections = [makeConnection("server-a", "connected", ["tool1"], true)]
			computeToolFingerprint(connections).should.equal("")
		})

		it("should exclude tools from connecting servers", () => {
			const connections = [makeConnection("server-a", "connecting", ["tool1"])]
			computeToolFingerprint(connections).should.equal("")
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
