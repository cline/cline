import express, { Request, Response } from "express"
import http from "http"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Issuer, generators, TokenSet, Client } from "openid-client"
import {
	DEFAULT_IDCS_CLIENT_ID,
	DEFAULT_IDCS_URL,
	DEFAULT_IDSC_SCOPES,
	DEFAULT_IDCS_PORT_CANDIDATES,
	DEFAULT_USE_PKCE,
} from "./constants"
import { openInBrowser } from "../../web/openInBrowser"
import { StringRequest } from "@shared/proto/cline/common"
import { parseJwtPayload } from "./utils"
export interface OcaStoredToken extends TokenSet {
	created_at: number
	expires_at: number
	sub?: string
}
export class OcaTokenManager {
	private static cachedToken: OcaStoredToken | null = null
	private static client: Client | null = null
	private static codeVerifier: string | undefined
	private static _config: null | {
		client_id: string
		idcs_url: string
		client_secret?: string
		scopes: string
		port_candidates: number[]
		use_pkce: boolean
	} = null
	private static readonly TOKEN_CACHE_PATH = path.join(os.homedir(), ".oca", "token_cache.json")
	private static readonly RENEW_TOKEN_BUFFER_SEC = 180 // 3 minutes
	private static readonly OCA_CONFIG_PATH = path.join(os.homedir(), ".oca", "config.json")
	private static async getConfig() {
		if (this._config) {
			return this._config
		}
		let cfg: any = {}
		try {
			const raw = await fs.readFile(this.OCA_CONFIG_PATH, "utf-8")
			cfg = JSON.parse(raw)
		} catch {
			/* ignore - use defaults */
		}
		this._config = {
			client_id: cfg.client_id ?? DEFAULT_IDCS_CLIENT_ID,
			idcs_url: cfg.idcs_url ?? DEFAULT_IDCS_URL,
			client_secret: cfg.client_secret, // allow undefined
			scopes: cfg.scopes ?? DEFAULT_IDSC_SCOPES,
			port_candidates: cfg.port_candidates ?? DEFAULT_IDCS_PORT_CANDIDATES,
			use_pkce: typeof cfg.use_pkce === "boolean" ? cfg.use_pkce : DEFAULT_USE_PKCE,
		}
		return this._config
	}
	private static async saveToken(token: TokenSet) {
		const dir = path.dirname(this.TOKEN_CACHE_PATH)
		await fs.mkdir(dir, { recursive: true })
		const now = Math.floor(Date.now() / 1000)
		let expires_at: number | undefined = undefined
		let sub: string | undefined = undefined
		if (token.access_token) {
			const payload = parseJwtPayload(token.access_token)
			if (payload) {
				expires_at = typeof payload.exp === "number" ? payload.exp : undefined
				sub = typeof payload.sub === "string" ? payload.sub : undefined
			}
		}
		if (!expires_at && typeof token.expires_in === "number") {
			expires_at = now + token.expires_in
		}
		const toStore: OcaStoredToken = {
			...(token as any),
			created_at: now,
			expires_at: expires_at!,
			sub,
		}
		await fs.writeFile(this.TOKEN_CACHE_PATH, JSON.stringify(toStore), { encoding: "utf-8" })
		// On Windows, fs.chmod is a no-op. On POSIX, set 600.
		/**
		 * Windows permissions are managed via Access Control Lists (ACLs), which are more complex and flexible than UNIX-style permission bits.
		 * Windows user profile directories are generally protected from access by other users on the same system.
		   Sensitivity is typically managed by overall profile folder access (e.g., C:\Users\username is not world-readable by default).
		   Further restrictions (such as preventing SYSTEM or Administrators from reading files) are neither common nor practical on a typical domain-joined workstation.
		 */
		if (os.platform() !== "win32") {
			await fs.chmod(this.TOKEN_CACHE_PATH, 0o600)
		}
		return toStore
	}

	private static async loadToken(): Promise<OcaStoredToken | null> {
		try {
			const stats = await fs.stat(this.TOKEN_CACHE_PATH)
			if (os.platform() !== "win32") {
				const mode = stats.mode & 0o777
				if (mode !== 0o600) {
					await fs.rm(this.TOKEN_CACHE_PATH)
					throw new Error("Token file permissions should be owner read and write")
				}
			}
			const data = await fs.readFile(this.TOKEN_CACHE_PATH, "utf-8")
			return JSON.parse(data) as OcaStoredToken
		} catch {
			return null
		}
	}

