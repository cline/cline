import { EXPERIMENT_IDS, experimentConfigsMap, experiments as Experiments, ExperimentId } from "../experiments"

describe("experiments", () => {
	describe("POWER_STEERING", () => {
		it("is configured correctly", () => {
			expect(EXPERIMENT_IDS.POWER_STEERING).toBe("powerSteering")
			expect(experimentConfigsMap.POWER_STEERING).toMatchObject({
				enabled: false,
			})
		})
	})

	describe("AUTO_CONDENSE_CONTEXT", () => {
		it("is configured correctly", () => {
			expect(EXPERIMENT_IDS.AUTO_CONDENSE_CONTEXT).toBe("autoCondenseContext")
			expect(experimentConfigsMap.AUTO_CONDENSE_CONTEXT).toMatchObject({
				enabled: false,
			})
		})
	})

	describe("isEnabled", () => {
		it("returns false when POWER_STEERING experiment is not enabled", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: false,
				autoCondenseContext: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(false)
		})

		it("returns true when experiment POWER_STEERING is enabled", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: true,
				autoCondenseContext: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(true)
		})

		it("returns false when experiment is not present", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: false,
				autoCondenseContext: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(false)
		})

		it("returns false when AUTO_CONDENSE_CONTEXT experiment is not enabled", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: false,
				autoCondenseContext: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.AUTO_CONDENSE_CONTEXT)).toBe(false)
		})

		it("returns true when AUTO_CONDENSE_CONTEXT experiment is enabled", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: false,
				autoCondenseContext: true,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.AUTO_CONDENSE_CONTEXT)).toBe(true)
		})
	})
})
