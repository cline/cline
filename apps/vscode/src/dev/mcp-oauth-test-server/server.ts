#!/usr/bin/env node
/**
 * MCP OAuth Test Server
 * =====================
 *
 * A self-contained, zero-dependency (Node `http` only) test server for
 * exercising and debugging Cline's MCP OAuth flow locally, including failure
 * modes such as:
 *
 *   - State expiry — the OAuth `state` times out before the callback returns
 *     (e.g. a slow user, or a callback that arrives with a stale state).
 *   - Denial — the user clicks "Deny" on the consent screen, so the redirect
 *     comes back with `error=access_denied`.
 *
 * It plays BOTH roles that a real remote MCP server + its OAuth provider play:
 *
 *   1. OAuth 2.0 Authorization Server (RFC 8414 / RFC 7591 / RFC 7636 PKCE):
 *        GET  /.well-known/oauth-protected-resource[/<path>]
 *        GET  /.well-known/oauth-authorization-server[/<path>]
 *        POST /register        (Dynamic Client Registration)
 *        GET  /authorize       (consent screen — Approve / Deny)
 *        POST /token           (authorization_code + refresh_token grants)
 *
 *   2. MCP StreamableHTTP resource server:
 *        POST /mcp             (returns 401 + WWW-Authenticate until authed,
 *                               then initialize + a `frozzle` tool)
 *
 * The `frozzle` tool exists so an eval can prove the OAuth'd MCP round-trip
 * actually happened: its output is not derivable without calling the tool, so
 * a correct "frozzle <text>" answer can't be hallucinated. See frozzle().
 *
 * The endpoint shapes match what `@modelcontextprotocol/sdk` v1.25.x discovers
 * (see node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js).
 *
 * Fault-injection knobs (CLI flags / env) let us reproduce specific bugs:
 *
 *   --port <n>            Port to listen on (default 7777, env MCP_OAUTH_TEST_PORT)
 *   --auto-approve        Skip the consent screen; always approve (default: off,
 *                         shows an interactive Approve/Deny page)
 *   --auto-deny           Skip the consent screen; always deny (redirect comes
 *                         back with error=access_denied)
 *   --code-ttl <ms>       How long an issued authorization code stays valid
 *                         before /token rejects it (default 600000 = 10 min).
 *                         Set small (e.g. 1000) to exercise expiry races.
 *   --slow-authorize <ms> Delay before /authorize responds, to simulate a user
 *                         who takes a long time on the consent screen (useful
 *                         for exercising Cline's OAuth state-expiry window).
 *   --verbose             Log every request.
 *
 * Run interactively:
 *   cd apps/vscode
 *   npx tsx src/dev/mcp-oauth-test-server/server.ts --verbose
 *
 * Then add an MCP server to Cline pointing at:
 *   http://127.0.0.1:7777/mcp   (type: streamableHttp)
 *
 * Click "Authenticate" in Cline; a browser opens the /authorize consent page.
 */

import crypto from "node:crypto"
import http from "node:http"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface TestServerOptions {
	port: number
	host: string
	autoApprove: boolean
	autoDeny: boolean
	codeTtlMs: number
	slowAuthorizeMs: number
	verbose: boolean
	/**
	 * Number of independent server instances to start. When > 1, each instance
	 * binds its own OS-assigned random port (the fixed `--port` can't be shared),
	 * so you can add several distinct MCP servers to Cline at once and exercise
	 * concurrent OAuth flows.
	 */
	instances: number
	/**
	 * Bind an OS-assigned random free port instead of the fixed `--port`.
	 * Implied when `--instances` > 1. Also enabled by passing `--port 0`.
	 */
	randomPort: boolean
}

