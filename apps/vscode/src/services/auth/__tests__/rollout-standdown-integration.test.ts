import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as sinon from "sinon"
import type * as vscode from "vscode"
import type { Controller } from "@/core/controller"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import type { ClineAuthInfo } from "../AuthService"
import { ClineAuthProvider } from "../providers/ClineAuthProvider"
import {
	COHORT_STATE_KEY,
	initializeRolloutStanddown,
	resetRolloutStanddownForTests,
	shouldStandDownAuth,
} from "../rollout-standdown"

const SECRET_KEY = "cline:clineAccountId"
const originalVariant = process.env.CLINE_ROLLOUT_VARIANT
const originalDataDir = process.env.CLINE_DATA_DIR

function base64url(value: object): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url")
}

/** Unsigned JWT whose `exp` claim sits `secondsFromNow` away. */
function jwtExpiringIn(secondsFromNow: number): string {
	const exp = Math.floor(Date.now() / 1000) + secondsFromNow
	return `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ exp, sid: "sess_1", external_id: "user_1" })}.sig`
}

function authBlob(secondsFromNow: number, refreshToken: string): string {
	const info: ClineAuthInfo = {
		idToken: jwtExpiringIn(secondsFromNow),
		refreshToken,
		expiresAt: Math.floor(Date.now() / 1000) + secondsFromNow,
		userInfo: {
			createdAt: "2026-01-01T00:00:00Z",
			displayName: "Test User",
			email: "test@example.com",
			id: "user_1",
			organizations: [],
		},
		provider: "cline",
		startedAt: Date.now(),
	}
	return JSON.stringify(info)
}

interface FakeController {
	controller: Controller
	secrets: Map<string, string | undefined>
}

function fakeController(storedBlob: string): FakeController {
	const secrets = new Map<string, string | undefined>([[SECRET_KEY, storedBlob]])
	const controller = {
		stateManager: {
			getSecretKey: (key: string) => secrets.get(key),
			setSecret: (key: string, value: string | undefined) => {
				secrets.set(key, value)
			},
		},
	} as unknown as Controller
	return { controller, secrets }
}

function fakeExtensionContext(cohort: string | undefined): vscode.ExtensionContext {
	return {
		extension: { packageJSON: { name: "claude-dev", version: "4.1.2" } },
		globalState: {
			get: (key: string) => (key === COHORT_STATE_KEY ? cohort : undefined),
		},
	} as unknown as vscode.ExtensionContext
}

