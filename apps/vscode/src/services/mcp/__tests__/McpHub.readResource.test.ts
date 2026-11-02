import { describe, it } from "bun:test"
import "should"
import sinon from "sinon"
import { McpHub } from "../McpHub"

function createMcpHub(options: { disabled?: boolean; client?: { request: sinon.SinonStub } | null } = {}) {
	const client =
		options.client === null
			? undefined
			: (options.client ?? {
					request: sinon.stub().resolves({
						contents: [
							{ uri: "ui://weather/view.html", mimeType: "text/html;profile=mcp-app", text: "<html></html>" },
						],
					}),
				})
	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).connections = [
		{
			server: {
				name: "weather",
				config: JSON.stringify({ type: "stdio", command: "test", timeout: 60 }),
				status: "connected",
				disabled: options.disabled ?? false,
			},
			client,
			transport: {},
		},
	]
	return { hub, client }
}

describe("McpHub.readResource", () => {
	it("sends resources/read with the server timeout and abort signal", async () => {
		const { hub, client } = createMcpHub()
		const controller = new AbortController()

		const result = await hub.readResource("weather", "ui://weather/view.html", controller.signal)

		result.contents[0].uri.should.equal("ui://weather/view.html")
		const [request, , options] = client!.request.firstCall.args
		request.should.deepEqual({ method: "resources/read", params: { uri: "ui://weather/view.html" } })
		options.should.deepEqual({ timeout: 60_000, signal: controller.signal })
	})

	it("rejects unknown, disabled, and disconnected servers", async () => {
		await createMcpHub()
			.hub.readResource("missing", "ui://x")
			.should.be.rejectedWith(/No connection found/)
		await createMcpHub({ disabled: true })
			.hub.readResource("weather", "ui://x")
			.should.be.rejectedWith(/disabled/)
		await createMcpHub({ client: null })
			.hub.readResource("weather", "ui://x")
			.should.be.rejectedWith(/not connected/)
	})
})
