import { describe, expect, it } from "bun:test"
import {
	computeMcpConnectionFingerprint,
	configsRequireMcpRestart,
	serializeMcpServerConfigForDisplay,
} from "../connection-config"
import { ServerConfigSchema } from "../schemas"
import type { McpServerConfig } from "../types"

function parseConfig(oauthClient: Record<string, unknown>, oauth: Record<string, unknown> = {}): McpServerConfig {
	return ServerConfigSchema.parse({
		type: "streamableHttp",
		url: "https://mcp.example.com/mcp",
		headers: { "X-Tenant": "engineering" },
		oauthClient,
		oauth,
	})
}

function envReference(name: string): string {
	return ["$", "{env:", name, "}"].join("")
}

describe("McpHub oauthClient reconciliation", () => {
	it("restarts and changes the connection fingerprint for every static client policy change", () => {
		const baseline = parseConfig({
			clientId: "client-a",
			clientSecret: "secret-a",
			allowedScopes: ["read"],
			loopbackHostname: "127.0.0.1",
		})
		const variants = [
			parseConfig({
				clientId: "client-b",
				clientSecret: "secret-a",
				allowedScopes: ["read"],
				loopbackHostname: "127.0.0.1",
			}),
			parseConfig({
				clientId: "client-a",
				clientSecret: "secret-b",
				allowedScopes: ["read"],
				loopbackHostname: "127.0.0.1",
			}),
			parseConfig({
				clientId: "client-a",
				clientSecret: "secret-a",
				allowedScopes: ["read", "write"],
				loopbackHostname: "127.0.0.1",
			}),
			parseConfig({
				clientId: "client-a",
				clientSecret: "secret-a",
				allowedScopes: ["read"],
				loopbackHostname: "localhost",
			}),
		]
		const baselineFingerprint = computeMcpConnectionFingerprint({ test: baseline })

		for (const variant of variants) {
			expect(configsRequireMcpRestart(baseline, variant)).toBe(true)
			expect(computeMcpConnectionFingerprint({ test: variant })).not.toBe(baselineFingerprint)
		}
	})

	it("still ignores OAuth handshake churn when token availability is unchanged", () => {
		const oauthClient = { clientId: "client-a", allowedScopes: ["read"] }
		const before = parseConfig(oauthClient, {
			tokens: { access_token: "token-a" },
			codeVerifier: "verifier-a",
		})
		const after = parseConfig(oauthClient, {
			tokens: { access_token: "token-b" },
			codeVerifier: "verifier-b",
			lastError: "transient",
		})

		expect(configsRequireMcpRestart(before, after)).toBe(false)
		expect(computeMcpConnectionFingerprint({ test: before })).toBe(computeMcpConnectionFingerprint({ test: after }))
	})

	it("keeps OAuth and expanded credential values out of the stored display config", () => {
		const config = ServerConfigSchema.parse({
			type: "streamableHttp",
			url: "https://mcp.example.com/mcp",
			headers: {
				Authorization: "Bearer expanded-header-secret",
				"X-Tenant": "engineering",
			},
			oauthClient: {
				clientId: "static-client",
				clientSecret: "fixed-client-secret",
				allowedScopes: ["read"],
				loopbackHostname: "localhost",
			},
			oauth: {
				tokens: { access_token: "oauth-access-token" },
				codeVerifier: "oauth-code-verifier",
			},
		})

		const serialized = serializeMcpServerConfigForDisplay(config)
		const displayed = JSON.parse(serialized)

		expect(serialized).not.toContain("fixed-client-secret")
		expect(serialized).not.toContain("expanded-header-secret")
		expect(serialized).not.toContain("oauth-access-token")
		expect(serialized).not.toContain("oauth-code-verifier")
		expect(displayed.headers).toEqual({ Authorization: "<redacted>", "X-Tenant": "<redacted>" })
		expect(displayed.oauth).toBeUndefined()
		expect(displayed.oauthClient).toEqual({
			clientId: "static-client",
			allowedScopes: ["read"],
			loopbackHostname: "localhost",
		})
	})

	it("redacts expanded stdio environment values from the stored display config", () => {
		const config = ServerConfigSchema.parse({
			type: "stdio",
			command: "expanded-command-secret",
			args: ["--token", "expanded-argument-secret"],
			cwd: "/expanded/cwd-secret",
			env: { API_TOKEN: "expanded-env-secret" },
			metadata: { expanded: "expanded-metadata-secret" },
		})

		const serialized = serializeMcpServerConfigForDisplay(config, {
			type: "stdio",
			command: envReference("MCP_COMMAND"),
			args: ["--token", envReference("MCP_TOKEN")],
			cwd: envReference("MCP_CWD"),
			env: { API_TOKEN: envReference("MCP_TOKEN") },
			metadata: { expanded: envReference("MCP_METADATA") },
		})
		for (const secret of [
			"expanded-command-secret",
			"expanded-argument-secret",
			"expanded/cwd-secret",
			"expanded-env-secret",
			"expanded-metadata-secret",
		]) {
			expect(serialized).not.toContain(secret)
		}
		expect(JSON.parse(serialized)).toMatchObject({
			command: "<redacted>",
			args: ["<redacted>", "<redacted>"],
			cwd: "<redacted>",
			env: { API_TOKEN: "<redacted>" },
		})
		expect(JSON.parse(serialized).metadata).toBeUndefined()
	})

	it("never publishes expanded or URL-embedded remote secrets", () => {
		const embeddedSecretUrl = "https://expanded-user:expanded-password@mcp.example.com/mcp?token=expanded-query#expanded-hash"
		const config = ServerConfigSchema.parse({
			type: "streamableHttp",
			url: embeddedSecretUrl,
			metadata: { token: "expanded-metadata-secret" },
		})

		const fromExpandedPlaceholder = serializeMcpServerConfigForDisplay(config, {
			type: "streamableHttp",
			url: envReference("MCP_URL"),
			metadata: { token: envReference("MCP_METADATA") },
		})
		expect(JSON.parse(fromExpandedPlaceholder).url).toBe("<redacted>")
		expect(fromExpandedPlaceholder).not.toContain("expanded-")
		expect(JSON.parse(fromExpandedPlaceholder).metadata).toBeUndefined()

		const sanitizedLiteral = JSON.parse(
			serializeMcpServerConfigForDisplay(config, {
				type: "streamableHttp",
				url: embeddedSecretUrl,
			}),
		)
		expect(sanitizedLiteral.url).toBe("https://mcp.example.com/mcp")
		expect(JSON.stringify(sanitizedLiteral)).not.toContain("expanded-")

		const noProvenance = JSON.parse(
			serializeMcpServerConfigForDisplay(
				ServerConfigSchema.parse({
					type: "streamableHttp",
					url: "https://expanded-host-secret.example.com/expanded-path-secret",
				}),
			),
		)
		expect(noProvenance.url).toBe("<redacted>")
		expect(JSON.stringify(noProvenance)).not.toContain("expanded-")

		const exactSafeRaw = "https://mcp.example.com/mcp/"
		expect(
			JSON.parse(
				serializeMcpServerConfigForDisplay(ServerConfigSchema.parse({ type: "streamableHttp", url: exactSafeRaw }), {
					type: "streamableHttp",
					url: exactSafeRaw,
				}),
			).url,
		).toBe(exactSafeRaw)
	})
})
