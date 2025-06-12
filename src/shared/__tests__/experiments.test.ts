// npx jest src/shared/__tests__/experiments.test.ts

import type { ExperimentId } from "@roo-code/types"

import { EXPERIMENT_IDS, experimentConfigsMap, experiments as Experiments } from "../experiments"

describe("experiments", () => {
	describe("POWER_STEERING", () => {
		it("is configured correctly", () => {
			expect(EXPERIMENT_IDS.POWER_STEERING).toBe("powerSteering")
			expect(experimentConfigsMap.POWER_STEERING).toMatchObject({
				enabled: false,
			})
		})
	})

	describe("MULTI_FILE_APPLY_DIFF", () => {
		it("is configured correctly", () => {
			expect(EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF).toBe("multiFileApplyDiff")
			expect(experimentConfigsMap.MULTI_FILE_APPLY_DIFF).toMatchObject({
				enabled: false,
			})
		})
	})

	describe("isEnabled", () => {
		it("returns false when POWER_STEERING experiment is not enabled", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: false,
				marketplace: false,
				disableCompletionCommand: false,
				multiFileApplyDiff: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(false)
		})

		it("returns true when experiment POWER_STEERING is enabled", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: true,
				marketplace: false,
				disableCompletionCommand: false,
				multiFileApplyDiff: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(true)
		})

		it("returns false when experiment is not present", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: false,
				marketplace: false,
				disableCompletionCommand: false,
				multiFileApplyDiff: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(false)
		})
	})
	describe("MARKETPLACE", () => {
		it("is configured correctly", () => {
			expect(EXPERIMENT_IDS.MARKETPLACE).toBe("marketplace")
			expect(experimentConfigsMap.MARKETPLACE).toMatchObject({
				enabled: false,
			})
		})
	})

	describe("isEnabled for MARKETPLACE", () => {
		it("returns false when MARKETPLACE experiment is not enabled", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: false,
				marketplace: false,
				disableCompletionCommand: false,
				multiFileApplyDiff: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.MARKETPLACE)).toBe(false)
		})

		it("returns true when MARKETPLACE experiment is enabled", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: false,
				marketplace: true,
				disableCompletionCommand: false,
				multiFileApplyDiff: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.MARKETPLACE)).toBe(true)
		})

		it("returns false when MARKETPLACE experiment is not present", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: false,
				// marketplace missing
			} as any
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.MARKETPLACE)).toBe(false)
		})
	})
})
