import { describe, expect, it } from "vitest"
import { ProviderFailureTelemetryTurnGate } from "./provider-failure-telemetry"

describe("ProviderFailureTelemetryTurnGate", () => {
	it("captures one streaming failure per active turn", () => {
		const gate = new ProviderFailureTelemetryTurnGate()

		gate.beginTurn()

		expect(gate.shouldCaptureStreamingFailure()).toBe(true)
		expect(gate.shouldCaptureStreamingFailure()).toBe(false)
	})

	it("captures again when a new turn starts", () => {
		const gate = new ProviderFailureTelemetryTurnGate()

		gate.beginTurn()
		expect(gate.shouldCaptureStreamingFailure()).toBe(true)
		expect(gate.shouldCaptureStreamingFailure()).toBe(false)

		gate.beginTurn()
		expect(gate.shouldCaptureStreamingFailure()).toBe(true)
	})

	it("does not suppress streaming failures when no turn is active", () => {
		const gate = new ProviderFailureTelemetryTurnGate()

		expect(gate.shouldCaptureStreamingFailure()).toBe(true)
		expect(gate.shouldCaptureStreamingFailure()).toBe(true)
	})
})
