import * as assert from "assert"
import {
	getExtensionVariant,
	getRolloutErrorProperties,
	getRolloutTelemetryMetadata,
	ROLLOUT_ERROR_MESSAGE_LIMIT,
} from "../rollout-metadata"

const originalVariant = process.env.CLINE_ROLLOUT_VARIANT

afterEach(() => {
	restoreEnv("CLINE_ROLLOUT_VARIANT", originalVariant)
})

describe("rollout telemetry metadata", () => {
	it("returns metadata for a rollout build", () => {
		process.env.CLINE_ROLLOUT_VARIANT = "legacy"

		assert.deepStrictEqual(getRolloutTelemetryMetadata(), {
			extension_variant: "legacy",
		})
	})

	it("omits metadata for ordinary or invalid builds", () => {
		delete process.env.CLINE_ROLLOUT_VARIANT
		assert.deepStrictEqual(getRolloutTelemetryMetadata(), {})

		process.env.CLINE_ROLLOUT_VARIANT = "invalid"
		assert.deepStrictEqual(getRolloutTelemetryMetadata(), {})
	})

	it("exposes the variant for rollout builds only", () => {
		process.env.CLINE_ROLLOUT_VARIANT = "legacy"
		assert.strictEqual(getExtensionVariant(), "legacy")

		process.env.CLINE_ROLLOUT_VARIANT = "next"
		assert.strictEqual(getExtensionVariant(), "next")

		delete process.env.CLINE_ROLLOUT_VARIANT
		assert.strictEqual(getExtensionVariant(), undefined)

		process.env.CLINE_ROLLOUT_VARIANT = "invalid"
		assert.strictEqual(getExtensionVariant(), undefined)
	})

	it("bounds fallback errors without including stacks", () => {
		const error = new TypeError("x".repeat(ROLLOUT_ERROR_MESSAGE_LIMIT + 20))
		const properties = getRolloutErrorProperties(error)

		assert.strictEqual(properties.error_type, "TypeError")
		assert.strictEqual(properties.error_message.length, ROLLOUT_ERROR_MESSAGE_LIMIT)
		assert.ok(!properties.error_message.includes("TypeError:"))
	})
})

function restoreEnv(key: "CLINE_ROLLOUT_VARIANT", value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key]
	} else {
		process.env[key] = value
	}
}