	// Use this method instead of findAvailablePort
	private static async findAndBindAvailablePort(): Promise<{ port: number; server: http.Server }> {
		const config = await this.getConfig()
		for (const port of config.port_candidates) {
			try {
				const server = http.createServer()
				await new Promise((resolve, reject) => {
					server.once("error", reject)
					server.listen(port, "127.0.0.1", () => resolve(true))
				})
				return { port, server }
			} catch {
				continue
			}
		}
		throw new Error("No available port found.")
	}

	private static isAccessTokenValid(token: OcaStoredToken): boolean {
		const now = Math.floor(Date.now() / 1000)
		return typeof token.expires_at === "number" && now < token.expires_at - this.RENEW_TOKEN_BUFFER_SEC
	}
	private static async getClient(): Promise<Client> {
		if (this.client) {
			return this.client
		}
		const config = await this.getConfig()
		const issuer = await Issuer.discover(config.idcs_url)
		this.client = new issuer.Client({
			client_id: config.client_id,
			client_secret: config.client_secret,
			redirect_uris: [],
			response_types: ["code"],
			token_endpoint_auth_method: config.client_secret ? "client_secret_basic" : "none",
		})
		return this.client
	}
	public static async refreshToken(): Promise<OcaStoredToken | null> {
		if (!this.cachedToken) {
			this.cachedToken = await this.loadToken()
		}
		if (!this.cachedToken?.refresh_token) {
			return null
		}
		const client = await this.getClient()
		try {
			const refreshed: TokenSet = await client.refresh(this.cachedToken.refresh_token)
			const stored = await this.saveToken(refreshed)
			this.cachedToken = stored
			return stored
		} catch (err) {
			console.warn("⚠️ Refresh failed:", err)
			return null
		}
	}
	private static async checkAndRefreshTokenIfNeeded(): Promise<OcaStoredToken | null> {
		if (this.cachedToken && this.isAccessTokenValid(this.cachedToken)) {
			return this.cachedToken
		}
		return await this.refreshToken()
	}
	public static async getToken(): Promise<OcaStoredToken> {
		const config = await this.getConfig()
		const client = await this.getClient()
		this.cachedToken = await this.loadToken()
		const refreshed = await this.checkAndRefreshTokenIfNeeded()
		if (refreshed) {
			return refreshed
		}

		// Change: Find and BIND immediately, and use the returned server instance
		const { port, server } = await this.findAndBindAvailablePort()
		const redirect_uri = `http://localhost:${port}/callback`
		const app = express()

		const tokenPromise = new Promise<OcaStoredToken>((resolve, reject) => {
			// Attach Express app to the already opened server
			server.on("request", app)

			// Initiate OAuth flow after the server is listening
			;(async () => {
				let authUrl: string
				if (config.use_pkce) {
					this.codeVerifier = generators.codeVerifier()
					const codeChallenge = generators.codeChallenge(this.codeVerifier)
					authUrl = client.authorizationUrl({
						scope: config.scopes,
						redirect_uri,
						code_challenge: codeChallenge,
						code_challenge_method: "S256",
					})
				} else {
					authUrl = client.authorizationUrl({
						scope: config.scopes,
						redirect_uri,
					})
				}
				await openInBrowser(null, StringRequest.create({ value: authUrl }))
			})()

			app.get("/callback", async (req: Request, res: Response) => {
				try {
					const params = client.callbackParams(req)
					let tokenSet: TokenSet
					if (config.use_pkce) {
						tokenSet = await client.callback(redirect_uri, params, {
							code_verifier: this.codeVerifier,
						})
					} else {
						tokenSet = await client.callback(redirect_uri, params)
					}
					const stored = await this.saveToken(tokenSet)
					this.cachedToken = stored
					res.send("✅ Token obtained. You may close this tab.")
					resolve(stored)
				} catch (err) {
					res.status(400).send(`❌ OAuth failed. {error: ${err}}`)
					reject(err)
				} finally {
					server.close()
				}
			})
		})
		return await tokenPromise
	}
}
