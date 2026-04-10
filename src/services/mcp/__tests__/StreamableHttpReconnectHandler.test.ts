import { beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import {
	DEFAULT_RECONNECT_CONFIG,
	ReconnectCallbacks,
	ReconnectConfig,
	StreamableHttpReconnectHandler,
} from "../StreamableHttpReconnectHandler"

/** Build a mock connection object whose status can be inspected. */
function makeConnection(overrides: Partial<{ status: string; disabled: boolean; uid: string }> = {}) {
	return {
		server: {
			status: overrides.status ?? "connected",
			disabled: overrides.disabled ?? false,
			uid: overrides.uid ?? "uid-123",
		},
	}
}

/** Build a default set of spy-based callbacks. The `delay` resolves immediately. */
function makeCallbacks(connection?: ReturnType<typeof makeConnection>): ReconnectCallbacks & {
	/** Direct access to the underlying sinon stubs for assertions */
	stubs: Record<string, sinon.SinonStub>
} {
	const conn = connection ?? makeConnection()
	const stubs: Record<string, sinon.SinonStub> = {
		findConnection: sinon.stub().returns(conn),
		deleteConnection: sinon.stub().resolves(),
		connectToServer: sinon.stub().resolves(),
		notifyWebviewOfServerChanges: sinon.stub().resolves(),
		appendErrorMessage: sinon.stub(),
		deleteServerKey: sinon.stub(),
		delay: sinon.stub().resolves(), // instant — no real waiting in tests
	}
	return { ...(stubs as unknown as ReconnectCallbacks), stubs }
}

/** A config with a small max so tests don't loop many times. */
const TEST_CONFIG: ReconnectConfig = {
	maxAttempts: 3,
	getDelayMs: (attempt) => 100 * 2 ** attempt, // 100, 200, 400
}

describe("StreamableHttpReconnectHandler", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	// ── basics ──────────────────────────────────────────────────────────

	it("should export sensible defaults", () => {
		DEFAULT_RECONNECT_CONFIG.maxAttempts.should.equal(6)
		DEFAULT_RECONNECT_CONFIG.getDelayMs(0).should.equal(2000)
		DEFAULT_RECONNECT_CONFIG.getDelayMs(1).should.equal(4000)
		DEFAULT_RECONNECT_CONFIG.getDelayMs(2).should.equal(8000)
	})

	// ── no-op cases ─────────────────────────────────────────────────────

	it("should do nothing when findConnection returns undefined", async () => {
		const cbs = makeCallbacks()
		cbs.stubs.findConnection.returns(undefined)
		const handler = new StreamableHttpReconnectHandler("test-server", cbs, TEST_CONFIG)

		await handler.handleError(new Error("boom"))

		cbs.stubs.deleteConnection.called.should.be.false()
		cbs.stubs.connectToServer.called.should.be.false()
		handler.attemptCount.should.equal(0)
	})

	it("should skip reconnect when server is disabled", async () => {
		const conn = makeConnection({ disabled: true })
		const cbs = makeCallbacks(conn)
		const handler = new StreamableHttpReconnectHandler("test-server", cbs, TEST_CONFIG)

		await handler.handleError(new Error("boom"))

		cbs.stubs.deleteConnection.called.should.be.false()
		handler.attemptCount.should.equal(0)
	})

	it("should skip reconnect when server is already connecting", async () => {
		const conn = makeConnection({ status: "connecting" })
		const cbs = makeCallbacks(conn)
		const handler = new StreamableHttpReconnectHandler("test-server", cbs, TEST_CONFIG)

		await handler.handleError(new Error("boom"))

		cbs.stubs.deleteConnection.called.should.be.false()
		handler.attemptCount.should.equal(0)
	})

	// ── successful reconnect ────────────────────────────────────────────

	it("should reconnect on first error and reset attempt counter", async () => {
		const conn = makeConnection()
		const cbs = makeCallbacks(conn)
		const handler = new StreamableHttpReconnectHandler("test-server", cbs, TEST_CONFIG)

		await handler.handleError(new Error("connection lost"))

		// Should have called delete + connect
		cbs.stubs.deleteConnection.calledOnce.should.be.true()
		cbs.stubs.connectToServer.calledOnce.should.be.true()
		// Counter resets to 0 after success
		handler.attemptCount.should.equal(0)
		// Status was set to "connecting" during the attempt
		cbs.stubs.notifyWebviewOfServerChanges.called.should.be.true()
	})

	it("should use the configured delay for each attempt", async () => {
		const conn = makeConnection()
		const cbs = makeCallbacks(conn)
		// Make connectToServer fail on first call, succeed on second
		cbs.stubs.connectToServer.onFirstCall().rejects(new Error("fail"))
		cbs.stubs.connectToServer.onSecondCall().resolves()
		const handler = new StreamableHttpReconnectHandler("test-server", cbs, TEST_CONFIG)

		// Single handleError call — the retry loop handles both attempts internally
		await handler.handleError(new Error("err1"))

		// Initial backoff delay (attempt 0 → 100ms), then retry delay (attempt 1 → 200ms)
		cbs.stubs.delay.callCount.should.equal(2)
		cbs.stubs.delay.firstCall.args[0].should.equal(100)
		cbs.stubs.delay.secondCall.args[0].should.equal(200)

		// Second connect succeeded → counter reset
		handler.attemptCount.should.equal(0)
		cbs.stubs.connectToServer.callCount.should.equal(2)
	})

	// ── exhausted retries ───────────────────────────────────────────────

	it("should mark server as disconnected after maxAttempts exhausted", async () => {
		const conn = makeConnection()
		const cbs = makeCallbacks(conn)
		// All reconnect attempts fail
		cbs.stubs.connectToServer.rejects(new Error("still broken"))

		// After deleteConnection, findConnection returns undefined (old conn deleted)
		// but connectToServer may leave a partial connection, so simulate that
		const partialConn = makeConnection({ uid: "uid-partial" })
		let deleted = false
		cbs.stubs.findConnection.callsFake(() => {
			if (!deleted) return conn
			return partialConn
		})
		cbs.stubs.deleteConnection.callsFake(async () => {
			deleted = true
		})

		const handler = new StreamableHttpReconnectHandler("test-server", cbs, TEST_CONFIG)

		// Single handleError call exhausts all 3 attempts via the internal retry loop
		await handler.handleError(new Error("transport error"))

		handler.attemptCount.should.equal(TEST_CONFIG.maxAttempts)

		// connectToServer was called maxAttempts times (3)
		cbs.stubs.connectToServer.callCount.should.equal(TEST_CONFIG.maxAttempts)

		// The partial connection should be marked disconnected
		partialConn.server.status.should.equal("disconnected")
		cbs.stubs.deleteServerKey.calledWith("uid-partial").should.be.true()
		cbs.stubs.appendErrorMessage.calledOnce.should.be.true()
		cbs.stubs.appendErrorMessage.firstCall.args[1].should.equal("transport error")
	})

	it("should mark disconnected even when no connection exists after exhaustion", async () => {
		const conn = makeConnection()
		const cbs = makeCallbacks(conn)
		cbs.stubs.connectToServer.rejects(new Error("broken"))

		// After deleteConnection, findConnection returns undefined
		let deleted = false
		cbs.stubs.findConnection.callsFake(() => (deleted ? undefined : conn))
		cbs.stubs.deleteConnection.callsFake(async () => {
			deleted = true
		})

		const handler = new StreamableHttpReconnectHandler("test-server", cbs, TEST_CONFIG)

		await handler.handleError(new Error("transport error"))

		handler.attemptCount.should.equal(TEST_CONFIG.maxAttempts)
		// No partial connection to mark, but notifyWebview should still be called
		cbs.stubs.notifyWebviewOfServerChanges.called.should.be.true()
		// appendErrorMessage not called since there's no connection to append to
		cbs.stubs.appendErrorMessage.called.should.be.false()
	})

	it("should exhaust retries when called with attempts already at max", async () => {
		const conn = makeConnection()
		const cbs = makeCallbacks(conn)
		const config: ReconnectConfig = { maxAttempts: 0, getDelayMs: () => 0 }
		const handler = new StreamableHttpReconnectHandler("test-server", cbs, config)

		await handler.handleError(new Error("final error"))

		conn.server.status.should.equal("disconnected")
		cbs.stubs.deleteServerKey.calledWith("uid-123").should.be.true()
		cbs.stubs.appendErrorMessage.calledOnce.should.be.true()
		cbs.stubs.connectToServer.called.should.be.false()
	})

	// ── connectToServer failure retries automatically ───────────────────

	it("should retry connectToServer on failure without relying on onerror", async () => {
		const conn = makeConnection()
		const cbs = makeCallbacks(conn)
		// First two attempts fail, third succeeds
		cbs.stubs.connectToServer.onFirstCall().rejects(new Error("fail 1"))
		cbs.stubs.connectToServer.onSecondCall().rejects(new Error("fail 2"))
		cbs.stubs.connectToServer.onThirdCall().resolves()
		const handler = new StreamableHttpReconnectHandler("test-server", cbs, TEST_CONFIG)

		// A single handleError call should retry all 3 attempts internally
		await handler.handleError(new Error("transport error"))

		cbs.stubs.connectToServer.callCount.should.equal(3)
		handler.attemptCount.should.equal(0) // reset on success

		// Delays: initial(100) + retry(200) + retry(400)
		cbs.stubs.delay.callCount.should.equal(3)
		cbs.stubs.delay.getCall(0).args[0].should.equal(100)
		cbs.stubs.delay.getCall(1).args[0].should.equal(200)
		cbs.stubs.delay.getCall(2).args[0].should.equal(400)
	})

	// ── connection replaced mid-reconnect ───────────────────────────────

	it("should abort reconnect if connection was replaced during delay", async () => {
		const conn = makeConnection()
		const differentConn = makeConnection({ uid: "uid-replaced" })
		const cbs = makeCallbacks(conn)
		// After the delay, findConnection returns a different object
		cbs.stubs.findConnection.onFirstCall().returns(conn)
		cbs.stubs.findConnection.onSecondCall().returns(differentConn)
		const handler = new StreamableHttpReconnectHandler("test-server", cbs, TEST_CONFIG)

		await handler.handleError(new Error("err"))

		// delay was called, but delete/connect were NOT (connection was replaced)
		cbs.stubs.delay.calledOnce.should.be.true()
		cbs.stubs.deleteConnection.called.should.be.false()
		cbs.stubs.connectToServer.called.should.be.false()
	})

	it("should abort reconnect if connection disappeared during delay", async () => {
		const conn = makeConnection()
		const cbs = makeCallbacks(conn)
		cbs.stubs.findConnection.onFirstCall().returns(conn)
		cbs.stubs.findConnection.onSecondCall().returns(undefined)
		const handler = new StreamableHttpReconnectHandler("test-server", cbs, TEST_CONFIG)

		await handler.handleError(new Error("err"))

		cbs.stubs.deleteConnection.called.should.be.false()
		cbs.stubs.connectToServer.called.should.be.false()
	})

	// ── resetAttempts ───────────────────────────────────────────────────

	it("should allow manual reset of attempt counter", async () => {
		const conn = makeConnection()
		const cbs = makeCallbacks(conn)
		cbs.stubs.connectToServer.rejects(new Error("fail"))
		const handler = new StreamableHttpReconnectHandler("test-server", cbs, TEST_CONFIG)

		// After exhausting all retries, attemptCount should be at max
		await handler.handleError(new Error("err1"))
		handler.attemptCount.should.equal(TEST_CONFIG.maxAttempts)

		handler.resetAttempts()
		handler.attemptCount.should.equal(0)
	})

	// ── error message formatting ────────────────────────────────────────

	it("should use string coercion for non-Error objects on exhaustion", async () => {
		const conn = makeConnection()
		const cbs = makeCallbacks(conn)
		cbs.stubs.connectToServer.rejects(new Error("fail"))
		const config: ReconnectConfig = { maxAttempts: 0, getDelayMs: () => 0 }
		const handler = new StreamableHttpReconnectHandler("test-server", cbs, config)

		// Pass a plain string as the error
		await handler.handleError("string-error-message")

		cbs.stubs.appendErrorMessage.calledOnce.should.be.true()
		cbs.stubs.appendErrorMessage.firstCall.args[1].should.equal("string-error-message")
	})
})
