import * as assert from "assert"
import { decideStanddown, resetRolloutStanddownForTests, shouldStandDownAuth } from "../rollout-standdown"

const originalVariant = process.env.CLINE_ROLLOUT_VARIANT

afterEach(() => {
	resetRolloutStanddownForTests()
	if (originalVariant === undefined) {
		delete process.env.CLINE_ROLLOUT_VARIANT
	} else {
		process.env.CLINE_ROLLOUT_VARIANT = originalVariant
	}
})

describe("rollout auth stand-down", () => {
	const base = {
		envOverride: undefined,
		settingOverride: undefined,
		cached: undefined,
		previousFailure: false,
	}

	it("stands down only when the cached cohort assignment is next", () => {
		assert.strictEqual(decideStanddown({ ...base, cached: "next" }), true)
		assert.strictEqual(decideStanddown({ ...base, cached: "legacy" }), false)
		assert.strictEqual(decideStanddown({ ...base, cached: undefined }), false)
		assert.strictEqual(decideStanddown({ ...base, cached: "garbage" }), false)
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
