import { describe, expect, it } from "vitest"
import {
	getProviderFailureDedupeKey,
	PROVIDER_FAILURE_PHASE,
	ProviderFailureTelemetryDeduper,
} from "./provider-failure-telemetry"

describe("ProviderFailureTelemetryDeduper", () => {
	it("suppresses duplicate keyed captures until the session is reset", () => {
		const deduper = new ProviderFailureTelemetryDeduper()
		const dedupeKey = getProviderFailureDedupeKey("session-123", PROVIDER_FAILURE_PHASE.STREAMING)

		expect(deduper.shouldCapture({ dedupeKey })).toBe(true)
		expect(deduper.shouldCapture({ dedupeKey })).toBe(false)

		deduper.resetSession("session-123")

		expect(deduper.shouldCapture({ dedupeKey })).toBe(true)
	})

	it("always captures events without a dedupe key", () => {
		const deduper = new ProviderFailureTelemetryDeduper()

		expect(deduper.shouldCapture({})).toBe(true)
		expect(deduper.shouldCapture({})).toBe(true)
	})
})