function parseArgs(argv: string[]): TestServerOptions {
	const opts: TestServerOptions = {
		port: Number(process.env.MCP_OAUTH_TEST_PORT) || 7777,
		host: "127.0.0.1",
		autoApprove: false,
		autoDeny: false,
		codeTtlMs: 10 * 60 * 1000,
		slowAuthorizeMs: 0,
		verbose: false,
		instances: 1,
		randomPort: false,
	}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		switch (arg) {
			case "--port":
				opts.port = Number(argv[++i])
				break
			case "--auto-approve":
				opts.autoApprove = true
				break
			case "--auto-deny":
				opts.autoDeny = true
				break
			case "--code-ttl":
				opts.codeTtlMs = Number(argv[++i])
				break
			case "--slow-authorize":
				opts.slowAuthorizeMs = Number(argv[++i])
				break
			case "--instances":
				opts.instances = Number(argv[++i])
				break
			case "--random-port":
			case "--random-ports":
				opts.randomPort = true
				break
			case "--verbose":
			case "-v":
				opts.verbose = true
				break
			case "--help":
			case "-h":
				printUsageAndExit()
				break
			default:
				console.error(`Unknown argument: ${arg}`)
				printUsageAndExit(1)
		}
	}
	if (opts.autoApprove && opts.autoDeny) {
		console.error("Cannot set both --auto-approve and --auto-deny")
		process.exit(1)
	}
	if (!Number.isInteger(opts.instances) || opts.instances < 1) {
		console.error(`--instances must be a positive integer (got ${opts.instances})`)
		process.exit(1)
	}
	// `--port 0` is a conventional request for an OS-assigned random port.
	if (opts.port === 0) {
		opts.randomPort = true
	}
	// Multiple instances can't share one fixed port, so each gets a random one.
	if (opts.instances > 1) {
		opts.randomPort = true
	}
	return opts
}

function printUsageAndExit(code = 0): never {
	console.log(`MCP OAuth Test Server

Usage: npx tsx src/dev/mcp-oauth-test-server/server.ts [options]

Options:
  --port <n>            Port to listen on (default 7777; 0 = OS-assigned random)
  --random-port         Bind an OS-assigned random free port instead of --port
  --instances <n>       Start N independent servers, each on its own random
                        port (implies --random-port). Use to add several MCP
                        servers to Cline at once.
  --auto-approve        Always approve authorization (no consent screen)
  --auto-deny           Always deny authorization (simulate "Deny" click)
  --code-ttl <ms>       Authorization code lifetime (default 600000)
  --slow-authorize <ms> Delay /authorize response by <ms>
  --verbose, -v         Log every request
  --help, -h            Show this help

Examples:
  # Single server on the default fixed port
  npx tsx src/dev/mcp-oauth-test-server/server.ts --verbose

  # Three servers on random ports, to test adding multiple at once
  npx tsx src/dev/mcp-oauth-test-server/server.ts --instances 3 --verbose
`)
	process.exit(code)
}

// ---------------------------------------------------------------------------
// In-memory OAuth state
// ---------------------------------------------------------------------------

interface RegisteredClient {
	client_id: string
	client_secret?: string
	redirect_uris: string[]
	client_name?: string
	token_endpoint_auth_method?: string
}

interface PendingAuthCode {
	code: string
	clientId: string
	redirectUri: string
	codeChallenge?: string
	codeChallengeMethod?: string
	/** OAuth `state` the client sent on /authorize — echoed back on redirect. */
	state?: string
	issuedAt: number
	resource?: string
}

interface IssuedToken {
	accessToken: string
	refreshToken: string
	clientId: string
	issuedAt: number
}

class TestServer {
	private readonly opts: TestServerOptions
	private readonly clients = new Map<string, RegisteredClient>()
	private readonly authCodes = new Map<string, PendingAuthCode>()
	private readonly refreshTokens = new Map<string, IssuedToken>()
	private server: http.Server | null = null
	/**
	 * The port actually bound. Differs from `opts.port` when `randomPort` is
	 * set (the OS assigns it), and is the value every absolute URL we emit
	 * (discovery metadata, redirect targets, the /mcp resource id) must use —
	 * otherwise the SDK's redirect_uri / resource checks fail.
	 */
	private boundPort = 0

