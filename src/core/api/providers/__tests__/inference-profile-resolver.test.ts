import "should"
import { InferenceProfileResolver } from "../inference-profiles"

describe("InferenceProfileResolver", () => {
	describe("resolveModelId", () => {
		describe("none mode", () => {
			it("should return base model ID for none mode", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-3-7-sonnet-20250219-v1:0",
					"us-east-1",
					"none",
					false,
				)

				result.modelId.should.equal("anthropic.claude-3-7-sonnet-20250219-v1:0")
				result.supportsGlobalProfile.should.be.false()
				should.not.exist(result.appliedRule)
			})

			it("should detect global profile support for Sonnet 4 models", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-sonnet-4-20250514-v1:0",
					"us-east-1",
					"none",
					false,
				)

				result.modelId.should.equal("anthropic.claude-sonnet-4-20250514-v1:0")
				result.supportsGlobalProfile.should.be.true()
			})

			it("should detect global profile support for Sonnet 4.5 models", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-sonnet-4-5-20250929-v1:0",
					"us-east-1",
					"none",
					false,
				)

				result.modelId.should.equal("anthropic.claude-sonnet-4-5-20250929-v1:0")
				result.supportsGlobalProfile.should.be.true()
			})
		})

		describe("regional mode", () => {
			it("should apply US prefix for US regions", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-3-7-sonnet-20250219-v1:0",
					"us-west-2",
					"regional",
					false,
				)

				result.modelId.should.equal("us.anthropic.claude-3-7-sonnet-20250219-v1:0")
				should.exist(result.appliedRule)
				result.appliedRule!.description!.should.equal("US regional inference profile")
			})

			it("should apply EU prefix for EU regions", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-3-7-sonnet-20250219-v1:0",
					"eu-central-1",
					"regional",
					false,
				)

				result.modelId.should.equal("eu.anthropic.claude-3-7-sonnet-20250219-v1:0")
				should.exist(result.appliedRule)
				result.appliedRule!.description!.should.equal("EU regional inference profile")
			})

			it("should apply JP prefix for Claude Sonnet 4.5 in Japan regions", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-sonnet-4-5-20250929-v1:0",
					"ap-northeast-1",
					"regional",
					false,
				)

				result.modelId.should.equal("jp.anthropic.claude-sonnet-4-5-20250929-v1:0")
				should.exist(result.appliedRule)
				result.appliedRule!.description!.should.equal("JP inference profile for Claude Sonnet 4.5 in Japan regions")
			})

			it("should apply JP prefix for Claude Sonnet 4.5 in ap-northeast-3", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-sonnet-4-5-20250929-v1:0",
					"ap-northeast-3",
					"regional",
					false,
				)

				result.modelId.should.equal("jp.anthropic.claude-sonnet-4-5-20250929-v1:0")
				should.exist(result.appliedRule)
				result.appliedRule!.description!.should.equal("JP inference profile for Claude Sonnet 4.5 in Japan regions")
			})

			it("should apply APAC prefix for non-Sonnet 4.5 models in AP regions", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-3-7-sonnet-20250219-v1:0",
					"ap-northeast-1",
					"regional",
					false,
				)

				result.modelId.should.equal("apac.anthropic.claude-3-7-sonnet-20250219-v1:0")
				should.exist(result.appliedRule)
				result.appliedRule!.description!.should.equal("APAC regional inference profile")
			})

			it("should apply APAC prefix for Sonnet 4.5 in non-JP AP regions", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-sonnet-4-5-20250929-v1:0",
					"ap-south-1",
					"regional",
					false,
				)

				result.modelId.should.equal("apac.anthropic.claude-sonnet-4-5-20250929-v1:0")
				should.exist(result.appliedRule)
				result.appliedRule!.description!.should.equal("APAC regional inference profile")
			})

			it("should return base model ID for unsupported regions", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-3-7-sonnet-20250219-v1:0",
					"af-south-1",
					"regional",
					false,
				)

				result.modelId.should.equal("anthropic.claude-3-7-sonnet-20250219-v1:0")
				should.not.exist(result.appliedRule)
			})
		})

		describe("global mode", () => {
			it("should apply global prefix for supported models", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-sonnet-4-20250514-v1:0",
					"us-east-1",
					"global",
					false,
				)

				result.modelId.should.equal("global.anthropic.claude-sonnet-4-20250514-v1:0")
				should.exist(result.appliedRule)
				result.appliedRule!.description!.should.equal("Global inference profile for Claude Sonnet 4 and 4.5 models")
			})

			it("should apply global prefix for Sonnet 4.5 models", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-sonnet-4-5-20250929-v1:0",
					"eu-central-1",
					"global",
					false,
				)

				result.modelId.should.equal("global.anthropic.claude-sonnet-4-5-20250929-v1:0")
				should.exist(result.appliedRule)
				result.appliedRule!.description!.should.equal("Global inference profile for Claude Sonnet 4 and 4.5 models")
			})

			it("should return base model ID for unsupported models", () => {
				const result = InferenceProfileResolver.resolveModelId(
					"anthropic.claude-3-7-sonnet-20250219-v1:0",
					"us-east-1",
					"global",
					false,
				)

				result.modelId.should.equal("anthropic.claude-3-7-sonnet-20250219-v1:0")
				should.not.exist(result.appliedRule)
			})
		})

		describe("custom models", () => {
			it("should return base model ID for custom models regardless of mode", () => {
				const customModelId = "arn:aws:bedrock:us-west-2:123456789012:custom-model/my-model"

				const onDemandResult = InferenceProfileResolver.resolveModelId(customModelId, "us-east-1", "none", true)

				const crossRegionResult = InferenceProfileResolver.resolveModelId(customModelId, "us-east-1", "regional", true)

				const globalResult = InferenceProfileResolver.resolveModelId(customModelId, "us-east-1", "global", true)

				onDemandResult.modelId.should.equal(customModelId)
				crossRegionResult.modelId.should.equal(customModelId)
				globalResult.modelId.should.equal(customModelId)

				onDemandResult.supportsGlobalProfile.should.be.false()
				crossRegionResult.supportsGlobalProfile.should.be.false()
				globalResult.supportsGlobalProfile.should.be.false()
			})
		})
	})

	describe("getInferenceProfileMode", () => {
		it("should return new field when provided", () => {
			const mode = InferenceProfileResolver.getInferenceProfileMode("global", undefined)
			mode.should.equal("global")
		})

		it("should return regional for legacy true value", () => {
			const mode = InferenceProfileResolver.getInferenceProfileMode(undefined, true)
			mode.should.equal("regional")
		})

		it("should return none for legacy false value", () => {
			const mode = InferenceProfileResolver.getInferenceProfileMode(undefined, false)
			mode.should.equal("none")
		})

		it("should return none when both fields are undefined", () => {
			const mode = InferenceProfileResolver.getInferenceProfileMode(undefined, undefined)
			mode.should.equal("none")
		})

		it("should prioritize new field over legacy field", () => {
			const mode = InferenceProfileResolver.getInferenceProfileMode("global", true)
			mode.should.equal("global")
		})
	})

	describe("getAvailableModesForModel", () => {
		it("should return all modes for Sonnet 4 models", () => {
			const modes = InferenceProfileResolver.getAvailableModesForModel("anthropic.claude-sonnet-4-20250514-v1:0")

			modes.should.have.length(3)
			modes.should.containEql("none")
			modes.should.containEql("regional")
			modes.should.containEql("global")
		})

		it("should return all modes for Sonnet 4.5 models", () => {
			const modes = InferenceProfileResolver.getAvailableModesForModel("anthropic.claude-sonnet-4-5-20250929-v1:0")

			modes.should.have.length(3)
			modes.should.containEql("none")
			modes.should.containEql("regional")
			modes.should.containEql("global")
		})

		it("should return only none and regional for other models", () => {
			const modes = InferenceProfileResolver.getAvailableModesForModel("anthropic.claude-3-7-sonnet-20250219-v1:0")

			modes.should.have.length(2)
			modes.should.containEql("none")
			modes.should.containEql("regional")
			modes.should.not.containEql("global")
		})
	})

	describe("getModeDescription", () => {
		it("should return correct descriptions for all modes", () => {
			InferenceProfileResolver.getModeDescription("none").should.equal("Use the model directly in the selected region")
			InferenceProfileResolver.getModeDescription("regional").should.equal(
				"Route requests across regions (us., eu., apac., jp. prefixes)",
			)
			InferenceProfileResolver.getModeDescription("global").should.equal(
				"Automatic regional routing and failover (Sonnet 4/4.5 only)",
			)
		})

		it("should handle invalid mode gracefully", () => {
			InferenceProfileResolver.getModeDescription("invalid").should.equal("Unknown inference profile mode")
		})
	})

	describe("rule priority and matching", () => {
		it("should prioritize JP rules over APAC rules for Sonnet 4.5 in JP regions", () => {
			const result = InferenceProfileResolver.resolveModelId(
				"anthropic.claude-sonnet-4-5-20250929-v1:0",
				"ap-northeast-1",
				"regional",
				false,
			)

			result.modelId.should.equal("jp.anthropic.claude-sonnet-4-5-20250929-v1:0")
			should.exist(result.appliedRule)
			result.appliedRule!.priority.should.equal(50) // JP rule priority
			result.appliedRule!.description!.should.equal("JP inference profile for Claude Sonnet 4.5 in Japan regions")
		})

		it("should prioritize global rules over regional rules when both could match", () => {
			// This tests the priority system when a model could match multiple rules
			const result = InferenceProfileResolver.resolveModelId(
				"anthropic.claude-sonnet-4-20250514-v1:0",
				"us-east-1",
				"global", // Explicitly requesting global mode
				false,
			)

			result.modelId.should.equal("global.anthropic.claude-sonnet-4-20250514-v1:0")
			should.exist(result.appliedRule)
			result.appliedRule!.priority.should.equal(100) // Global rule priority
		})

		it("should handle 1M context variants correctly", () => {
			const result = InferenceProfileResolver.resolveModelId(
				"anthropic.claude-sonnet-4-5-20250929-v1:0:1m",
				"us-east-1",
				"global",
				false,
			)

			result.modelId.should.equal("global.anthropic.claude-sonnet-4-5-20250929-v1:0:1m")
			result.supportsGlobalProfile.should.be.true()
		})
	})
})
