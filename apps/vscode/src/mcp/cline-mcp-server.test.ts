import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { ClineMcpServer, type ClineMcpToolHandlerProvider } from "./cline-mcp-server"

describe("ClineMcpServer", () => {
	let server: ClineMcpServer
	let mockHandlerProvider: ClineMcpToolHandlerProvider
	let activeState = true

	beforeEach(() => {
		activeState = true
		mockHandlerProvider = {
			isEnvironmentActive: () => activeState,
			readFile: async ({ path }) => ({ success: true, content: `Content of ${path}` }),
			applyDiff: async ({ path, diff }) => ({ success: true, diff }),
			writeFile: async ({ path }) => ({ success: true, path }),
			runTerminal: async ({ command }) => ({ success: true, exitCode: 0, output: `Ran ${command}` }),
			searchFiles: async ({ query }) => ({ success: true, results: [`file1_${query}.txt`] }),
			listFiles: async ({ path }) => ({ success: true, files: ["file1.txt", "file2.txt"] }),
		}

		server = new ClineMcpServer({
			port: 3999, // test port
			handlerProvider: mockHandlerProvider,
		})
	})

	afterEach(async () => {
		await server.stop()
	})

	it("starts and stops properly", async () => {
		expect(server.listening).toBe(false)
		await server.start()
		expect(server.listening).toBe(true)
		await server.stop()
		expect(server.listening).toBe(false)
	})

	it("responds to /ping", async () => {
		await server.start()
		const res = await fetch("http://127.0.0.1:3999/ping")
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.status).toBe("ok")
		expect(data.active).toBe(true)
		expect(data.port).toBe(3999)
	})

	it("handles initialize method for MCP clients", async () => {
		await server.start()
		const res = await fetch("http://127.0.0.1:3999/mcp", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { protocolVersion: "2024-11-05" },
			}),
		})
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.result.protocolVersion).toBe("2024-11-05")
		expect(data.result.serverInfo.name).toBe("cline-mcp-server")
	})

	it("returns list of available tools for tools/list", async () => {
		await server.start()
		const res = await fetch("http://127.0.0.1:3999/mcp", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
			}),
		})
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.result.tools.length).toBeGreaterThanOrEqual(6)
		expect(data.result.tools.map((t: any) => t.name)).toContain("read_file")
	})

	it("executes read_file tool call with standard MCP content array", async () => {
		await server.start()
		const res = await fetch("http://127.0.0.1:3999/mcp", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: {
					name: "read_file",
					arguments: { path: "test.txt" },
				},
			}),
		})
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.result.isError).toBe(false)
		expect(data.result.content).toBeDefined()
		expect(data.result.content[0].type).toBe("text")
		expect(data.result.success).toBe(true)
	})

	it("rejects tool calls when environment is unavailable", async () => {
		activeState = false
		await server.start()
		const res = await fetch("http://127.0.0.1:3999/mcp", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name: "read_file",
					arguments: { path: "test.txt" },
				},
			}),
		})
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.error.code).toBe(-32001)
	})
})