describe("rollout stand-down at the token rotation site", () => {
	let tempDir: string
	let refreshSpy: sinon.SinonStub
	let showMessageSpy: sinon.SinonStub
	let reloadSpy: sinon.SinonSpy

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "standdown-e2e-"))
		process.env.CLINE_DATA_DIR = tempDir
		process.env.CLINE_ROLLOUT_VARIANT = "legacy"
		// ClineEnv is uninitialized in unit tests; the refresh path logs the base URL.
		sinon.stub(ClineAuthProvider.prototype, "config").get(() => ({ apiBaseUrl: "http://127.0.0.1:1" }))
		refreshSpy = sinon.stub(ClineAuthProvider.prototype, "refreshToken").rejects(new Error("network call attempted"))
		showMessageSpy = sinon.stub().resolves({ selectedOption: undefined })
		sinon.stub(HostProvider, "window").get(() => ({ showMessage: showMessageSpy }))
		reloadSpy = sinon.spy()
	})

	afterEach(() => {
		sinon.restore()
		resetRolloutStanddownForTests()
		fs.rmSync(tempDir, { recursive: true, force: true })
		restoreEnv("CLINE_ROLLOUT_VARIANT", originalVariant)
		restoreEnv("CLINE_DATA_DIR", originalDataDir)
	})

	function giveNextTheCredentials(): void {
		const dir = path.join(tempDir, "settings")
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(
			path.join(dir, "providers.json"),
			JSON.stringify({
				version: 1,
				providers: {
					cline: {
						settings: {
							provider: "cline",
							auth: { accessToken: "at", refreshToken: "rt-shared", accountId: "user_1" },
						},
						updatedAt: "2026-01-01T00:00:00Z",
						tokenSource: "migration",
					},
				},
			}),
		)
	}

	it("keeps serving the current access token without rotating it", async () => {
		// Inside the 5-minute early-refresh window, so the unguarded code would
		// hit /auth/refresh and consume the shared one-time-use refresh token.
		giveNextTheCredentials()
		initializeRolloutStanddown(fakeExtensionContext("next"), reloadSpy)
		const { controller, secrets } = fakeController(authBlob(120, "rt-shared"))

		const result = await new ClineAuthProvider().retrieveClineAuthInfo(controller)

		assert.ok(result, "expected the still-valid stored credentials back")
		assert.strictEqual(result?.refreshToken, "rt-shared")
		assert.strictEqual(refreshSpy.callCount, 0, "must not rotate the refresh token")
		assert.strictEqual(showMessageSpy.callCount, 0, "must not nag while the token is still usable")
		assert.ok(secrets.get(SECRET_KEY), "the stored blob must stay intact for next's migration")
	})

	it("surfaces the reload notice once the access token expires, without clearing the blob", async () => {
		giveNextTheCredentials()
		initializeRolloutStanddown(fakeExtensionContext("next"), reloadSpy)
		const { controller, secrets } = fakeController(authBlob(-10, "rt-shared"))
		const provider = new ClineAuthProvider()

		const result = await provider.retrieveClineAuthInfo(controller)

		assert.strictEqual(result, null)
		assert.strictEqual(refreshSpy.callCount, 0, "must not rotate the refresh token")
		assert.strictEqual(showMessageSpy.callCount, 1)
		const request = showMessageSpy.firstCall.args[0]
		assert.strictEqual(request.type, ShowMessageType.WARNING)
		assert.match(request.message, /upgraded to the new version of Cline/)
		assert.deepStrictEqual(request.options.items, ["Reload Window"])
		assert.ok(secrets.get(SECRET_KEY), "stand-down must never destroy the credentials")

		// One notice per window, however many times auth is re-checked.
		await provider.retrieveClineAuthInfo(controller)
		assert.strictEqual(showMessageSpy.callCount, 1)
	})

	it("reloads the window when the user accepts the notice", async () => {
		showMessageSpy.resolves({ selectedOption: "Reload Window" })
		giveNextTheCredentials()
		initializeRolloutStanddown(fakeExtensionContext("next"), reloadSpy)
		const { controller } = fakeController(authBlob(-10, "rt-shared"))

		await new ClineAuthProvider().retrieveClineAuthInfo(controller)
		await new Promise((resolve) => setImmediate(resolve))

		assert.strictEqual(reloadSpy.callCount, 1)
	})

	it("refreshes normally when the machine is still assigned to legacy", async () => {
		giveNextTheCredentials()
		initializeRolloutStanddown(fakeExtensionContext("legacy"), reloadSpy)
		const { controller } = fakeController(authBlob(120, "rt-shared"))

		await new ClineAuthProvider().retrieveClineAuthInfo(controller)

		assert.strictEqual(refreshSpy.callCount, 1, "a non-promoted machine must keep refreshing")
	})

	it("refreshes normally when next holds no Cline credentials yet", async () => {
		// Promoted cohort, but next has never activated: this window is the sole
		// owner of the token family and must keep itself alive.
		initializeRolloutStanddown(fakeExtensionContext("next"), reloadSpy)
		const { controller } = fakeController(authBlob(120, "rt-shared"))

		await new ClineAuthProvider().retrieveClineAuthInfo(controller)

		assert.strictEqual(refreshSpy.callCount, 1, "sole owner must keep refreshing")
	})

	it("reports the stand-down through the public gate used by the sign-in guard", () => {
		giveNextTheCredentials()
		initializeRolloutStanddown(fakeExtensionContext("next"), reloadSpy)

		assert.strictEqual(shouldStandDownAuth(), true)
	})

	it("refreshes normally in a standalone (non-rollout) build", async () => {
		delete process.env.CLINE_ROLLOUT_VARIANT
		giveNextTheCredentials()
		initializeRolloutStanddown(fakeExtensionContext("next"), reloadSpy)
		const { controller } = fakeController(authBlob(120, "rt-shared"))

		await new ClineAuthProvider().retrieveClineAuthInfo(controller)

		assert.strictEqual(refreshSpy.callCount, 1, "a leftover memento must not disable auth outside the rollout")
	})
})

function restoreEnv(key: "CLINE_ROLLOUT_VARIANT" | "CLINE_DATA_DIR", value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key]
	} else {
		process.env[key] = value
	}
}
