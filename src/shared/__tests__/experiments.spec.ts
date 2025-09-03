// npx vitest run src/shared/__tests__/experiments.spec.ts

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
				multiFileApplyDiff: false,
				preventFocusDisruption: false,
				imageGeneration: false,
				runSlashCommand: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(false)
		})

		it("returns true when experiment POWER_STEERING is enabled", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: true,
				multiFileApplyDiff: false,
				preventFocusDisruption: false,
				imageGeneration: false,
				runSlashCommand: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(true)
		})

		it("returns false when experiment is not present", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: false,
				multiFileApplyDiff: false,
				preventFocusDisruption: false,
				imageGeneration: false,
				runSlashCommand: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(false)
		})
	})
})
