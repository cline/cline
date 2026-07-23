import { describe, it } from "bun:test"
import "should"
import { McpSettingsSchema, ServerConfigSchema } from "../schemas"

/**
 * Unit tests for MCP settings schema parsing.
 *
 * Covers three formats:
 *  1. "Nested transport" format written by the Cline CLI (`cline mcp add`)
 *  2. "Flat" legacy format accepted by the VSCode extension before this change
 *  3. Invalid configs that must still be rejected
 */
describe("McpSettingsSchema", () => {
	// -------------------------------------------------------------------------
	// Nested transport format (written by the Cline CLI)
	// -------------------------------------------------------------------------

	describe("nested transport format (CLI-authored)", () => {
		it("accepts a streamableHttp server written by the CLI", () => {
			const input = {
				mcpServers: {
					linear: {
						transport: {
							type: "streamableHttp",
							url: "https://mcp.linear.app/mcp",
						},
					},
				},
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()

			const server = result.data!.mcpServers["linear"]
			server.type.should.equal("streamableHttp")
			;(server as any).url.should.equal("https://mcp.linear.app/mcp")
		})

		it("accepts a SSE server with headers in nested format", () => {
			const input = {
				mcpServers: {
					myServer: {
						transport: {
							type: "sse",
							url: "https://mcp.example.com/sse",
							headers: { Authorization: "Bearer tok" },
						},
						disabled: true,
					},
				},
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()

			const server = result.data!.mcpServers["myServer"]
			server.type.should.equal("sse")
			;(server as any).url.should.equal("https://mcp.example.com/sse")
			;(server as any).headers.should.deepEqual({ Authorization: "Bearer tok" })
			server.disabled!.should.be.true()
		})

		it("accepts a stdio server in nested format", () => {
			const input = {
				mcpServers: {
					docs: {
						transport: {
							type: "stdio",
							command: "npx",
							args: ["-y", "@modelcontextprotocol/server-filesystem"],
						},
					},
				},
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()

			const server = result.data!.mcpServers["docs"]
			server.type.should.equal("stdio")
			;(server as any).command.should.equal("npx")
		})

		it("preserves oauth field from CLI-authored nested format", () => {
			const oauthState = {
				tokens: { access_token: "tok", token_type: "Bearer" },
				lastAuthenticatedAt: 1700000000,
			}
			const input = {
				mcpServers: {
					linear: {
						transport: { type: "streamableHttp", url: "https://mcp.linear.app/mcp" },
						oauth: oauthState,
					},
				},
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()
			;(result.data!.mcpServers["linear"] as any).oauth.should.deepEqual(oauthState)
		})

		it("preserves metadata field from CLI-authored nested format", () => {
			const metadata = { addedBy: "cline-cli", version: "1.2.3" }
			const input = {
				mcpServers: {
					myServer: {
						transport: { type: "streamableHttp", url: "https://mcp.example.com/mcp" },
						metadata,
					},
				},
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()
			;(result.data!.mcpServers["myServer"] as any).metadata.should.deepEqual(metadata)
		})

		it("preserves autoApprove and timeout alongside nested transport", () => {
			const input = {
				mcpServers: {
					myServer: {
						transport: { type: "streamableHttp", url: "https://mcp.example.com/mcp" },
						autoApprove: ["my_tool"],
						timeout: 120,
					},
				},
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()

			const server = result.data!.mcpServers["myServer"]
			server.autoApprove!.should.deepEqual(["my_tool"])
			server.timeout.should.equal(120)
		})

		it("rejects nested format with an invalid transport type", () => {
			const input = {
				mcpServers: {
					bad: {
						transport: { type: "unknownTransport", url: "https://mcp.example.com/mcp" },
					},
				},
			}
			McpSettingsSchema.safeParse(input).success.should.be.false()
		})

		it("rejects nested stdio transport with empty command", () => {
			const input = {
				mcpServers: {
					bad: {
						transport: { type: "stdio", command: "" }, // empty — min(1) fails
					},
				},
			}
			McpSettingsSchema.safeParse(input).success.should.be.false()
		})
	})

	// -------------------------------------------------------------------------
	// Flat legacy format (written by the VSCode extension)
	// -------------------------------------------------------------------------

	describe("flat legacy format (extension-authored)", () => {
		it("accepts a flat streamableHttp server", () => {
			const input = {
				mcpServers: {
					myServer: {
						type: "streamableHttp",
						url: "https://mcp.example.com/mcp",
						autoApprove: [],
						timeout: 60,
					},
				},
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()

			const server = result.data!.mcpServers["myServer"]
			server.type.should.equal("streamableHttp")
			;(server as any).url.should.equal("https://mcp.example.com/mcp")
		})

		it("accepts legacy transportType streamableHttp in MCP settings", () => {
			const input = {
				mcpServers: {
					strictServer: {
						transportType: "streamableHttp",
						url: "http://localhost:8000/mcp",
					},
				},
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()

			const server = result.data!.mcpServers["strictServer"]
			server.type.should.equal("streamableHttp")
			;((server as any).transportType === undefined).should.be.true()
		})

		it("accepts legacy transportType http for URL servers", () => {
			const result = ServerConfigSchema.safeParse({
				transportType: "http",
				url: "http://localhost:8000/mcp",
			})

			result.success.should.be.true()
			const server = result.data!
			server.type.should.equal("streamableHttp")
			;((server as any).transportType === undefined).should.be.true()
		})

		it("accepts a flat stdio server with no explicit type", () => {
			const input = {
				mcpServers: {
					docs: {
						command: "npx",
						args: ["-y", "@modelcontextprotocol/server-filesystem"],
					},
				},
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()
			result.data!.mcpServers["docs"].type.should.equal("stdio")
		})

		it("accepts a flat SSE server with no explicit type (legacy default)", () => {
			const input = {
				mcpServers: { legacy: { url: "https://mcp.example.com/sse" } },
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()
			// Without a type field, the flat schema defaults to "sse"
			result.data!.mcpServers["legacy"].type.should.equal("sse")
		})

		it("rejects unknown legacy transportType values for URL servers", () => {
			const result = ServerConfigSchema.safeParse({
				transportType: "websocket",
				url: "http://localhost:8000/mcp",
			})

			result.success.should.be.false()
		})

		it("preserves oauth on flat-format servers (round-trip from write-back)", () => {
			const oauthState = { tokens: { access_token: "tok" } }
			const input = {
				mcpServers: {
					myServer: {
						type: "streamableHttp",
						url: "https://mcp.example.com/mcp",
						oauth: oauthState,
					},
				},
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()
			;(result.data!.mcpServers["myServer"] as any).oauth.should.deepEqual(oauthState)
		})
	})

	// -------------------------------------------------------------------------
	// Mixed format — CLI and extension servers in the same file
	// -------------------------------------------------------------------------

	describe("mixed format (CLI and extension servers in the same file)", () => {
		it("accepts a file with both nested and flat servers", () => {
			const input = {
				mcpServers: {
					cliServer: {
						transport: { type: "streamableHttp", url: "https://mcp.linear.app/mcp" },
						oauth: { tokens: {} },
					},
					extensionServer: {
						command: "node",
						args: ["server.js"],
						autoApprove: ["tool1"],
					},
				},
			}

			const result = McpSettingsSchema.safeParse(input)
			result.success.should.be.true()

			result.data!.mcpServers["cliServer"].type.should.equal("streamableHttp")
			result.data!.mcpServers["extensionServer"].type.should.equal("stdio")
		})
	})

	// -------------------------------------------------------------------------
	// ServerConfigSchema – direct usage
	// -------------------------------------------------------------------------

	describe("ServerConfigSchema direct parse", () => {
		it("normalises nested format to flat (no transport key in output)", () => {
			const result = ServerConfigSchema.safeParse({
				transport: { type: "streamableHttp", url: "https://mcp.example.com" },
			})
			result.success.should.be.true()
			const flat = result.data!
			;(flat as any).type.should.equal("streamableHttp")
			;(flat as any).url.should.equal("https://mcp.example.com")
			// `transport` key must NOT be present on the output
			;("transport" in flat).should.be.false()
		})
	})
})
