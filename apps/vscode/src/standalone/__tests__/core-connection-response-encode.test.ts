import { afterEach, describe, expect, it } from "bun:test"
import { serviceHandlers, serviceResponseEncoders } from "@generated/hosts/vscode/protobus-services"
import { McpServer, McpServerStatus, McpServers } from "@shared/proto/cline/mcp"
import { encodeCoreConnectionResponse, encodeCoreConnectionResponseMessage } from "../core-connection-dispatcher"

/**
 * Responses leave over the core connection as JSON and are decoded on the other
 * side with ts-proto's fromJSON, which expects proto3 JSON. These tests pin the
 * dispatcher's encode step: handler results are converted with the generated
 * toJSON (the mirror of the request-side fromJSON decode) instead of having
 * their raw ts-proto object shape stringified, and a result that violates its
 * response proto falls back to the raw object rather than failing the RPC.
 */
describe("core connection response encoding", () => {
	const originalConsoleLog = console.log
	afterEach(() => {
		console.log = originalConsoleLog
	})

	// One getter for every stage so the on-the-wire and post-decode assertions
	// can't dereference different paths.
	const getStatus = (obj: any) => obj?.mcpServers?.[0]?.status

	it("encodes enum values as proto3 names that fromJSON round-trips", () => {
		const response = McpServers.create({
			mcpServers: [McpServer.create({ name: "server", status: McpServerStatus.MCP_SERVER_STATUS_CONNECTED })],
		})

		const encoded = encodeCoreConnectionResponseMessage("cline.McpService", "getLatestMcpServers", response)
		const wireJson = JSON.parse(JSON.stringify(encoded))

		expect(getStatus(wireJson)).toBe("MCP_SERVER_STATUS_CONNECTED")
		expect(getStatus(McpServers.fromJSON(wireJson))).toBe(McpServerStatus.MCP_SERVER_STATUS_CONNECTED)
	})

	it("drops extra non-proto fields before the wire", () => {
		// serviceHandlers is Record<string, any>, so nothing stops a handler from
		// returning more than its response proto declares. fromJSON would discard
		// the extras on the receiving side anyway; encoding makes that explicit
		// and symmetric with the in-process VS Code path never seeing this code.
		const handlerResult = { value: "https://example.test/redirect", legacyExtra: true }

		const encoded = encodeCoreConnectionResponseMessage("cline.AccountService", "getRedirectUrl", handlerResult) as any

		expect(encoded.value).toBe("https://example.test/redirect")
		expect("legacyExtra" in encoded).toBe(false)
	})

	it("falls back to the raw message when the handler result violates its response proto", () => {
		const logged: string[] = []
		console.log = (...args: unknown[]) => {
			logged.push(args.join(" "))
		}
		// A null element inside a repeated message field stringifies fine today
		// but makes toJSON throw; the encoder must not turn that into an RPC error.
		const malformed = { mcpServers: [null] }

		const encoded = encodeCoreConnectionResponseMessage("cline.McpService", "getLatestMcpServers", malformed)

		expect(encoded).toBe(malformed)
		expect(logged.filter((line) => line.includes("Failed to encode cline.McpService.getLatestMcpServers")).length).toBe(1)
	})

	it("encodes the payload of a controller response message and leaves the envelope alone", () => {
		const response = McpServers.create({
			mcpServers: [McpServer.create({ name: "server", status: McpServerStatus.MCP_SERVER_STATUS_CONNECTED })],
		})

		const encoded = encodeCoreConnectionResponse("cline.McpService", "getLatestMcpServers", {
			type: "grpc_response",
			grpc_response: { request_id: "r1", message: response, is_streaming: true },
		})

		expect(encoded.grpc_response?.request_id).toBe("r1")
		expect(encoded.grpc_response?.is_streaming).toBe(true)
		expect(getStatus(encoded.grpc_response?.message)).toBe("MCP_SERVER_STATUS_CONNECTED")
	})

	it("passes messages with no payload through untouched", () => {
		const errorOnly = { type: "grpc_response" as const, grpc_response: { request_id: "r2", error: "boom" } }
		expect(encodeCoreConnectionResponse("cline.McpService", "getLatestMcpServers", errorOnly)).toBe(errorOnly)
		const notAResponse = { type: "grpc_response" as const }
		expect(encodeCoreConnectionResponse("cline.McpService", "getLatestMcpServers", notAResponse)).toBe(notAResponse)
	})

	it("passes unknown services and methods through untouched", () => {
		const message = { anything: "goes" }
		expect(encodeCoreConnectionResponseMessage("cline.NoSuchService", "noSuchMethod", message)).toBe(message)
		expect(encodeCoreConnectionResponseMessage("cline.McpService", "noSuchMethod", message)).toBe(message)
	})

	it("has an encoder for every registered protobus handler", () => {
		for (const [serviceName, handlers] of Object.entries(serviceHandlers)) {
			const encoders = serviceResponseEncoders[serviceName]
			expect(encoders).toBeDefined()
			for (const methodName of Object.keys(handlers)) {
				expect(typeof encoders[methodName]).toBe("function")
			}
		}
	})
})
