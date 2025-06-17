// npx vitest run src/shared/__tests__/combineCommandSequences.spec.ts

import type { ClineMessage } from "@roo-code/types"

import { combineCommandSequences } from "../combineCommandSequences"

describe("combineCommandSequences", () => {
	describe("command sequences", () => {
		it("should combine command and command_output messages", () => {
			const messages: ClineMessage[] = [
				{ type: "ask", ask: "command", text: "ls", ts: 1625097600000 },
				{ type: "ask", ask: "command_output", text: "file1.txt", ts: 1625097601000 },
				{ type: "ask", ask: "command_output", text: "file2.txt", ts: 1625097602000 },
			]

			const result = combineCommandSequences(messages)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				type: "ask",
				ask: "command",
				text: "ls\nOutput:file1.txt\nfile2.txt",
				ts: 1625097600000,
			})
		})
	})

	describe("MCP server responses", () => {
		it("should combine use_mcp_server and mcp_server_response messages", () => {
			const messages: ClineMessage[] = [
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({
						serverName: "test-server",
						toolName: "test-tool",
						arguments: { param: "value" },
					}),
					ts: 1625097600000,
				},
				{ type: "say", say: "mcp_server_response", text: "Response data", ts: 1625097601000 },
			]

			const result = combineCommandSequences(messages)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				type: "ask",
				ask: "use_mcp_server",
				text: JSON.stringify({
					serverName: "test-server",
					toolName: "test-tool",
					arguments: { param: "value" },
					response: "Response data",
				}),
				ts: 1625097600000,
			})
		})

		it("should handle multiple mcp_server_response messages", () => {
			const messages: ClineMessage[] = [
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({
						serverName: "test-server",
						toolName: "test-tool",
						arguments: { param: "value" },
					}),
					ts: 1625097600000,
				},
				{ type: "say", say: "mcp_server_response", text: "First response", ts: 1625097601000 },
				{ type: "say", say: "mcp_server_response", text: "Second response", ts: 1625097602000 },
			]

			const result = combineCommandSequences(messages)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				type: "ask",
				ask: "use_mcp_server",
				text: JSON.stringify({
					serverName: "test-server",
					toolName: "test-tool",
					arguments: { param: "value" },
					response: "First response\nSecond response",
				}),
				ts: 1625097600000,
			})
		})

		it("should handle multiple MCP server requests", () => {
			const messages: ClineMessage[] = [
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({
						serverName: "test-server-1",
						toolName: "test-tool-1",
						arguments: { param: "value1" },
					}),
					ts: 1625097600000,
				},
				{ type: "say", say: "mcp_server_response", text: "Response 1", ts: 1625097601000 },
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({
						serverName: "test-server-2",
						toolName: "test-tool-2",
						arguments: { param: "value2" },
					}),
					ts: 1625097602000,
				},
				{ type: "say", say: "mcp_server_response", text: "Response 2", ts: 1625097603000 },
			]

			const result = combineCommandSequences(messages)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({
				type: "ask",
				ask: "use_mcp_server",
				text: JSON.stringify({
					serverName: "test-server-1",
					toolName: "test-tool-1",
					arguments: { param: "value1" },
					response: "Response 1",
				}),
				ts: 1625097600000,
			})
			expect(result[1]).toEqual({
				type: "ask",
				ask: "use_mcp_server",
				text: JSON.stringify({
					serverName: "test-server-2",
					toolName: "test-tool-2",
					arguments: { param: "value2" },
					response: "Response 2",
				}),
				ts: 1625097602000,
			})
		})
	})

	describe("mixed sequences", () => {
		it("should handle both command and MCP server sequences", () => {
			const messages: ClineMessage[] = [
				{ type: "ask", ask: "command", text: "ls", ts: 1625097600000 },
				{ type: "ask", ask: "command_output", text: "file1.txt", ts: 1625097601000 },
				{
					type: "ask",
					ask: "use_mcp_server",
					text: JSON.stringify({
						serverName: "test-server",
						toolName: "test-tool",
						arguments: { param: "value" },
					}),
					ts: 1625097602000,
				},
				{ type: "say", say: "mcp_server_response", text: "MCP response", ts: 1625097603000 },
			]

			const result = combineCommandSequences(messages)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({
				type: "ask",
				ask: "command",
				text: "ls\nOutput:file1.txt",
				ts: 1625097600000,
			})
			expect(result[1]).toEqual({
				type: "ask",
				ask: "use_mcp_server",
				text: JSON.stringify({
					serverName: "test-server",
					toolName: "test-tool",
					arguments: { param: "value" },
					response: "MCP response",
				}),
				ts: 1625097602000,
			})
		})
	})
})
