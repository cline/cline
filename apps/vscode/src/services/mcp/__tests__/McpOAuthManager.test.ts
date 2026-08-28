import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { McpServerOAuthClientConfig, McpServerOAuthState, McpServerTransportConfig } from "@cline/core"
import type { McpOAuthManagerDependencies } from "../McpOAuthManager"

mock.module("@/shared/net", () => ({ fetch: globalThis.fetch }))
mock.module("@/shared/services/Logger", () => ({
	Logger: { log: () => {}, warn: () => {}, error: () => {} },
}))
mock.module("@/utils/env", () => ({ openExternal: async () => {} }))

type CoreApi = typeof import("@cline/core")

function coreSourceModuleUrl(fileName: string): string {
	return pathToFileURL(resolve(import.meta.dir, "../../../../../..", "sdk/packages/core/src/extensions/mcp", fileName)).href
}

// The VS Code bun preload intentionally substitutes @cline/core for broad
// adapter tests. Load the shared source modules under their file URLs and inject
// the exact dependencies this integration suite exercises instead of changing
// process-global preload behavior based on a test filename.
const [oauthModule, configLoaderModule, transportBindingModule, clientPolicyBindingModule, scopePolicyModule] =
	(await Promise.all([
		import(coreSourceModuleUrl("oauth.ts")),
		import(coreSourceModuleUrl("config-loader.ts")),
		import(coreSourceModuleUrl("oauth-transport-binding.ts")),
		import(coreSourceModuleUrl("oauth-client-policy-binding.ts")),
		import(coreSourceModuleUrl("oauth-scope-policy.ts")),
	])) as [
		Pick<CoreApi, "authorizeMcpServerOAuth" | "createMcpOAuthClientInformation" | "createMcpOAuthProviderContext">,
		Pick<CoreApi, "McpOAuthTransportChangedError" | "resolveMcpServerRegistration" | "updateMcpServerOAuthStateAsync">,
		Pick<CoreApi, "createMcpOAuthTransportBinding">,
		Pick<CoreApi, "createMcpOAuthClientPolicyBinding">,
		Pick<CoreApi, "McpOAuthScopePolicyError">,
	]

const createMcpOAuthTransportBinding = transportBindingModule.createMcpOAuthTransportBinding
const createMcpOAuthClientPolicyBinding = clientPolicyBindingModule.createMcpOAuthClientPolicyBinding
const McpOAuthScopePolicyError = scopePolicyModule.McpOAuthScopePolicyError
const McpOAuthTransportChangedError = configLoaderModule.McpOAuthTransportChangedError
const dependencies: McpOAuthManagerDependencies = {
	authorizeMcpServerOAuth: oauthModule.authorizeMcpServerOAuth,
	createMcpOAuthClientInformation: oauthModule.createMcpOAuthClientInformation,
	createMcpOAuthClientPolicyBinding: clientPolicyBindingModule.createMcpOAuthClientPolicyBinding,
	createMcpOAuthProviderContext: oauthModule.createMcpOAuthProviderContext,
	createMcpOAuthTransportBinding,
	resolveMcpServerRegistration: configLoaderModule.resolveMcpServerRegistration,
	updateMcpServerOAuthStateAsync: configLoaderModule.updateMcpServerOAuthStateAsync,
}

const { McpOAuthManager, MCP_OAUTH_CALLBACK_PORTS } = await import("../McpOAuthManager")

type RemoteTransport = Extract<McpServerTransportConfig, { url: string }>

function envReference(name: string): string {
	return ["$", "{env:", name, "}"].join("")
}

const defaultTransport: RemoteTransport = {
	type: "streamableHttp",
	url: "https://mcp.example.com/mcp",
	headers: { Authorization: "Bearer configured", "X-Tenant": "engineering" },
}

