import { describe, expect, it } from "bun:test"
import { convertMcpServersToProtoMcpServers, projectMcpServerConfigForWebview } from "./mcp-server-conversion"

describe("MCP server proto conversion", () => {
	it("projects only non-secret config fields for the webview", () => {
		const config = JSON.stringify({
			type: "streamableHttp",
			url: "https://mcp.example.com/connect?api_key=url-secret#state-secret",
			timeout: 120,
			remoteConfigured: true,
			headers: { Authorization: "Bearer header-secret" },
			env: { API_KEY: "env-secret" },
			args: ["--token", "argument-secret"],
			oauth: {
				tokens: { access_token: "access-secret", refresh_token: "refresh-secret" },
				codeVerifier: "verifier-secret",
			},
		})

		const [converted] = convertMcpServersToProtoMcpServers([
			{
				name: "remote",
				config,
				status: "connected",
				error: "Request failed: Authorization: Bearer diagnostic-secret",
			},
		])

		expect(JSON.parse(converted.config)).toEqual({
			type: "streamableHttp",
			url: "https://mcp.example.com/connect?[REDACTED]",
			timeout: 120,
			remoteConfigured: true,
		})
		expect(converted.config).not.toContain("secret")
		expect(converted.error).toBe("Request failed: Authorization: [REDACTED]")
	})

	it("returns an empty projection for malformed config", () => {
		expect(projectMcpServerConfigForWebview("not-json")).toBe("{}")
	})
})
