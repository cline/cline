import assert from "node:assert/strict"
import { describe, it } from "mocha"
import {
	DOUBLE_CHECK_FINALIZATION_RESERVE_SEC,
	DOUBLE_CHECK_MAX_GATE_REJECTIONS,
	evaluateDoubleCheckGateFuse,
	resolveDoubleCheckTaskTimeoutSeconds,
} from "../AttemptCompletionHandler"

describe("AttemptCompletionHandler gate fuse policy", () => {
	it("bypasses when max gate rejections is reached", () => {
		const decision = evaluateDoubleCheckGateFuse({
			rejectionCount: DOUBLE_CHECK_MAX_GATE_REJECTIONS,
			taskStartTimeMs: 0,
		})

		assert.equal(decision.shouldBypass, true)
		assert.equal(decision.reason, "max_gate_rejections")
	})

	it("does not bypass when below max rejections and no timeout is configured", () => {
		const decision = evaluateDoubleCheckGateFuse({
			rejectionCount: DOUBLE_CHECK_MAX_GATE_REJECTIONS - 1,
			taskStartTimeMs: 0,
		})

		assert.equal(decision.shouldBypass, false)
		assert.equal(decision.reason, undefined)
	})

	it("bypasses when remaining budget is within finalization reserve", () => {
		const decision = evaluateDoubleCheckGateFuse({
			rejectionCount: 1,
			taskStartTimeMs: 0,
			taskTimeoutSeconds: 100,
			finalizationReserveSec: DOUBLE_CHECK_FINALIZATION_RESERVE_SEC,
			nowMs: (100 - DOUBLE_CHECK_FINALIZATION_RESERVE_SEC + 1) * 1000,
		})

		assert.equal(decision.shouldBypass, true)
		assert.equal(decision.reason, "finalization_reserve")
	})

	it("does not bypass when budget remains outside finalization reserve", () => {
		const decision = evaluateDoubleCheckGateFuse({
			rejectionCount: 1,
			taskStartTimeMs: 0,
			taskTimeoutSeconds: 300,
			finalizationReserveSec: 60,
			nowMs: 100_000,
		})

		assert.equal(decision.shouldBypass, false)
		assert.equal(decision.reason, undefined)
	})

	it("parses timeout seconds from environment when valid", () => {
		const timeout = resolveDoubleCheckTaskTimeoutSeconds({
			CLINE_TASK_TIMEOUT_SECONDS: "1200",
		})

		assert.equal(timeout, 1200)
	})

	it("ignores missing or invalid timeout environment values", () => {
		assert.equal(resolveDoubleCheckTaskTimeoutSeconds({}), undefined)
		assert.equal(resolveDoubleCheckTaskTimeoutSeconds({ CLINE_TASK_TIMEOUT_SECONDS: "abc" }), undefined)
		assert.equal(resolveDoubleCheckTaskTimeoutSeconds({ CLINE_TASK_TIMEOUT_SECONDS: "0" }), undefined)
	})
})
