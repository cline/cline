import { describe, expect, it } from "vitest"
import {
	getProviderFailureDedupeKey,
	PROVIDER_FAILURE_PHASE,
	ProviderFailureTelemetryDeduper,
} from "./provider-failure-telemetry"

describe("ProviderFailureTelemetryDeduper", () => {
	it("suppresses duplicate keyed captures for the same turn", () => {
		const deduper = new ProviderFailureTelemetryDeduper()
		const dedupeKey = getProviderFailureDedupeKey("turn-1", PROVIDER_FAILURE_PHASE.STREAMING)
		const nextTurnDedupeKey = getProviderFailureDedupeKey("turn-2", PROVIDER_FAILURE_PHASE.STREAMING)

		expect(deduper.shouldCapture({ dedupeKey })).toBe(true)
		expect(deduper.shouldCapture({ dedupeKey })).toBe(false)

		expect(deduper.shouldCapture({ dedupeKey: nextTurnDedupeKey })).toBe(true)
	})

	it("always captures events without a dedupe key", () => {
		const deduper = new ProviderFailureTelemetryDeduper()

		expect(deduper.shouldCapture({})).toBe(true)
		expect(deduper.shouldCapture({})).toBe(true)
	})
})