describe("McpOAuthManager transport-bound providers", () => {
	let tempDir: string
	let settingsPath: string
	let manager: InstanceType<typeof McpOAuthManager>

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "cline-vscode-mcp-oauth-"))
		settingsPath = join(tempDir, "cline_mcp_settings.json")
		manager = new McpOAuthManager(async () => settingsPath, dependencies)
	})

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true })
	})

	async function writeServer(input: {
		transport?: RemoteTransport
		oauthClient?: McpServerOAuthClientConfig
		oauth?: McpServerOAuthState
	}): Promise<void> {
		await writeFile(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					test: {
						transport: input.transport ?? defaultTransport,
						...(input.oauthClient ? { oauthClient: input.oauthClient } : {}),
						...(input.oauth ? { oauth: input.oauth } : {}),
					},
				},
			}),
			"utf8",
		)
	}

	async function readOAuth(): Promise<McpServerOAuthState | undefined> {
		const settings = JSON.parse(await readFile(settingsPath, "utf8"))
		return settings.mcpServers.test.oauth
	}

	it("reuses every artifact only for the bound transport and configured OAuth policy", async () => {
		const oauthClient: McpServerOAuthClientConfig = {
			clientId: "static-client",
			clientSecret: "static-secret",
			allowedScopes: ["search:read"],
			loopbackHostname: "localhost",
		}
		await writeServer({
			oauthClient,
			oauth: {
				transportBinding: createMcpOAuthTransportBinding(defaultTransport),
				clientPolicyBinding: createMcpOAuthClientPolicyBinding(oauthClient),
				clientInformation: { client_id: "static-client", client_secret: "static-secret" },
				tokens: { access_token: "bound-token", token_type: "Bearer", scope: "search:read" },
				scopePolicy: ["search:read"],
				loopbackHostname: "localhost",
				redirectUrl: "http://localhost:1456/mcp/oauth/callback",
				codeVerifier: "bound-verifier",
				discoveryState: { authorizationServerUrl: "https://auth.example.com" },
				lastAuthenticatedAt: 1,
			},
		})

		const provider = await manager.getOrCreateProvider("test", defaultTransport, oauthClient)

		expect(await provider.tokens()).toMatchObject({ access_token: "bound-token", scope: "search:read" })
		expect(await provider.clientInformation()).toEqual({
			client_id: "static-client",
			client_secret: "static-secret",
		})
		expect(provider.redirectUrl).toBe("http://localhost:1456/mcp/oauth/callback")
		expect(provider.clientMetadata.scope).toBe("search:read")
		expect(await provider.codeVerifier()).toBe("bound-verifier")
		expect(await provider.discoveryState?.()).toEqual({ authorizationServerUrl: "https://auth.example.com" })
	})

	it("fails closed for legacy unbound credentials and artifacts", async () => {
		await writeServer({
			oauth: {
				clientInformation: { client_id: "legacy-client" },
				tokens: { access_token: "legacy-token", token_type: "Bearer" },
				redirectUrl: "http://localhost:9999/legacy",
				codeVerifier: "legacy-verifier",
				discoveryState: { authorizationServerUrl: "https://legacy.example.com" },
			},
		})

		const provider = await manager.getOrCreateProvider("test", defaultTransport, undefined)

		expect(await provider.tokens()).toBeUndefined()
		expect(await provider.clientInformation()).toBeUndefined()
		expect(provider.redirectUrl).toBe("http://127.0.0.1:1456/mcp/oauth/callback")
		expect(() => provider.codeVerifier()).toThrow("Missing OAuth code verifier")
		expect(await provider.discoveryState?.()).toBeUndefined()
	})

	it("enforces client, scope, loopback, and returned-token scope policy on fresh reads", async () => {
		const oauthClient: McpServerOAuthClientConfig = {
			clientId: "static-client",
			allowedScopes: ["read"],
			loopbackHostname: "localhost",
		}
		const binding = createMcpOAuthTransportBinding(defaultTransport)
		const validState: McpServerOAuthState = {
			transportBinding: binding,
			clientPolicyBinding: createMcpOAuthClientPolicyBinding(oauthClient),
			clientInformation: { client_id: "static-client" },
			tokens: { access_token: "token", token_type: "Bearer", scope: "read" },
			scopePolicy: ["read"],
			loopbackHostname: "localhost",
		}
		await writeServer({ oauthClient, oauth: validState })
		const provider = await manager.getOrCreateProvider("test", defaultTransport, oauthClient)
		expect((await provider.tokens())?.access_token).toBe("token")

		await writeServer({
			oauthClient,
			oauth: { ...validState, clientInformation: { client_id: "other-client" } },
		})
		expect(await provider.tokens()).toBeUndefined()

		await writeServer({ oauthClient, oauth: { ...validState, scopePolicy: ["write"] } })
		expect(await provider.tokens()).toBeUndefined()

		await writeServer({ oauthClient, oauth: { ...validState, loopbackHostname: "127.0.0.1" } })
		expect(await provider.tokens()).toBeUndefined()

		await writeServer({
			oauthClient,
			oauth: {
				...validState,
				tokens: { access_token: "over-scoped", token_type: "Bearer", scope: "read write" },
			},
		})
		expect(() => provider.tokens()).toThrow(McpOAuthScopePolicyError)
	})

	it("canonicalizes header ordering, replaces stale transport/client providers, and keeps one cache entry", async () => {
		const oauthClientA: McpServerOAuthClientConfig = { clientId: "client-a", allowedScopes: ["read"] }
		await writeServer({ oauthClient: oauthClientA })
		const first = await manager.getOrCreateProvider("test", defaultTransport, oauthClientA)
		const reorderedTransport: RemoteTransport = {
			...defaultTransport,
			headers: { "x-tenant": "engineering", authorization: "Bearer configured" },
		}
		const reordered = await manager.getOrCreateProvider("test", reorderedTransport, oauthClientA)
		expect(reordered).toBe(first)

		const changedHeader: RemoteTransport = {
			...defaultTransport,
			headers: { Authorization: "Bearer replacement", "X-Tenant": "engineering" },
		}
		await writeServer({ transport: changedHeader, oauthClient: oauthClientA })
		const second = await manager.getOrCreateProvider("test", changedHeader, oauthClientA)
		expect(second).not.toBe(first)

		await writeServer({
			transport: changedHeader,
			oauthClient: { clientId: "client-b", clientSecret: "replacement-secret", allowedScopes: ["read"] },
		})
		const replacementClient = {
			clientId: "client-b",
			clientSecret: "replacement-secret",
			allowedScopes: ["read"],
		}
		const third = await manager.getOrCreateProvider("test", changedHeader, replacementClient)
		expect(third).not.toBe(second)

		await writeServer({ transport: changedHeader })
		const removed = await manager.getOrCreateProvider("test", changedHeader, undefined)
		expect(removed).not.toBe(third)

		await writeServer({
			transport: changedHeader,
			oauthClient: { clientId: "client-b", clientSecret: "replacement-secret", allowedScopes: ["read"] },
		})
		const addedAgain = await manager.getOrCreateProvider("test", changedHeader, replacementClient)
		expect(addedAgain).not.toBe(removed)
		expect((manager as unknown as { providers: Map<string, unknown> }).providers.size).toBe(1)
	})

	it("refuses OAuth when environment expansion changes the effective URL or headers", async () => {
		const configuredTransport: RemoteTransport = {
			type: "streamableHttp",
			url: "https://mcp.example.com/mcp",
			headers: { Authorization: ["Bearer $", "{env:MCP_TOKEN}"].join("") },
		}
		const effectiveTransport: RemoteTransport = {
			...configuredTransport,
			headers: { Authorization: "Bearer expanded-secret" },
		}
		await writeServer({ transport: configuredTransport })

		// McpHub currently receives the already-expanded config from its settings
		// reader, so both supplied identities can be effective. The manager must
		// still compare that identity with Core's raw persisted registration.
		await expect(manager.getOrCreateProvider("test", effectiveTransport, undefined, effectiveTransport)).rejects.toThrow(
			"environment expansion changes its remote URL, headers, or OAuth client policy",
		)
		expect((manager as unknown as { providers: Map<string, unknown> }).providers.size).toBe(0)
	})

	it("classifies a full-URL environment placeholder as an OAuth binding mismatch", async () => {
		const effectiveTransport: RemoteTransport = {
			type: "streamableHttp",
			url: "https://expanded.example.com/mcp",
		}
		await writeFile(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					test: {
						transport: {
							type: "streamableHttp",
							url: envReference("MCP_URL"),
						},
					},
				},
			}),
			"utf8",
		)

		await expect(manager.getOrCreateProvider("test", effectiveTransport, undefined, effectiveTransport)).rejects.toThrow(
			"environment expansion changes its remote URL, headers, or OAuth client policy",
		)
		expect((manager as unknown as { providers: Map<string, unknown> }).providers.size).toBe(0)
	})

	it("refuses client ID and secret expansion before exposing passive OAuth artifacts", async () => {
		const cases: Array<{
			rawClient: McpServerOAuthClientConfig
			effectiveClient: McpServerOAuthClientConfig
		}> = [
			{
				rawClient: { clientId: envReference("MCP_OAUTH_CLIENT_ID") },
				effectiveClient: { clientId: "expanded-client" },
			},
			{
				rawClient: {
					clientId: "static-client",
					clientSecret: envReference("MCP_OAUTH_CLIENT_SECRET"),
				},
				effectiveClient: {
					clientId: "static-client",
					clientSecret: "expanded-client-secret",
				},
			},
		]

		for (const { rawClient, effectiveClient } of cases) {
			await writeServer({
				oauthClient: rawClient,
				oauth: {
					transportBinding: createMcpOAuthTransportBinding(defaultTransport),
					clientPolicyBinding: createMcpOAuthClientPolicyBinding(rawClient),
					clientInformation: {
						client_id: rawClient.clientId,
						...(rawClient.clientSecret ? { client_secret: rawClient.clientSecret } : {}),
					},
					tokens: { access_token: "raw-policy-token", token_type: "Bearer" },
					loopbackHostname: "127.0.0.1",
				},
			})

			await expect(manager.getOrCreateProvider("test", defaultTransport, effectiveClient)).rejects.toThrow(
				"environment expansion changes its remote URL, headers, or OAuth client policy",
			)
		}
		expect((manager as unknown as { providers: Map<string, unknown> }).providers.size).toBe(0)
	})

	it("rejects an old provider write after a concurrent transport edit", async () => {
		const binding = createMcpOAuthTransportBinding(defaultTransport)
		await writeServer({
			oauth: {
				transportBinding: binding,
				clientPolicyBinding: createMcpOAuthClientPolicyBinding(undefined),
				clientInformation: { client_id: "dynamic-client" },
				tokens: { access_token: "old-token", token_type: "Bearer" },
				loopbackHostname: "127.0.0.1",
			},
		})
		const provider = await manager.getOrCreateProvider("test", defaultTransport, undefined)
		const replacementTransport: RemoteTransport = {
			...defaultTransport,
			url: "https://replacement.example.com/mcp",
		}
		await writeServer({
			transport: replacementTransport,
			oauth: {
				transportBinding: binding,
				clientPolicyBinding: createMcpOAuthClientPolicyBinding(undefined),
				clientInformation: { client_id: "dynamic-client" },
				tokens: { access_token: "old-token", token_type: "Bearer" },
				loopbackHostname: "127.0.0.1",
			},
		})

		expect(await provider.tokens()).toBeUndefined()
		await expect(provider.saveTokens({ access_token: "must-not-persist", token_type: "Bearer" })).rejects.toBeInstanceOf(
			McpOAuthTransportChangedError,
		)
		expect((await readOAuth())?.tokens).toMatchObject({ access_token: "old-token" })
	})

	it("does not clear replacement credentials when deletion races a transport edit", async () => {
		await writeServer({
			oauth: {
				transportBinding: createMcpOAuthTransportBinding(defaultTransport),
				clientPolicyBinding: createMcpOAuthClientPolicyBinding(undefined),
				clientInformation: { client_id: "old-client" },
				tokens: { access_token: "old-token", token_type: "Bearer" },
				loopbackHostname: "127.0.0.1",
			},
		})
		await manager.getOrCreateProvider("test", defaultTransport, undefined)

		const replacementTransport: RemoteTransport = {
			type: "sse",
			url: "https://replacement.example.com/sse",
			headers: { "X-Tenant": "replacement" },
		}
		await writeServer({
			transport: replacementTransport,
			oauth: {
				transportBinding: createMcpOAuthTransportBinding(replacementTransport),
				clientPolicyBinding: createMcpOAuthClientPolicyBinding(undefined),
				clientInformation: { client_id: "replacement-client" },
				tokens: { access_token: "replacement-token", token_type: "Bearer" },
				loopbackHostname: "127.0.0.1",
			},
		})

		await manager.clearServerAuth("test", defaultTransport, undefined)
		expect((await readOAuth())?.tokens).toMatchObject({ access_token: "replacement-token" })
	})

	it("does not clear replacement credentials when the static client changes on the same transport", async () => {
		const oldClient: McpServerOAuthClientConfig = { clientId: "old-client", allowedScopes: ["read"] }
		const binding = createMcpOAuthTransportBinding(defaultTransport)
		await writeServer({
			oauthClient: oldClient,
			oauth: {
				transportBinding: binding,
				clientPolicyBinding: createMcpOAuthClientPolicyBinding(oldClient),
				clientInformation: { client_id: "old-client" },
				tokens: { access_token: "old-token", token_type: "Bearer", scope: "read" },
				scopePolicy: ["read"],
				loopbackHostname: "127.0.0.1",
			},
		})
		await manager.getOrCreateProvider("test", defaultTransport, oldClient)

		const replacementClient: McpServerOAuthClientConfig = {
			clientId: "replacement-client",
			allowedScopes: ["read"],
		}
		await writeServer({
			oauthClient: replacementClient,
			oauth: {
				transportBinding: binding,
				clientPolicyBinding: createMcpOAuthClientPolicyBinding(replacementClient),
				clientInformation: { client_id: "replacement-client" },
				tokens: { access_token: "replacement-token", token_type: "Bearer", scope: "read" },
				scopePolicy: ["read"],
				loopbackHostname: "127.0.0.1",
			},
		})

		await manager.clearServerAuth("test", defaultTransport, oldClient)
		expect((await readOAuth())?.tokens).toMatchObject({ access_token: "replacement-token" })
	})

	it("advertises only the three callback ports registered by every Cline setup surface", async () => {
		let callbackPorts: number[] | undefined
		const portManager = new McpOAuthManager(async () => settingsPath, {
			...dependencies,
			authorizeMcpServerOAuth: async (options) => {
				callbackPorts = options.callbackPorts
				return { serverName: options.serverName, authorized: true, message: "ok" }
			},
		})

		await portManager.startOAuthFlow("test")
		expect(MCP_OAUTH_CALLBACK_PORTS).toEqual([1456, 1457, 1458])
		expect(callbackPorts).toEqual([1456, 1457, 1458])
	})
})