	constructor(opts: TestServerOptions) {
		this.opts = opts
		this.boundPort = opts.port
	}

	private get baseUrl(): string {
		return `http://${this.opts.host}:${this.boundPort}`
	}

	/** The port this server is actually listening on (resolved after start). */
	get port(): number {
		return this.boundPort
	}

	/** The MCP StreamableHTTP endpoint clients should connect to. */
	get mcpEndpoint(): string {
		return `${this.baseUrl}/mcp`
	}

	private log(...args: unknown[]): void {
		if (this.opts.verbose) {
			console.log("[mcp-oauth-test]", ...args)
		}
	}

	/**
	 * Start listening. Resolves once bound, so callers can read `.port`
	 * (important when binding an OS-assigned random port).
	 */
	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				this.handleRequest(req, res).catch((err) => {
					console.error("[mcp-oauth-test] Unhandled error:", err)
					if (!res.headersSent) {
						this.json(res, 500, { error: "server_error", error_description: String(err) })
					}
				})
			})
			this.server.once("error", reject)
			// `randomPort` → listen on 0 so the OS assigns a free port.
			const listenPort = this.opts.randomPort ? 0 : this.opts.port
			this.server.listen(listenPort, this.opts.host, () => {
				const address = this.server?.address()
				if (address && typeof address === "object") {
					this.boundPort = address.port
				}
				console.log(`MCP OAuth Test Server listening on ${this.baseUrl}`)
				console.log(`  MCP endpoint:   ${this.baseUrl}/mcp  (type: streamableHttp)`)
				console.log(`  Authorize page: ${this.baseUrl}/authorize`)
				const mode = this.opts.autoApprove ? "auto-approve" : this.opts.autoDeny ? "auto-deny" : "interactive consent"
				console.log(`  Mode: ${mode}, code TTL: ${this.opts.codeTtlMs}ms`)
				resolve()
			})
		})
	}

	stop(): void {
		this.server?.close()
		this.server = null
	}

	// ------------------------------------------------------------------ routing

	private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = new URL(req.url || "/", this.baseUrl)
		this.log(req.method, url.pathname + url.search)

		// Discovery: protected-resource metadata (RFC 9728). The SDK probes both
		// `/.well-known/oauth-protected-resource` and a path-suffixed variant.
		if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
			return this.handleProtectedResourceMetadata(res)
		}
		// Discovery: authorization-server metadata (RFC 8414).
		if (
			url.pathname.startsWith("/.well-known/oauth-authorization-server") ||
			url.pathname.startsWith("/.well-known/openid-configuration")
		) {
			return this.handleAuthServerMetadata(res)
		}

		switch (url.pathname) {
			case "/register":
				return this.handleRegister(req, res)
			case "/authorize":
				return this.handleAuthorize(url, res)
			case "/token":
				return this.handleToken(req, res)
			case "/mcp":
				return this.handleMcp(req, res)
			case "/":
				return this.text(res, 200, "MCP OAuth Test Server. See /mcp and /authorize.")
			default:
				return this.json(res, 404, { error: "not_found", path: url.pathname })
		}
	}

	// ------------------------------------------------------------- discovery

	private handleProtectedResourceMetadata(res: http.ServerResponse): void {
		this.json(res, 200, {
			resource: `${this.baseUrl}/mcp`,
			authorization_servers: [this.baseUrl],
			scopes_supported: ["mcp"],
			bearer_methods_supported: ["header"],
		})
	}

	private handleAuthServerMetadata(res: http.ServerResponse): void {
		this.json(res, 200, {
			issuer: this.baseUrl,
			authorization_endpoint: `${this.baseUrl}/authorize`,
			token_endpoint: `${this.baseUrl}/token`,
			registration_endpoint: `${this.baseUrl}/register`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
			scopes_supported: ["mcp"],
		})
	}

	// --------------------------------------------------- dynamic registration

	private async handleRegister(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== "POST") {
			return this.json(res, 405, { error: "method_not_allowed" })
		}
		const body = await this.readJsonBody(req)
		const rawRedirectUris = body?.redirect_uris
		const redirectUris: string[] = Array.isArray(rawRedirectUris)
			? rawRedirectUris.filter((u): u is string => typeof u === "string")
			: []
		if (redirectUris.length === 0) {
			return this.json(res, 400, { error: "invalid_redirect_uri", error_description: "redirect_uris required" })
		}
		const clientId = `client_${crypto.randomBytes(12).toString("hex")}`
		const client: RegisteredClient = {
			client_id: clientId,
			redirect_uris: redirectUris,
			client_name: asString(body?.client_name),
			token_endpoint_auth_method: asString(body?.token_endpoint_auth_method) ?? "none",
		}
		this.clients.set(clientId, client)
		this.log("Registered client", clientId, "redirect_uris:", redirectUris)
		this.json(res, 201, {
			client_id: clientId,
			redirect_uris: redirectUris,
			client_name: client.client_name,
			token_endpoint_auth_method: client.token_endpoint_auth_method,
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		})
	}

	// ----------------------------------------------------------- authorize

	private async handleAuthorize(url: URL, res: http.ServerResponse): Promise<void> {
		const clientId = url.searchParams.get("client_id") || ""
		const redirectUri = url.searchParams.get("redirect_uri") || ""
		const state = url.searchParams.get("state") || undefined
		const codeChallenge = url.searchParams.get("code_challenge") || undefined
		const codeChallengeMethod = url.searchParams.get("code_challenge_method") || undefined
		const resource = url.searchParams.get("resource") || undefined
		const decision = url.searchParams.get("decision") // set when posting back from consent page

		const client = this.clients.get(clientId)
		if (!client) {
			return this.text(res, 400, `Unknown client_id: ${clientId}`)
		}
		if (!client.redirect_uris.includes(redirectUri)) {
			// This is the real-world failure when the registered redirect_uri no
			// longer matches (e.g. loopback port changed). Surface it clearly.
			return this.text(
				res,
				400,
				`redirect_uri "${redirectUri}" is not registered for this client.\nRegistered: ${client.redirect_uris.join(", ")}`,
			)
		}

		if (this.opts.slowAuthorizeMs > 0) {
			this.log(`Delaying /authorize by ${this.opts.slowAuthorizeMs}ms`)
			await delay(this.opts.slowAuthorizeMs)
		}

		// Decide approve/deny.
		let approved: boolean
		if (this.opts.autoApprove) {
			approved = true
		} else if (this.opts.autoDeny) {
			approved = false
		} else if (decision === "approve") {
			approved = true
		} else if (decision === "deny") {
			approved = false
		} else {
			// Show the interactive consent screen.
			return this.html(res, 200, this.renderConsentPage(url))
		}

		if (!approved) {
			// RFC 6749 §4.1.2.1 — redirect back with error=access_denied.
			const redirect = new URL(redirectUri)
			redirect.searchParams.set("error", "access_denied")
			redirect.searchParams.set("error_description", "The user denied the authorization request.")
			if (state) {
				redirect.searchParams.set("state", state)
			}
			this.log("User DENIED authorization, redirecting to", redirect.toString())
			return this.redirect(res, redirect.toString())
		}

		// Approved: mint an authorization code bound to PKCE + redirect_uri.
		const code = crypto.randomBytes(24).toString("hex")
		this.authCodes.set(code, {
			code,
			clientId,
			redirectUri,
			codeChallenge,
			codeChallengeMethod,
			state,
			issuedAt: Date.now(),
			resource,
		})
		const redirect = new URL(redirectUri)
		redirect.searchParams.set("code", code)
		if (state) {
			redirect.searchParams.set("state", state)
		}
		this.log("User APPROVED, redirecting to", redirect.toString())
		this.redirect(res, redirect.toString())
	}

	// --------------------------------------------------------------- token

	private async handleToken(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (req.method !== "POST") {
			return this.json(res, 405, { error: "method_not_allowed" })
		}
		const form = await this.readFormBody(req)
		const grantType = form.get("grant_type")

		if (grantType === "authorization_code") {
			return this.handleAuthorizationCodeGrant(form, res)
		}
		if (grantType === "refresh_token") {
			return this.handleRefreshTokenGrant(form, res)
		}
		return this.json(res, 400, { error: "unsupported_grant_type", error_description: String(grantType) })
	}

	private handleAuthorizationCodeGrant(form: URLSearchParams, res: http.ServerResponse): void {
		const code = form.get("code") || ""
		const redirectUri = form.get("redirect_uri") || ""
		const codeVerifier = form.get("code_verifier") || ""

		const pending = this.authCodes.get(code)
		if (!pending) {
			this.json(res, 400, { error: "invalid_grant", error_description: "Unknown or already-used code" })
			return
		}
		// Codes are single-use.
		this.authCodes.delete(code)

		if (Date.now() - pending.issuedAt > this.opts.codeTtlMs) {
			this.log("Authorization code expired")
			this.json(res, 400, { error: "invalid_grant", error_description: "Authorization code expired" })
			return
		}
		if (pending.redirectUri !== redirectUri) {
			this.json(res, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch" })
			return
		}
		// Verify PKCE (S256).
		if (pending.codeChallenge) {
			const expected = base64UrlSha256(codeVerifier)
			if (expected !== pending.codeChallenge) {
				this.json(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" })
				return
			}
		}

		const token = this.issueToken(pending.clientId)
		this.log("Issued tokens for client", pending.clientId)
		this.json(res, 200, {
			access_token: token.accessToken,
			token_type: "Bearer",
			expires_in: 3600,
			refresh_token: token.refreshToken,
			scope: "mcp",
		})
	}

	private handleRefreshTokenGrant(form: URLSearchParams, res: http.ServerResponse): void {
		const refreshToken = form.get("refresh_token") || ""
		const existing = this.refreshTokens.get(refreshToken)
		if (!existing) {
			this.json(res, 400, { error: "invalid_grant", error_description: "Unknown refresh_token" })
			return
		}
		this.refreshTokens.delete(refreshToken)
		const token = this.issueToken(existing.clientId)
		this.log("Refreshed tokens for client", existing.clientId)
		this.json(res, 200, {
			access_token: token.accessToken,
			token_type: "Bearer",
			expires_in: 3600,
			refresh_token: token.refreshToken,
			scope: "mcp",
		})
	}

	private issueToken(clientId: string): IssuedToken {
		const token: IssuedToken = {
			accessToken: `at_${crypto.randomBytes(24).toString("hex")}`,
			refreshToken: `rt_${crypto.randomBytes(24).toString("hex")}`,
			clientId,
			issuedAt: Date.now(),
		}
		this.refreshTokens.set(token.refreshToken, token)
		return token
	}

	// ----------------------------------------------------------------- MCP

	private async handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const auth = req.headers.authorization
		const hasBearer = typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")

		if (!hasBearer) {
			// This is what triggers Cline's OAuth flow: 401 + WWW-Authenticate
			// with a resource_metadata pointer (RFC 9728).
			const metadataUrl = `${this.baseUrl}/.well-known/oauth-protected-resource`
			res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}"`)
			return this.json(res, 401, { error: "unauthorized", error_description: "Authentication required" })
		}

		// Authenticated: respond to a minimal MCP `initialize` so the connection
		// succeeds and Cline shows the server as connected.
		const body = await this.readJsonBody(req)
		const id = body?.id ?? null
		if (body?.method === "initialize") {
			return this.json(res, 200, {
				jsonrpc: "2.0",
				id,
				result: {
					protocolVersion: "2024-11-05",
					capabilities: { tools: {} },
					serverInfo: { name: "mcp-oauth-test-server", version: "0.1.0" },
				},
			})
		}

		// Advertise the `frozzle` tool. Its description deliberately does NOT
		// reveal what frozzling does, so a model cannot fabricate the result —
		// the only way to produce a correct answer is to actually call the tool
		// over MCP. This makes it a reliable end-to-end signal that the OAuth'd
		// MCP connection works (vs. the model hallucinating an answer).
		if (body?.method === "tools/list") {
			return this.json(res, 200, {
				jsonrpc: "2.0",
				id,
				result: {
					tools: [
						{
							name: "frozzle",
							description:
								"Frozzle the given text and return its frozzled form. " +
								"The frozzling transform is defined solely by this server; " +
								"there is no way to compute the result without calling this tool.",
							inputSchema: {
								type: "object",
								properties: {
									text: { type: "string", description: "The text to frozzle." },
								},
								required: ["text"],
							},
						},
					],
				},
			})
		}

		if (body?.method === "tools/call") {
			const params = (body?.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
			if (params.name === "frozzle") {
				const text = typeof params.arguments?.text === "string" ? params.arguments.text : ""
				const frozzled = frozzle(text)
				this.log(`frozzle(${JSON.stringify(text)}) -> ${JSON.stringify(frozzled)}`)
				return this.json(res, 200, {
					jsonrpc: "2.0",
					id,
					result: {
						content: [{ type: "text", text: frozzled }],
					},
				})
			}
			// Unknown tool.
			return this.json(res, 200, {
				jsonrpc: "2.0",
				id,
				result: {
					isError: true,
					content: [{ type: "text", text: `Unknown tool: ${String(params.name)}` }],
				},
			})
		}

		// Any other method: empty-ish OK so the SDK doesn't error out.
		return this.json(res, 200, { jsonrpc: "2.0", id, result: {} })
	}

	// ----------------------------------------------------- consent HTML page

	private renderConsentPage(url: URL): string {
		const approveUrl = new URL(url.toString())
		approveUrl.searchParams.set("decision", "approve")
		const denyUrl = new URL(url.toString())
		denyUrl.searchParams.set("decision", "deny")
		const clientId = url.searchParams.get("client_id") || "(unknown)"
		const redirectUri = url.searchParams.get("redirect_uri") || "(unknown)"
		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MCP OAuth Test — Authorize</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #1e1e1e; color: #ddd; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #252526; border: 1px solid #3c3c3c; border-radius: 8px; padding: 32px; max-width: 480px; }
    h1 { font-size: 1.3rem; margin-top: 0; }
    code { background: #333; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; word-break: break-all; }
    .row { margin: 12px 0; }
    .buttons { margin-top: 24px; display: flex; gap: 12px; }
    a.btn { text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; }
    a.approve { background: #2ea043; color: #fff; }
    a.deny { background: #6e2222; color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize Cline?</h1>
    <p>The MCP OAuth Test Server is asking you to authorize this client.</p>
    <div class="row">Client: <code>${escapeHtml(clientId)}</code></div>
    <div class="row">Redirect: <code>${escapeHtml(redirectUri)}</code></div>
    <div class="buttons">
      <a class="btn approve" href="${escapeHtml(approveUrl.toString())}">Approve</a>
      <a class="btn deny" href="${escapeHtml(denyUrl.toString())}">Deny</a>
    </div>
  </div>
</body>
</html>`
	}

	// --------------------------------------------------------------- helpers

	private async readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
		const raw = await readBody(req)
		if (!raw) {
			return undefined
		}
		try {
			return JSON.parse(raw) as Record<string, unknown>
		} catch {
			return undefined
		}
	}

	private async readFormBody(req: http.IncomingMessage): Promise<URLSearchParams> {
		const raw = await readBody(req)
		return new URLSearchParams(raw)
	}

	private json(res: http.ServerResponse, status: number, body: unknown): void {
		const payload = JSON.stringify(body)
		res.writeHead(status, { "Content-Type": "application/json" })
		res.end(payload)
	}

	private text(res: http.ServerResponse, status: number, body: string): void {
		res.writeHead(status, { "Content-Type": "text/plain" })
		res.end(body)
	}

	private html(res: http.ServerResponse, status: number, body: string): void {
		res.writeHead(status, { "Content-Type": "text/html" })
		res.end(body)
	}

	private redirect(res: http.ServerResponse, location: string): void {
		res.writeHead(302, { Location: location })
		res.end()
	}
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on("data", (chunk) => chunks.push(chunk as Buffer))
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
		req.on("error", reject)
	})
}

function base64UrlSha256(input: string): string {
	return crypto.createHash("sha256").update(input).digest("base64url")
}

/**
 * The "frozzle" transform exposed by the test server's MCP `frozzle` tool.
 *
 * The point of frozzling is that it is arbitrary and non-obvious: a model
 * cannot guess or compute the result without actually calling the tool over
 * the (OAuth-authenticated) MCP connection. So when an eval asks the agent to
 * "frozzle <text>" and checks the answer, a correct result is proof the MCP
 * round-trip really happened — not a hallucination.
 *
 * It is nonetheless deterministic, easy to verify at a glance, and invertible:
 * reverse the string and swap the case of each letter (upper<->lower), then
 * wrap in « » markers. e.g. frozzle("Hello") === "«OLLEh»".
 */
export function frozzle(text: string): string {
	const swapped = [...text]
		.reverse()
		.map((ch) => {
			const lower = ch.toLowerCase()
			const upper = ch.toUpperCase()
			if (ch === lower && ch !== upper) {
				return upper // lowercase -> uppercase
			}
			if (ch === upper && ch !== lower) {
				return lower // uppercase -> lowercase
			}
			return ch // non-letters unchanged
		})
		.join("")
	return `«${swapped}»`
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export { buildSettingsFragment, parseArgs, TestServer, type TestServerOptions }

/**
 * Build a paste-ready `mcpServers` fragment for cline_mcp_settings.json from a
 * set of running test-server endpoints.
 *
 * Uses the nested `transport` shape the CLI/SDK writes (and the extension also
 * accepts), so the output can be dropped straight into the settings file. When
 * there are multiple endpoints the names are suffixed (`oauth-test-1`, …) since
 * OAuth state is keyed by server name — distinct names get independent tokens.
 */
function buildSettingsFragment(endpoints: string[]): string {
	const mcpServers: Record<string, unknown> = {}
	endpoints.forEach((endpoint, index) => {
		const name = endpoints.length === 1 ? "oauth-test" : `oauth-test-${index + 1}`
		mcpServers[name] = {
			transport: {
				type: "streamableHttp",
				url: endpoint,
			},
		}
	})
	return JSON.stringify({ mcpServers }, null, 2)
}

// Only auto-start when run directly (so this module can be imported by the
// debug harness later without spawning a server).
const isMain = process.argv[1] && /mcp-oauth-test-server[/\\]server\.(ts|js)$/.test(process.argv[1])
if (isMain) {
	const opts = parseArgs(process.argv.slice(2))
	const servers: TestServer[] = []

	void (async () => {
		for (let i = 0; i < opts.instances; i++) {
			const server = new TestServer(opts)
			await server.start()
			servers.push(server)
		}
		if (opts.instances > 1) {
			console.log(`\nStarted ${opts.instances} MCP OAuth test servers.`)
		}
		// Emit a paste-ready settings fragment so you don't have to hand-write
		// the JSON (handy with random ports / multiple instances).
		console.log("\nPaste into ~/.cline/data/settings/cline_mcp_settings.json (merge under mcpServers):\n")
		console.log(buildSettingsFragment(servers.map((server) => server.mcpEndpoint)))
	})()

	process.on("SIGINT", () => {
		console.log("\nShutting down...")
		for (const server of servers) {
			server.stop()
		}
		process.exit(0)
	})
}
