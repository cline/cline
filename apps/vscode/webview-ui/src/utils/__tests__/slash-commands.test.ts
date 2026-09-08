import type { McpServer } from "@shared/mcp"
import type { SlashCommandInfo } from "@shared/proto/cline/slash"
import { describe, expect, it } from "vitest"
import {
	getAllSlashCommands,
	getMatchingSlashCommands,
	getMcpPromptCommands,
	getRuntimeSlashCommands,
	getSlashCommandsQuery,
	shouldShowSlashCommandsMenu,
	slashCommandRegex,
	validateSlashCommand,
} from "../slash-commands"

// Helper to create a host-served runtime command (what getAvailableSlashCommands returns)
function runtimeCommand(overrides: Partial<SlashCommandInfo> & Pick<SlashCommandInfo, "name" | "kind">): SlashCommandInfo {
	return {
		description: "",
		section: overrides.kind === "skill" ? "skill" : "custom",
		cliCompatible: true,
		...overrides,
	}
}

// Helper to create a mock MCP server
function createMockMcpServer(overrides: Partial<McpServer> = {}): McpServer {
	return {
		name: "test-server",
		status: "connected",
		config: "{}",
		prompts: [],
		tools: [],
		resources: [],
		resourceTemplates: [],
		...overrides,
	}
}

