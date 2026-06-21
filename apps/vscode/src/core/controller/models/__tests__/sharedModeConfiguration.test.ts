import { describe, expect, it, vi } from "vitest"
import type { ApiConfiguration } from "@/shared/api"
import { ensureSharedModeApiConfiguration, mirrorPlanActApiConfiguration } from "../sharedModeConfiguration"

describe("shared mode API configuration", () => {
	it("mirrors all plan/act fields from act mode", () => {
		expect(
			mirrorPlanActApiConfiguration({
				planModeApiProvider: "openrouter",
				actModeApiProvider: "anthropic",
				planModeApiModelId: "plan-model",
				actModeApiModelId: "act-model",
				actModeReasoningEffort: "high",
			} satisfies ApiConfiguration),
		).toMatchObject({
			planModeApiProvider: "anthropic",
			actModeApiProvider: "anthropic",
			planModeApiModelId: "act-model",
			actModeApiModelId: "act-model",
			planModeReasoningEffort: "high",
			actModeReasoningEffort: "high",
		})
	})

	it("falls back to plan mode only when act mode is empty", () => {
		expect(
			mirrorPlanActApiConfiguration({
				planModeApiProvider: "openrouter",
				planModeApiModelId: "plan-model",
			} satisfies ApiConfiguration),
		).toMatchObject({
			planModeApiProvider: "openrouter",
			actModeApiProvider: "openrouter",
			planModeApiModelId: "plan-model",
			actModeApiModelId: "plan-model",
		})
	})

	it("persists mirrored config and disables the legacy separate-model flag", () => {
		const setApiConfiguration = vi.fn()
		const setGlobalState = vi.fn()
		const controller = {
			stateManager: {
				getApiConfiguration: () =>
					({
						planModeApiProvider: "openrouter",
						actModeApiProvider: "anthropic",
					}) satisfies ApiConfiguration,
				getGlobalSettingsKey: ((key: "planActSeparateModelsSetting") => true) as (
					key: "planActSeparateModelsSetting",
				) => boolean,
				setApiConfiguration,
				setGlobalState,
			},
		}

		expect(ensureSharedModeApiConfiguration(controller)).toMatchObject({
			planModeApiProvider: "anthropic",
			actModeApiProvider: "anthropic",
		})
		expect(setApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				planModeApiProvider: "anthropic",
				actModeApiProvider: "anthropic",
			}),
		)
		expect(setGlobalState).toHaveBeenCalledWith("planActSeparateModelsSetting", false)
	})
})
