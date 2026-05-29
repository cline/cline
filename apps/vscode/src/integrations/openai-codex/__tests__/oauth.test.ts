import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { mockFetchForTesting } from "@/shared/net"
import { ClineFileStorage } from "@/shared/storage/ClineFileStorage"
import type { Secrets } from "@/shared/storage/state-keys"
import { version as clineVersion } from "../../../../package.json"
import { type OpenAiCodexCredentials, OpenAiCodexOAuthManager } from "../oauth"

const CREDENTIALS_KEY = "openai-codex-oauth-credentials"

function credentials(refreshToken: string, accessToken: string, expired = true): OpenAiCodexCredentials {
	return {
		type: "openai-codex",
		access_token: accessToken,
		refresh_token: refreshToken,
		expires: Date.now() + (expired ? -60_000 : 60 * 60_000),
	}
}

function successResponse(refreshToken: string, accessToken: string): Response {
	return new Response(
		JSON.stringify({
			access_token: accessToken,
			refresh_token: refreshToken,
			expires_in: 3600,
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	)
}

function invalidGrantResponse(): Response {
	return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Refresh token has already been used" }), {
		status: 400,
		statusText: "Bad Request",
		headers: { "Content-Type": "application/json" },
	})
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
	throw new Error("Timed out waiting for test condition")
}

class TestStateManager {
	private readonly secrets: ClineFileStorage<string>
	private readonly secretCache = new Map<keyof Secrets, string | undefined>()
	private readonly pendingSecrets = new Map<keyof Secrets, string | undefined>()
	private readonly dataDir: string
	private readonly beforeFlush?: () => Promise<void>

	constructor(dataDir: string, beforeFlush?: () => Promise<void>) {
		this.dataDir = dataDir
		this.beforeFlush = beforeFlush
		this.secrets = new ClineFileStorage<string>(path.join(dataDir, "secrets.json"), "TestSecrets")
		this.secretCache.set(CREDENTIALS_KEY, this.secrets.get(CREDENTIALS_KEY))
	}

	getDataDir(): string {
		return this.dataDir
	}

	getSecretKey<K extends keyof Secrets>(key: K): Secrets[K] {
		return this.secretCache.get(key) as Secrets[K]
	}

	reloadSecretKey<K extends keyof Secrets>(key: K): Secrets[K] {
		this.secrets.reloadFromDisk()
		const value = this.secrets.get(key)
		this.secretCache.set(key, value)
		return value as Secrets[K]
	}

	setSecret<K extends keyof Secrets>(key: K, value: Secrets[K]): void {
		this.secretCache.set(key, value)
		this.pendingSecrets.set(key, value)
	}

	async flushPendingState(): Promise<void> {
		await this.beforeFlush?.()
		this.secrets.reloadFromDisk()
		await this.secrets.setBatch(Object.fromEntries(this.pendingSecrets))
		this.pendingSecrets.clear()
	}
}

