import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { McpHub } from "../McpHub"

function createHub(inputSchema: object) {
	const request = sinon.stub().resolves({ content: [{ type: "text", text: "ok" }] })
	const telemetry = {
		captureMcpToolCall: sinon.stub(),
	}
	const hub = {
		connections: [
			{
				server: {
					name: "builder",
					disabled: false,
					config: JSON.stringify({ type: "sse", url: "http://localhost:3000", timeout: 5 }),
					tools: [{ name: "edit", inputSchema }],
				},
				client: { request },
			},
		],
		telemetryService: telemetry,
	} as unknown as McpHub

	return { hub, request }
}

describe("McpHub.callTool argument coercion", () => {
	it("coerces JSON string values to schema-required number and boolean arguments", async () => {
		const { hub, request } = createHub({
			type: "object",
			properties: {
				location: { type: "integer" },
				analyzeStructure: { type: "boolean" },
				title: { type: "string" },
				exactLocation: { const: 8 },
				mode: { enum: [1, 2] },
				literalLocation: { anyOf: [{ const: 0 }, { const: 1 }, { const: 8 }] },
				literalFlag: { oneOf: [{ const: true }, { const: false }] },
			},
		})

		await McpHub.prototype.callTool.call(
			hub,
			"builder",
			"edit",
			{
				location: "8",
				analyzeStructure: "true",
				title: "8",
				exactLocation: "8",
				mode: "2",
				literalLocation: "8",
				literalFlag: "true",
			},
			"ulid-1",
		)

		assert.deepEqual(request.firstCall.args[0].params.arguments, {
			location: 8,
			analyzeStructure: true,
			title: "8",
			exactLocation: 8,
			mode: 2,
			literalLocation: 8,
			literalFlag: true,
		})
	})

	it("leaves invalid or ambiguous string values unchanged", async () => {
		const { hub, request } = createHub({
			type: "object",
			properties: {
				count: { type: "integer" },
				flag: { type: "boolean" },
				ambiguous: { enum: ["1", 1] },
				malformedEnum: { enum: 1 },
				stringOrInteger: { anyOf: [{ type: "string" }, { type: "integer" }] },
				nested: {
					type: "object",
					properties: {
						enabled: { type: "boolean" },
					},
				},
			},
		})

		await McpHub.prototype.callTool.call(
			hub,
			"builder",
			"edit",
			{
				count: "08",
				flag: "TRUE",
				ambiguous: "1",
				malformedEnum: "1",
				stringOrInteger: "8",
				nested: {
					enabled: "false",
				},
			},
			"ulid-1",
		)

		assert.deepEqual(request.firstCall.args[0].params.arguments, {
			count: "08",
			flag: "TRUE",
			ambiguous: "1",
			malformedEnum: "1",
			stringOrInteger: "8",
			nested: {
				enabled: false,
			},
		})
	})
})
