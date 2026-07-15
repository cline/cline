import { afterEach, describe, expect, it } from "bun:test"
import {
	attachRolloutTelemetryMetadata,
	getRolloutErrorProperties,
	getRolloutTelemetryMetadata,
	ROLLOUT_ERROR_TYPE_LIMIT,
} from "./rollout-metadata"

const originalVariant = process.env.CLINE_ROLLOUT_VARIANT
const originalRolloutVersion = process.env.CLINE_ROLLOUT_VERSION

afterEach(() => {
	restoreEnv("CLINE_ROLLOUT_VARIANT", originalVariant)
	restoreEnv("CLINE_ROLLOUT_VERSION", originalRolloutVersion)
})

describe("rollout telemetry metadata", () => {
	it("returns metadata for a rollout build", () => {
		process.env.CLINE_ROLLOUT_VARIANT = "next"
		process.env.CLINE_ROLLOUT_VERSION = "4.1.0"

		expect(getRolloutTelemetryMetadata()).toEqual({
			extension_variant: "next",
			rollout_version: "4.1.0",
		})
	})

	it("omits metadata for ordinary or invalid builds", () => {
		delete process.env.CLINE_ROLLOUT_VARIANT
		process.env.CLINE_ROLLOUT_VERSION = "4.1.0"
		expect(getRolloutTelemetryMetadata()).toEqual({})

		process.env.CLINE_ROLLOUT_VARIANT = "invalid"
		expect(getRolloutTelemetryMetadata()).toEqual({})
	})

	it("decorates accepted error events while preserving their properties", () => {
		process.env.CLINE_ROLLOUT_VARIANT = "next"
		process.env.CLINE_ROLLOUT_VERSION = "4.1.0"
		const event: { properties?: Record<string, unknown> } = {
			properties: { existing: true, extension_variant: "spoofed" },
		}

		attachRolloutTelemetryMetadata(event)

		expect(event.properties).toEqual({
			existing: true,
			extension_variant: "next",
			rollout_version: "4.1.0",
		})
	})

	it("does not label error events from ordinary builds", () => {
		delete process.env.CLINE_ROLLOUT_VARIANT
		delete process.env.CLINE_ROLLOUT_VERSION
		const event: { properties?: Record<string, unknown> } = {
			properties: { existing: true },
		}
		attachRolloutTelemetryMetadata(event)
		expect(event.properties).toEqual({ existing: true })
	})

	it("reports only a bounded error type and never the raw fallback message", () => {
		const error = new TypeError('authorization: Bearer abc123 {"apiKey":"secret"}')
		expect(getRolloutErrorProperties(error)).toEqual({ error_type: "TypeError" })

		error.name = "x".repeat(ROLLOUT_ERROR_TYPE_LIMIT + 1)
		expect(getRolloutErrorProperties(error)).toEqual({ error_type: "Error" })

		error.name = "Unsafe Error Name"
		expect(getRolloutErrorProperties(error)).toEqual({ error_type: "Error" })
	})
})

function restoreEnv(key: "CLINE_ROLLOUT_VARIANT" | "CLINE_ROLLOUT_VERSION", value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key]
	} else {
		process.env[key] = value
	}
}