describe("OpenAiCodexOAuthManager refresh transaction", () => {
	let tempDir: string
	let secrets: ClineFileStorage<string>

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-codex-oauth-"))
		secrets = new ClineFileStorage<string>(path.join(tempDir, "secrets.json"), "TestSecrets")
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	function seed(storedCredentials: OpenAiCodexCredentials): void {
		secrets.set(CREDENTIALS_KEY, JSON.stringify(storedCredentials))
	}

	it("keeps the in-process refresh promise live until rotated credentials are persisted", async () => {
		seed(credentials("rt0", "at0"))
		const persistStarted = deferred()
		const allowPersist = deferred()
		const stateManager = new TestStateManager(tempDir, async () => {
			persistStarted.resolve()
			await allowPersist.promise
		})
		const manager = new OpenAiCodexOAuthManager(() => stateManager)
		const submissions: string[] = []

		await mockFetchForTesting(
			async (_input, init) => {
				submissions.push(new URLSearchParams(init?.body?.toString()).get("refresh_token") ?? "")
				return successResponse("rt1", "at1")
			},
			async () => {
				const first = manager.getAccessToken()
				await persistStarted.promise
				const second = manager.getAccessToken()
				await new Promise((resolve) => setTimeout(resolve, 20))
				assert.deepEqual(submissions, ["rt0"])
				allowPersist.resolve()
				assert.deepEqual(await Promise.all([first, second]), ["at1", "at1"])
			},
		)
	})

	it("does not report a refreshed token when durable persistence fails", async () => {
		seed(credentials("rt0", "at0"))
		const stateManager = new TestStateManager(tempDir, async () => {
			throw new Error("simulated persistence failure")
		})
		const manager = new OpenAiCodexOAuthManager(() => stateManager)

		await mockFetchForTesting(
			async () => successResponse("rt1", "at1"),
			async () => {
				assert.equal(await manager.getAccessToken(), null)
			},
		)

		secrets.reloadFromDisk()
		const storedCredentials = secrets.get(CREDENTIALS_KEY)
		assert.ok(storedCredentials)
		assert.equal(JSON.parse(storedCredentials).refresh_token, "rt0")
	})

	it("serializes refresh across managers with distinct stale caches", async () => {
		seed(credentials("rt0", "at0"))
		const firstStateManager = new TestStateManager(tempDir)
		const secondStateManager = new TestStateManager(tempDir)
		const firstManager = new OpenAiCodexOAuthManager(() => firstStateManager)
		const secondManager = new OpenAiCodexOAuthManager(() => secondStateManager)
		const submissions: string[] = []
		const userAgents: string[] = []

		await mockFetchForTesting(
			async (_input, init) => {
				submissions.push(new URLSearchParams(init?.body?.toString()).get("refresh_token") ?? "")
				userAgents.push(new Headers(init?.headers).get("User-Agent") ?? "")
				return successResponse("rt1", "at1")
			},
			async () => {
				assert.deepEqual(await Promise.all([firstManager.getAccessToken(), secondManager.getAccessToken()]), [
					"at1",
					"at1",
				])
			},
		)

		assert.deepEqual(submissions, ["rt0"])
		assert.deepEqual(userAgents, [`cline/${clineVersion}`])
	})

	it("returns null when credentials disappear while waiting for the refresh lock", async () => {
		seed(credentials("rt0", "at0"))
		const firstStateManager = new TestStateManager(tempDir)
		const secondStateManager = new TestStateManager(tempDir)
		const firstManager = new OpenAiCodexOAuthManager(() => firstStateManager)
		const secondManager = new OpenAiCodexOAuthManager(() => secondStateManager)
		const releaseResponse = deferred()

		await mockFetchForTesting(
			async () => {
				await releaseResponse.promise
				return invalidGrantResponse()
			},
			async () => {
				const first = firstManager.getAccessToken()
				await new Promise((resolve) => setTimeout(resolve, 20))
				const second = secondManager.getAccessToken()
				releaseResponse.resolve()
				assert.deepEqual(await Promise.all([first, second]), [null, null])
			},
		)
	})

	it("serializes forced refresh across managers and adopts a stored winner", async () => {
		seed(credentials("rt0", "at0", false))
		const firstStateManager = new TestStateManager(tempDir)
		const secondStateManager = new TestStateManager(tempDir)
		const firstManager = new OpenAiCodexOAuthManager(() => firstStateManager)
		const secondManager = new OpenAiCodexOAuthManager(() => secondStateManager)
		const releaseResponse = deferred()
		const submissions: string[] = []

		await mockFetchForTesting(
			async (_input, init) => {
				submissions.push(new URLSearchParams(init?.body?.toString()).get("refresh_token") ?? "")
				await releaseResponse.promise
				return successResponse("rt1", "at1")
			},
			async () => {
				const first = firstManager.forceRefreshAccessToken()
				await waitFor(() => submissions.length === 1)
				const second = secondManager.forceRefreshAccessToken()
				await new Promise((resolve) => setTimeout(resolve, 20))
				assert.deepEqual(submissions, ["rt0"])
				releaseResponse.resolve()
				assert.deepEqual(await Promise.all([first, second]), ["at1", "at1"])
			},
		)
	})

	it("preserves a newer stored token when a stale refresh receives invalid_grant", async () => {
		seed(credentials("rt0", "at0"))
		const stateManager = new TestStateManager(tempDir)
		const manager = new OpenAiCodexOAuthManager(() => stateManager)

		await mockFetchForTesting(
			async () => {
				secrets.reloadFromDisk()
				secrets.set(CREDENTIALS_KEY, JSON.stringify(credentials("rt1", "at1", false)))
				return invalidGrantResponse()
			},
			async () => {
				assert.equal(await manager.getAccessToken(), "at1")
			},
		)

		secrets.reloadFromDisk()
		const storedCredentials = secrets.get(CREDENTIALS_KEY)
		assert.ok(storedCredentials)
		assert.equal(JSON.parse(storedCredentials).refresh_token, "rt1")
	})

	it("clears credentials when invalid_grant still applies to the stored refresh token", async () => {
		seed(credentials("rt0", "at0"))
		const stateManager = new TestStateManager(tempDir)
		const manager = new OpenAiCodexOAuthManager(() => stateManager)

		await mockFetchForTesting(
			async () => invalidGrantResponse(),
			async () => {
				assert.equal(await manager.getAccessToken(), null)
			},
		)

		secrets.reloadFromDisk()
		assert.equal(secrets.get(CREDENTIALS_KEY), undefined)
	})
})
