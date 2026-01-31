import { Evaluator } from "../Evaluator"
import { EvaluatorSignals } from "../focus-chain/types"
import "should"

describe("Evaluator", () => {
	let evaluator: Evaluator

	beforeEach(() => {
		evaluator = new Evaluator(3, 3) // maxMistakes=3, maxReplan=3
	})

	describe("evaluate", () => {
		it('should return "continue" when signals is undefined and no mistakes', () => {
			const decision = evaluator.evaluate(undefined, { consecutiveMistakeCount: 0, apiRequestsCount: 1 })
			decision.should.equal("continue")
		})

		it('should return "stop" when mistake count exceeds max', () => {
			const decision = evaluator.evaluate(undefined, { consecutiveMistakeCount: 3, apiRequestsCount: 1 })
			decision.should.equal("stop")
		})

		it('should respect model "stop" signal', () => {
			const signals: EvaluatorSignals = { decision: "stop", reasoning: "failed" }
			const decision = evaluator.evaluate(signals, { consecutiveMistakeCount: 0, apiRequestsCount: 1 })
			decision.should.equal("stop")
		})

		it('should return "replan" and increment counter', () => {
			const signals: EvaluatorSignals = { decision: "replan", reasoning: "adjusting" }
			const decision = evaluator.evaluate(signals, { consecutiveMistakeCount: 0, apiRequestsCount: 1 })
			decision.should.equal("replan")
		})

		it('should return "stop" after excessive replans', () => {
			const signals: EvaluatorSignals = { decision: "replan", reasoning: "adjusting" }

			// Replan 3 times (limit is 3)
			evaluator.evaluate(signals, { consecutiveMistakeCount: 0, apiRequestsCount: 1 }) // 1
			evaluator.evaluate(signals, { consecutiveMistakeCount: 0, apiRequestsCount: 1 }) // 2
			evaluator.evaluate(signals, { consecutiveMistakeCount: 0, apiRequestsCount: 1 }) // 3

			// 4th time should fail
			const decision = evaluator.evaluate(signals, { consecutiveMistakeCount: 0, apiRequestsCount: 1 })
			decision.should.equal("stop")
		})

		it('should reset replan count on "continue"', () => {
			const replanSignals: EvaluatorSignals = { decision: "replan", reasoning: "adjusting" }
			const continueSignals: EvaluatorSignals = { decision: "continue", reasoning: "ok" }

			evaluator.evaluate(replanSignals, { consecutiveMistakeCount: 0, apiRequestsCount: 1 })
			evaluator.evaluate(replanSignals, { consecutiveMistakeCount: 0, apiRequestsCount: 1 })

			// Continue should reset
			evaluator.evaluate(continueSignals, { consecutiveMistakeCount: 0, apiRequestsCount: 1 })

			// Should allow more replans now
			const decision = evaluator.evaluate(replanSignals, { consecutiveMistakeCount: 0, apiRequestsCount: 1 })
			decision.should.equal("replan")
		})
	})
})
