import { EXPERIMENT_IDS, experimentConfigsMap, experiments as Experiments, ExperimentId } from "../experiments"

describe("experiments", () => {
	describe("POWER_STEERING", () => {
		it("is configured correctly", () => {
			expect(EXPERIMENT_IDS.POWER_STEERING).toBe("powerSteering")
			expect(experimentConfigsMap.POWER_STEERING).toMatchObject({
				name: 'Use experimental "power steering" mode',
				description:
					"When enabled, Roo will remind the model about the details of its current mode definition more frequently. This will lead to stronger adherence to role definitions and custom instructions, but will use more tokens per message.",
				enabled: false,
			})
		})
	})

	describe("isEnabled", () => {
		it("returns false when experiment is not enabled", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: false,
				experimentalDiffStrategy: false,
				search_and_replace: false,
				insert_content: false,
				multi_search_and_replace: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(false)
		})

		it("returns true when experiment is enabled", () => {
			const experiments: Record<ExperimentId, boolean> = {
				powerSteering: true,
				experimentalDiffStrategy: false,
				search_and_replace: false,
				insert_content: false,
				multi_search_and_replace: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(true)
		})

		it("returns false when experiment is not present", () => {
			const experiments: Record<ExperimentId, boolean> = {
				experimentalDiffStrategy: false,
				search_and_replace: false,
				insert_content: false,
				powerSteering: false,
				multi_search_and_replace: false,
			}
			expect(Experiments.isEnabled(experiments, EXPERIMENT_IDS.POWER_STEERING)).toBe(false)
		})
	})
})
