import { afterEach, describe, expect, it } from "bun:test"
import {
	getExtensionVariant,
	getRolloutErrorProperties,
	getRolloutTelemetryMetadata,
	ROLLOUT_ERROR_MESSAGE_LIMIT,
} from "./rollout-metadata"

const originalVariant = process.env.CLINE_ROLLOUT_VARIANT

afterEach(() => {
	restoreEnv("CLINE_ROLLOUT_VARIANT", originalVariant)
})

describe("rollout telemetry metadata", () => {
	it("returns metadata for a rollout build", () => {
		process.env.CLINE_ROLLOUT_VARIANT = "next"

		expect(getRolloutTelemetryMetadata()).toEqual({
			extension_variant: "next",
		})
	})

	it("omits metadata for ordinary or invalid builds", () => {
		delete process.env.CLINE_ROLLOUT_VARIANT
		expect(getRolloutTelemetryMetadata()).toEqual({})

		process.env.CLINE_ROLLOUT_VARIANT = "invalid"
		expect(getRolloutTelemetryMetadata()).toEqual({})
	})

	it("exposes the variant for rollout builds only", () => {
		process.env.CLINE_ROLLOUT_VARIANT = "legacy"
		expect(getExtensionVariant()).toBe("legacy")

		process.env.CLINE_ROLLOUT_VARIANT = "next"
		expect(getExtensionVariant()).toBe("next")

		delete process.env.CLINE_ROLLOUT_VARIANT
		expect(getExtensionVariant()).toBeUndefined()

		process.env.CLINE_ROLLOUT_VARIANT = "invalid"
		expect(getExtensionVariant()).toBeUndefined()
	})

	it("bounds fallback errors without including stacks", () => {
		const error = new TypeError("x".repeat(ROLLOUT_ERROR_MESSAGE_LIMIT + 20))
		const properties = getRolloutErrorProperties(error)

		expect(properties.error_type).toBe("TypeError")
		expect(properties.error_message).toHaveLength(ROLLOUT_ERROR_MESSAGE_LIMIT)
		expect(properties.error_message).not.toContain("TypeError:")
	})
})

function restoreEnv(key: "CLINE_ROLLOUT_VARIANT", value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key]
	} else {
		process.env[key] = value
	}
}