describe("slash-commands", () => {
	describe("getMcpPromptCommands", () => {
		it("should return empty array when no servers provided", () => {
			const result = getMcpPromptCommands([])
			expect(result).toEqual([])
		})

		it("should return empty array when servers have no prompts", () => {
			const servers = [createMockMcpServer({ prompts: [] })]
			const result = getMcpPromptCommands(servers)
			expect(result).toEqual([])
		})

		it("should skip disconnected servers", () => {
			const servers = [
				createMockMcpServer({
					status: "disconnected",
					prompts: [{ name: "test-prompt", description: "A test prompt" }],
				}),
			]
			const result = getMcpPromptCommands(servers)
			expect(result).toEqual([])
		})

		it("should skip servers with connecting status", () => {
			const servers = [
				createMockMcpServer({
					status: "connecting",
					prompts: [{ name: "test-prompt", description: "A test prompt" }],
				}),
			]
			const result = getMcpPromptCommands(servers)
			expect(result).toEqual([])
		})

		it("should generate commands for connected servers with prompts", () => {
			const servers = [
				createMockMcpServer({
					name: "my-server",
					prompts: [{ name: "summarize", description: "Summarize text" }],
				}),
			]
			const result = getMcpPromptCommands(servers)
			expect(result).toEqual([
				{
					name: "mcp:my-server:summarize",
					description: "Summarize text",
					section: "mcp",
					kind: "mcp-prompt",
				},
			])
		})

		it("should use title as fallback description", () => {
			const servers = [
				createMockMcpServer({
					name: "server",
					prompts: [{ name: "prompt", title: "My Prompt Title" }],
				}),
			]
			const result = getMcpPromptCommands(servers)
			expect(result[0].description).toBe("My Prompt Title")
		})

		it("should use default description when no description or title", () => {
			const servers = [
				createMockMcpServer({
					name: "server",
					prompts: [{ name: "prompt" }],
				}),
			]
			const result = getMcpPromptCommands(servers)
			expect(result[0].description).toBe("MCP prompt from server")
		})

		it("should handle multiple prompts from single server", () => {
			const servers = [
				createMockMcpServer({
					name: "multi-server",
					prompts: [
						{ name: "prompt1", description: "First prompt" },
						{ name: "prompt2", description: "Second prompt" },
						{ name: "prompt3", description: "Third prompt" },
					],
				}),
			]
			const result = getMcpPromptCommands(servers)
			expect(result).toHaveLength(3)
			expect(result.map((c) => c.name)).toEqual([
				"mcp:multi-server:prompt1",
				"mcp:multi-server:prompt2",
				"mcp:multi-server:prompt3",
			])
		})

		it("should handle multiple servers with prompts", () => {
			const servers = [
				createMockMcpServer({
					name: "server-a",
					prompts: [{ name: "promptA", description: "From A" }],
				}),
				createMockMcpServer({
					name: "server-b",
					prompts: [{ name: "promptB", description: "From B" }],
				}),
			]
			const result = getMcpPromptCommands(servers)
			expect(result).toHaveLength(2)
			expect(result[0].name).toBe("mcp:server-a:promptA")
			expect(result[1].name).toBe("mcp:server-b:promptB")
		})

		it("should skip servers with undefined prompts", () => {
			const servers = [
				createMockMcpServer({
					name: "server",
					prompts: undefined,
				}),
			]
			const result = getMcpPromptCommands(servers)
			expect(result).toEqual([])
		})
	})

	describe("getMatchingSlashCommands with default commands", () => {
		it("shows /compact for the comp prefix", () => {
			const result = getMatchingSlashCommands("comp")

			expect(result).toContainEqual({
				name: "compact",
				description: "Condenses your current context window",
				section: "default",
				cliCompatible: true,
			})
		})
	})

	describe("getMatchingSlashCommands with MCP servers", () => {
		const mcpServers = [
			createMockMcpServer({
				name: "test-server",
				prompts: [
					{ name: "summarize", description: "Summarize content" },
					{ name: "translate", description: "Translate text" },
				],
			}),
		]

		it("should include MCP commands in results when no query", () => {
			const result = getMatchingSlashCommands("", [], mcpServers)
			const mcpCommands = result.filter((cmd) => cmd.section === "mcp")
			expect(mcpCommands).toHaveLength(2)
		})

		it("should filter MCP commands by query prefix", () => {
			const result = getMatchingSlashCommands("mcp:test", [], mcpServers)
			const mcpCommands = result.filter((cmd) => cmd.section === "mcp")
			expect(mcpCommands).toHaveLength(2)
		})

		it("should filter to specific MCP prompt", () => {
			const result = getMatchingSlashCommands("mcp:test-server:sum", [], mcpServers)
			expect(result).toHaveLength(1)
			expect(result[0].name).toBe("mcp:test-server:summarize")
		})

		it("should return empty for non-matching MCP query", () => {
			const result = getMatchingSlashCommands("mcp:nonexistent", [], mcpServers)
			expect(result).toHaveLength(0)
		})
	})

	describe("validateSlashCommand with MCP servers", () => {
		const mcpServers = [
			createMockMcpServer({
				name: "server",
				prompts: [{ name: "prompt", description: "Test" }],
			}),
		]

		it("should return full for exact MCP command match", () => {
			const result = validateSlashCommand("mcp:server:prompt", [], mcpServers)
			expect(result).toBe("full")
		})

		it("should return partial for partial MCP command match", () => {
			const result = validateSlashCommand("mcp:server:pro", [], mcpServers)
			expect(result).toBe("partial")
		})

		it("should return partial for server prefix only", () => {
			const result = validateSlashCommand("mcp:serv", [], mcpServers)
			expect(result).toBe("partial")
		})

		it("should return null for non-matching MCP command", () => {
			const result = validateSlashCommand("mcp:unknown:cmd", [], mcpServers)
			expect(result).toBe(null)
		})
	})

	describe("slashCommandRegex with MCP format", () => {
		it("should match MCP command format with colons", () => {
			const text = "/mcp:server:prompt"
			const match = text.match(slashCommandRegex)
			expect(match).not.toBeNull()
			expect(match![2]).toBe("/mcp:server:prompt")
		})

		it("should match MCP command in middle of text", () => {
			const text = "Please run /mcp:server:prompt now"
			const match = text.match(slashCommandRegex)
			expect(match).not.toBeNull()
			expect(match![2]).toBe("/mcp:server:prompt")
		})

		it("should not match MCP-like pattern in URL", () => {
			const text = "http://example.com/mcp:test"
			const match = text.match(slashCommandRegex)
			// Should not match because / is not preceded by whitespace or start
			expect(match).toBeNull()
		})
	})

	describe("runtime skills and workflows from the host", () => {
		const runtime = [
			runtimeCommand({ name: "aws-deploy", kind: "skill", description: "Deploy to AWS." }),
			runtimeCommand({ name: "release", kind: "workflow" }),
			runtimeCommand({ name: "compact", kind: "builtin", description: "host copy of a builtin" }),
		]

		it("converts host skills and workflows into menu entries and ignores host builtins", () => {
			expect(getRuntimeSlashCommands(runtime)).toEqual([
				{ name: "aws-deploy", description: "Deploy to AWS.", section: "skill", kind: "skill", cliCompatible: true },
				{ name: "release", description: undefined, section: "custom", kind: "workflow", cliCompatible: true },
			])
		})

		it("lists skills in the menu, between built-ins and workflows", () => {
			const names = getMatchingSlashCommands("", runtime).map((cmd) => cmd.name)
			const skillIndex = names.indexOf("aws-deploy")
			expect(skillIndex).toBeGreaterThan(names.indexOf("compact"))
			expect(skillIndex).toBeLessThan(names.indexOf("release"))
			expect(getMatchingSlashCommands("", runtime).find((cmd) => cmd.name === "aws-deploy")?.section).toBe("skill")
		})

		it("filters skills by typed prefix, case-insensitively", () => {
			expect(getMatchingSlashCommands("AWS", runtime).map((cmd) => cmd.name)).toEqual(["aws-deploy"])
			expect(getMatchingSlashCommands("rel", runtime).map((cmd) => cmd.name)).toEqual(["release"])
		})

		it("validates a typed skill as full or partial so the input highlights it", () => {
			expect(validateSlashCommand("aws-deploy", runtime)).toBe("full")
			expect(validateSlashCommand("aws", runtime)).toBe("partial")
			expect(validateSlashCommand("aws-deploy", [])).toBeNull()
		})

		it("lists a skill once when the host reports the same token from two scopes", () => {
			// Mirrors the local/global dedupe case from #13890: a project and a global
			// skill with the same name must not produce two menu rows.
			const duplicated = [
				runtimeCommand({ name: "aws-deploy", kind: "skill", description: "Project copy" }),
				runtimeCommand({ name: "aws-deploy", kind: "skill", description: "Global copy" }),
			]
			const rows = getMatchingSlashCommands("aws", duplicated)
			expect(rows).toHaveLength(1)
			expect(rows[0].description).toBe("Project copy")
		})

		it("never lets a user command shadow a built-in or an MCP prompt shadow a skill", () => {
			const shadowing = [runtimeCommand({ name: "compact", kind: "skill", description: "a skill named compact" })]
			const mcpServers = [createMockMcpServer({ name: "s", prompts: [{ name: "p" }] })]
			const skillLikeMcp = [
				runtimeCommand({ name: "mcp:s:p", kind: "skill", description: "skill spelled like an MCP prompt" }),
			]

			const compact = getAllSlashCommands(shadowing).filter((cmd) => cmd.name === "compact")
			expect(compact).toHaveLength(1)
			expect(compact[0].section).toBe("default")

			const mcp = getAllSlashCommands(skillLikeMcp, mcpServers).filter((cmd) => cmd.name === "mcp:s:p")
			expect(mcp).toHaveLength(1)
			expect(mcp[0].section).toBe("skill")
		})
	})

	describe("shouldShowSlashCommandsMenu / getSlashCommandsQuery", () => {
		it("opens for a command being typed and reports the typed prefix", () => {
			expect(shouldShowSlashCommandsMenu("/aws", 4)).toBe(true)
			expect(getSlashCommandsQuery("/aws", 4)).toBe("aws")
			expect(shouldShowSlashCommandsMenu("run /aws", 8)).toBe(true)
			expect(getSlashCommandsQuery("run /aws", 8)).toBe("aws")
		})

		it("stays closed for paths, completed commands, and second commands", () => {
			expect(shouldShowSlashCommandsMenu("src/utils", 9)).toBe(false)
			expect(shouldShowSlashCommandsMenu("/aws-deploy now", 15)).toBe(false)
			expect(shouldShowSlashCommandsMenu("/aws-deploy then /rel", 21)).toBe(false)
			expect(getSlashCommandsQuery("/aws-deploy now", 15)).toBe("")
		})
	})
})
