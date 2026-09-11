import { afterEach, beforeEach, describe, it } from "bun:test"
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js"
import "should"
import sinon from "sinon"
import { McpHub } from "../McpHub"

/**
 * Unit tests for McpHub's handling of MCP list_changed notifications
 * (notifications/tools/list_changed etc.).
 *
 * Servers emit these in bursts (a toolset change or shutdown can produce a
 * dozen at once). Instead of toasting each one, McpHub debounces them per
 * server and list kind, then refreshes the corresponding cached list and
 * notifies the webview once.
 *
 * These tests exercise the real scheduleListChangedRefresh/refreshChangedList
 * implementations by building a partially-initialized `McpHub` instance
 * (bypassing the constructor's filesystem side-effects, same pattern as
 * McpHub.callTool.test.ts) and stubbing the fetch/notify collaborators.
 */

function createMcpHub(serverName = "test-server", options: { disabled?: boolean } = {}) {
	const connection = {
		server: {
			name: serverName,
			config: JSON.stringify({ type: "stdio", command: "test", timeout: 60 }),
			status: "connected",
			disabled: options.disabled ?? false,
			tools: [] as Array<{ name: string }>,
			resources: [] as Array<{ name: string }>,
			resourceTemplates: [] as Array<{ name: string }>,
			prompts: [] as Array<{ name: string }>,
		},
		client: {},
		transport: {},
	}

	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).connections = [connection]
	;(hub as any).listChangedRefreshTimers = new Map()
	;(hub as any).listChangedRefreshInFlight = new Map()
	;(hub as any).listChangedRefreshGeneration = new Map()
	;(hub as any).listChangedRefreshDeadlines = new Map()

	const fetchToolsList = sinon.stub().resolves([{ name: "tool1" }])
	const fetchResourcesList = sinon.stub().resolves([{ name: "resource1" }])
	const fetchResourceTemplatesList = sinon.stub().resolves([{ name: "template1" }])
	const fetchPromptsList = sinon.stub().resolves([{ name: "prompt1" }])
	const notifyWebviewOfServerChanges = sinon.stub().resolves()
	;(hub as any).fetchToolsList = fetchToolsList
	;(hub as any).fetchResourcesList = fetchResourcesList
	;(hub as any).fetchResourceTemplatesList = fetchResourceTemplatesList
	;(hub as any).fetchPromptsList = fetchPromptsList
	;(hub as any).notifyWebviewOfServerChanges = notifyWebviewOfServerChanges

	return {
		hub,
		connection,
		fetchToolsList,
		fetchResourcesList,
		fetchResourceTemplatesList,
		fetchPromptsList,
		notifyWebviewOfServerChanges,
	}
}

