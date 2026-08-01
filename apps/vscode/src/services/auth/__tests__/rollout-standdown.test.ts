import * as assert from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
	decideStanddown,
	nextBundleOwnsClineAccount,
	resetRolloutStanddownForTests,
	shouldStandDownAuth,
} from "../rollout-standdown"

const originalVariant = process.env.CLINE_ROLLOUT_VARIANT
const originalDataDir = process.env.CLINE_DATA_DIR

afterEach(() => {
	resetRolloutStanddownForTests()
	restoreEnv("CLINE_ROLLOUT_VARIANT", originalVariant)
	restoreEnv("CLINE_DATA_DIR", originalDataDir)
})

describe("rollout auth stand-down", () => {
	const base = {
		envOverride: undefined,
		settingOverride: undefined,
		cached: undefined,
		previousFailure: false,
		nextOwnsClineAccount: true,
	}

	it("stands down only when the cached cohort assignment is next", () => {
		assert.strictEqual(decideStanddown({ ...base, cached: "next" }), true)
		assert.strictEqual(decideStanddown({ ...base, cached: "legacy" }), false)
		assert.strictEqual(decideStanddown({ ...base, cached: undefined }), false)
		assert.strictEqual(decideStanddown({ ...base, cached: "garbage" }), false)
	})

	it("never stands down until the next bundle holds the Cline credentials", () => {
		// Single-window case: the cohort flag flipped mid-session, but next has
		// never activated (or holds no cline refresh token) — this window is the
		// sole owner of the token family and must keep working untouched.
		assert.strictEqual(decideStanddown({ ...base, cached: "next", nextOwnsClineAccount: false }), false)
		// Both conditions hold: straggler alongside an active next bundle.
		assert.strictEqual(decideStanddown({ ...base, cached: "next", nextOwnsClineAccount: true }), true)
	})

	it("never stands down when the user forced a bundle (mirrors the loader's precedence)", () => {
		// Forced legacy: the user deliberately keeps this window on legacy.
		assert.strictEqual(decideStanddown({ ...base, cached: "next", envOverride: "legacy" }), false)
		assert.strictEqual(decideStanddown({ ...base, cached: "next", settingOverride: "legacy" }), false)
		// Forced next: the loader would never have activated this bundle; be safe anyway.
		assert.strictEqual(decideStanddown({ ...base, cached: "next", envOverride: "next" }), false)
		assert.strictEqual(decideStanddown({ ...base, cached: "next", settingOverride: "next" }), false)
		// "auto" is not an override.
		assert.strictEqual(decideStanddown({ ...base, cached: "next", settingOverride: "auto" }), true)
	})

	it("never stands down when the loader crash-pinned this VSIX version to legacy", () => {
		assert.strictEqual(decideStanddown({ ...base, cached: "next", previousFailure: true }), false)
	})

	it("shouldStandDownAuth is inert outside combined rollout legacy builds", () => {
		// Standalone/marketplace/dev builds have no CLINE_ROLLOUT_VARIANT: a
		// leftover loader memento must never disable auth there.
		delete process.env.CLINE_ROLLOUT_VARIANT
		assert.strictEqual(shouldStandDownAuth(), false)

		process.env.CLINE_ROLLOUT_VARIANT = "next"
		assert.strictEqual(shouldStandDownAuth(), false)
	})

	it("shouldStandDownAuth is inert before initialization even in rollout legacy builds", () => {
		process.env.CLINE_ROLLOUT_VARIANT = "legacy"
		assert.strictEqual(shouldStandDownAuth(), false)
	})
})

describe("nextBundleOwnsClineAccount", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "standdown-probe-"))
		process.env.CLINE_DATA_DIR = tempDir
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	function writeProvidersFile(contents: string): void {
		const dir = path.join(tempDir, "settings")
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(path.join(dir, "providers.json"), contents)
	}

	it("is false when providers.json does not exist (next never activated)", () => {
		assert.strictEqual(nextBundleOwnsClineAccount(), false)
	})

	it("is false when the cline entry has no auth (e.g. CLI picked a model but never signed in)", () => {
		writeProvidersFile(
			JSON.stringify({
				version: 1,
				providers: {
					cline: {
						settings: { provider: "cline", model: "anthropic/claude-sonnet-4.6" },
						updatedAt: "2026-01-01T00:00:00Z",
						tokenSource: "manual",
					},
				},
			}),
		)
		assert.strictEqual(nextBundleOwnsClineAccount(), false)
	})

	it("is true when the cline entry holds a refresh token (migrated or signed in on next)", () => {
		writeProvidersFile(
			JSON.stringify({
				version: 1,
				providers: {
					cline: {
						settings: {
							provider: "cline",
							auth: { accessToken: "at", refreshToken: "rt-1", accountId: "user_1" },
						},
						updatedAt: "2026-01-01T00:00:00Z",
						tokenSource: "migration",
					},
				},
			}),
		)
		assert.strictEqual(nextBundleOwnsClineAccount(), true)
	})

	it("fails open on malformed json", () => {
		writeProvidersFile("{not json")
		assert.strictEqual(nextBundleOwnsClineAccount(), false)
	})
})

function restoreEnv(key: "CLINE_ROLLOUT_VARIANT" | "CLINE_DATA_DIR", value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key]
	} else {
		process.env[key] = value
	}
}
