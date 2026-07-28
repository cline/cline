import { afterEach, beforeEach, describe, it } from "bun:test"
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
})