describe("McpHub list_changed notification refresh", () => {
	let clock: sinon.SinonFakeTimers

	beforeEach(() => {
		clock = sinon.useFakeTimers()
	})

	afterEach(() => {
		clock.restore()
	})

	it("coalesces a burst of tools/list_changed into a single refresh", async () => {
		const { hub, connection, fetchToolsList, notifyWebviewOfServerChanges } = createMcpHub()

		for (let i = 0; i < 12; i++) {
			;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		}
		fetchToolsList.called.should.be.false()

		await clock.tickAsync(300)

		fetchToolsList.calledOnce.should.be.true()
		notifyWebviewOfServerChanges.calledOnce.should.be.true()
		connection.server.tools.should.deepEqual([{ name: "tool1" }])
	})

	it("refreshes resources and resource templates on resources/list_changed", async () => {
		const { hub, connection, fetchResourcesList, fetchResourceTemplatesList } = createMcpHub()
		;(hub as any).scheduleListChangedRefresh("test-server", "resources")
		await clock.tickAsync(300)

		fetchResourcesList.calledOnce.should.be.true()
		fetchResourceTemplatesList.calledOnce.should.be.true()
		connection.server.resources.should.deepEqual([{ name: "resource1" }])
		connection.server.resourceTemplates.should.deepEqual([{ name: "template1" }])
	})

	it("refreshes prompts on prompts/list_changed", async () => {
		const { hub, connection, fetchPromptsList } = createMcpHub()
		;(hub as any).scheduleListChangedRefresh("test-server", "prompts")
		await clock.tickAsync(300)

		fetchPromptsList.calledOnce.should.be.true()
		connection.server.prompts.should.deepEqual([{ name: "prompt1" }])
	})

	it("debounces per server and kind independently", async () => {
		const { hub, fetchToolsList, fetchPromptsList, notifyWebviewOfServerChanges } = createMcpHub()
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		;(hub as any).scheduleListChangedRefresh("test-server", "prompts")
		await clock.tickAsync(300)

		fetchToolsList.calledOnce.should.be.true()
		fetchPromptsList.calledOnce.should.be.true()
		notifyWebviewOfServerChanges.calledTwice.should.be.true()
	})

	it("refreshes again for notifications arriving after a flush", async () => {
		const { hub, fetchToolsList } = createMcpHub()
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		await clock.tickAsync(300)
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		await clock.tickAsync(300)

		fetchToolsList.calledTwice.should.be.true()
	})

	it("skips the refresh when the connection was deleted before the timer fired", async () => {
		const { hub, fetchToolsList, notifyWebviewOfServerChanges } = createMcpHub()
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		;(hub as any).connections = []
		await clock.tickAsync(300)

		fetchToolsList.called.should.be.false()
		notifyWebviewOfServerChanges.called.should.be.false()
	})

	it("skips the refresh when the server is disabled", async () => {
		const { hub, fetchToolsList, notifyWebviewOfServerChanges } = createMcpHub("test-server", { disabled: true })
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		await clock.tickAsync(300)

		fetchToolsList.called.should.be.false()
		notifyWebviewOfServerChanges.called.should.be.false()
	})

	it("does not reject when the refresh fails", async () => {
		const { hub, fetchToolsList } = createMcpHub()
		fetchToolsList.rejects(new Error("server went away"))
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")

		// Would surface as an unhandled rejection if the error weren't caught
		await clock.tickAsync(300)
	})

	it("keeps the previous cached list when the fetch fails", async () => {
		const { hub, connection, fetchToolsList, notifyWebviewOfServerChanges } = createMcpHub()
		connection.server.tools = [{ name: "existing" }]
		// The fetch helpers signal failure by resolving to undefined
		fetchToolsList.resolves(undefined)
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		await clock.tickAsync(300)

		connection.server.tools.should.deepEqual([{ name: "existing" }])
		notifyWebviewOfServerChanges.called.should.be.false()
	})

	it("applies the successful half of a resources refresh when the other half fails", async () => {
		const { hub, connection, fetchResourcesList, fetchResourceTemplatesList, notifyWebviewOfServerChanges } = createMcpHub()
		connection.server.resources = [{ name: "existing-resource" }]
		fetchResourcesList.resolves(undefined)
		fetchResourceTemplatesList.resolves([{ name: "template1" }])
		;(hub as any).scheduleListChangedRefresh("test-server", "resources")
		await clock.tickAsync(300)

		connection.server.resources.should.deepEqual([{ name: "existing-resource" }])
		connection.server.resourceTemplates.should.deepEqual([{ name: "template1" }])
		notifyWebviewOfServerChanges.calledOnce.should.be.true()
	})

	it("serializes overlapping refreshes so a stale response cannot overwrite a newer one", async () => {
		const { hub, connection, fetchToolsList } = createMcpHub()
		let resolveFirstFetch: (tools: Array<{ name: string }>) => void = () => {}
		fetchToolsList.onFirstCall().returns(
			new Promise((resolve) => {
				resolveFirstFetch = resolve
			}),
		)
		fetchToolsList.onSecondCall().resolves([{ name: "newer" }])

		// First refresh fires and its fetch hangs in flight
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		await clock.tickAsync(300)
		fetchToolsList.calledOnce.should.be.true()

		// Second notification arrives while the first fetch is still pending:
		// its refresh must wait for the first to finish, not run concurrently
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		await clock.tickAsync(300)
		fetchToolsList.calledOnce.should.be.true()

		resolveFirstFetch([{ name: "older" }])
		await clock.tickAsync(0)
		await clock.tickAsync(0)

		fetchToolsList.calledTwice.should.be.true()
		connection.server.tools.should.deepEqual([{ name: "newer" }])
	})

	it("drops the refresh when the connection was replaced by a reconnect mid-fetch", async () => {
		const { hub, connection, fetchToolsList, notifyWebviewOfServerChanges } = createMcpHub()
		let resolveFetch: (tools: Array<{ name: string }>) => void = () => {}
		fetchToolsList.returns(
			new Promise((resolve) => {
				resolveFetch = resolve
			}),
		)
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		await clock.tickAsync(300)
		fetchToolsList.calledOnce.should.be.true()

		// Simulate a reconnect while the fetch is in flight: the connection
		// object is replaced by a new one that fetched fresh lists at connect
		const replacement = {
			server: { ...connection.server, tools: [{ name: "fresh-from-connect" }] },
			client: {},
			transport: {},
		}
		;(hub as any).connections = [replacement]

		resolveFetch([{ name: "stale-from-old-connection" }])
		await clock.tickAsync(0)
		await clock.tickAsync(0)

		// The in-flight result must not overwrite the replacement's newer data
		replacement.server.tools.should.deepEqual([{ name: "fresh-from-connect" }])
		notifyWebviewOfServerChanges.called.should.be.false()
	})

	it("does not publish the result of an in-flight refresh superseded by a newer notification", async () => {
		const { hub, connection, fetchToolsList, notifyWebviewOfServerChanges } = createMcpHub()
		let resolveFirstFetch: (tools: Array<{ name: string }>) => void = () => {}
		fetchToolsList.onFirstCall().returns(
			new Promise((resolve) => {
				resolveFirstFetch = resolve
			}),
		)
		fetchToolsList.onSecondCall().resolves([{ name: "fresh" }])

		// First refresh fires and its fetch hangs in flight
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		await clock.tickAsync(300)
		fetchToolsList.calledOnce.should.be.true()

		// A newer notification supersedes the in-flight refresh
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		resolveFirstFetch([{ name: "stale" }])
		await clock.tickAsync(0)
		await clock.tickAsync(0)

		// The superseded run completed but must not publish its stale result
		connection.server.tools.should.deepEqual([])
		notifyWebviewOfServerChanges.called.should.be.false()

		// The superseding refresh publishes the fresh result
		await clock.tickAsync(300)
		connection.server.tools.should.deepEqual([{ name: "fresh" }])
		notifyWebviewOfServerChanges.calledOnce.should.be.true()
	})

	it("treats method-not-found and undeclared capabilities as authoritatively empty lists", async () => {
		// Exercises the real fetch helpers (not the stubbed ones) with a fake
		// client: a permanent "this server doesn't do that" answer must come
		// back as [] — publishable, no retry — not as a failure (undefined)
		const makeHubWithClient = (client: any) => {
			const hub = Object.create(McpHub.prototype) as McpHub
			;(hub as any).connections = [
				{
					server: { name: "test-server", config: "{}", status: "connected", disabled: false },
					client,
					transport: {},
				},
			]
			return hub
		}

		// Server declares the resources capability but doesn't implement
		// resources/templates/list
		const methodNotFound = makeHubWithClient({
			getServerCapabilities: () => ({ resources: {} }),
			request: sinon.stub().rejects(new McpError(ErrorCode.MethodNotFound, "Method not found")),
		})
		;((await (methodNotFound as any).fetchResourceTemplatesList("test-server")) as any).should.deepEqual([])

		// Server never declared the prompts capability: no request is made
		const noCapability = makeHubWithClient({
			getServerCapabilities: () => ({ tools: {} }),
			request: sinon.stub().rejects(new Error("should not be called")),
		})
		;((await (noCapability as any).fetchPromptsList("test-server")) as any).should.deepEqual([])
		noCapability.connections[0].client &&
			(noCapability.connections[0].client as any).request.called.should.be.false()

		// A transient error is still a failure (undefined), not an empty list
		const transient = makeHubWithClient({
			getServerCapabilities: () => ({ resources: {} }),
			request: sinon.stub().rejects(new Error("timeout")),
		})
		;((await (transient as any).fetchResourcesList("test-server")) === undefined).should.be.true()
	})

	it("retries a failed refresh with backoff and applies the eventual result", async () => {
		const { hub, connection, fetchToolsList, notifyWebviewOfServerChanges } = createMcpHub()
		connection.server.tools = [{ name: "existing" }]
		fetchToolsList.onFirstCall().resolves(undefined)
		fetchToolsList.onSecondCall().resolves([{ name: "tool1" }])
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")

		await clock.tickAsync(300)
		fetchToolsList.calledOnce.should.be.true()
		connection.server.tools.should.deepEqual([{ name: "existing" }])

		// First retry fires after the 1s backoff and succeeds
		await clock.tickAsync(1000)
		fetchToolsList.calledTwice.should.be.true()
		connection.server.tools.should.deepEqual([{ name: "tool1" }])
		notifyWebviewOfServerChanges.calledOnce.should.be.true()
	})

	it("stops retrying after the retry budget is exhausted", async () => {
		const { hub, fetchToolsList, notifyWebviewOfServerChanges } = createMcpHub()
		fetchToolsList.resolves(undefined)
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")

		// Initial attempt plus 3 retries at 1s/2s/4s backoff, then nothing more
		await clock.tickAsync(300)
		await clock.tickAsync(1000)
		await clock.tickAsync(2000)
		await clock.tickAsync(4000)
		await clock.tickAsync(60000)

		fetchToolsList.callCount.should.equal(4)
		notifyWebviewOfServerChanges.called.should.be.false()
	})

	it("retries when the fetch succeeded but publishing failed", async () => {
		const { hub, connection, fetchToolsList, notifyWebviewOfServerChanges } = createMcpHub()
		fetchToolsList.resolves([{ name: "tool1" }])
		notifyWebviewOfServerChanges.onFirstCall().rejects(new Error("settings read failed"))
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")

		// First attempt: fetch succeeds and updates the cache, but consumers
		// never saw it because the publish failed — so it must retry
		await clock.tickAsync(300)
		connection.server.tools.should.deepEqual([{ name: "tool1" }])
		notifyWebviewOfServerChanges.calledOnce.should.be.true()

		await clock.tickAsync(1000)
		notifyWebviewOfServerChanges.calledTwice.should.be.true()
	})

	it("caps how long a sustained notification stream can defer the refresh", async () => {
		const { hub, fetchToolsList } = createMcpHub()

		// Notifications arriving every 200ms would re-arm the 300ms debounce
		// forever; the 2s max-wait forces the refresh through regardless
		for (let i = 0; i < 10; i++) {
			;(hub as any).scheduleListChangedRefresh("test-server", "tools")
			await clock.tickAsync(200)
		}

		fetchToolsList.called.should.be.true()
	})

	it("supersedes an in-flight refresh during connection teardown", async () => {
		const { hub, connection, fetchToolsList, notifyWebviewOfServerChanges } = createMcpHub()
		let resolveFetch: (tools: Array<{ name: string }>) => void = () => {}
		fetchToolsList.returns(
			new Promise((resolve) => {
				resolveFetch = resolve
			}),
		)
		let resolveClose: () => void = () => {}
		;(connection as any).transport = {
			close: sinon.stub().returns(
				new Promise<void>((resolve) => {
					resolveClose = resolve
				}),
			),
		}
		;(connection as any).client = { close: sinon.stub().resolves() }

		// Refresh fires and its fetch hangs in flight
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		await clock.tickAsync(300)
		fetchToolsList.calledOnce.should.be.true()

		// deleteConnection starts and blocks awaiting transport.close(); the
		// connection must already be gone from published state in that window
		const deletion = hub.deleteConnection("test-server")
		await clock.tickAsync(0)
		;(hub as any).connections.length.should.equal(0)

		// The fetch completes inside the teardown window: its result must be
		// dropped, not published against the connection being torn down
		resolveFetch([{ name: "stale" }])
		await clock.tickAsync(0)
		await clock.tickAsync(0)
		connection.server.tools.should.deepEqual([])
		notifyWebviewOfServerChanges.called.should.be.false()

		resolveClose()
		await deletion
		;(hub as any).connections.length.should.equal(0)
	})

	it("cancels pending refreshes when the connection is deleted", async () => {
		const { hub, connection, fetchToolsList } = createMcpHub()
		;(connection as any).transport = { close: sinon.stub().resolves() }
		;(connection as any).client = { close: sinon.stub().resolves() }
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")

		await hub.deleteConnection("test-server")
		await clock.tickAsync(300)

		fetchToolsList.called.should.be.false()
	})

	it("lets a fresh notification supersede a pending retry", async () => {
		const { hub, connection, fetchToolsList } = createMcpHub()
		fetchToolsList.onFirstCall().resolves(undefined)
		fetchToolsList.onSecondCall().resolves([{ name: "tool1" }])
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		await clock.tickAsync(300)
		fetchToolsList.calledOnce.should.be.true()

		// New notification arrives while the 1s retry is pending: it replaces
		// the retry timer and runs on the normal debounce delay instead
		;(hub as any).scheduleListChangedRefresh("test-server", "tools")
		await clock.tickAsync(300)

		fetchToolsList.calledTwice.should.be.true()
		connection.server.tools.should.deepEqual([{ name: "tool1" }])
	})
})
