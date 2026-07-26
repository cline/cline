import { GetInferenceProfileCommand, ListFoundationModelsCommand, ListInferenceProfilesCommand } from "@aws-sdk/client-bedrock"
import { describe, expect, it, vi } from "vitest"
import { BedrockDiscoveryService } from "./bedrock-discovery"

describe("BedrockDiscoveryService", () => {
	it("filters models, joins profiles, deduplicates, and consumes every profile page", async () => {
		const send = vi.fn(async (command: unknown) => {
			if (command instanceof ListFoundationModelsCommand) {
				return {
					modelSummaries: [
						{
							modelId: "text-model",
							modelArn: "arn:aws:bedrock:us-east-1::foundation-model/text-model",
							modelName: "Text Model",
							providerName: "Example",
							inputModalities: ["TEXT"],
							outputModalities: ["TEXT"],
							responseStreamingSupported: true,
							inferenceTypesSupported: ["ON_DEMAND"],
							modelLifecycle: { status: "ACTIVE" },
						},
						{
							modelId: "image-model",
							modelArn: "arn:aws:bedrock:us-east-1::foundation-model/image-model",
							inputModalities: ["TEXT"],
							outputModalities: ["IMAGE"],
							responseStreamingSupported: true,
							inferenceTypesSupported: ["ON_DEMAND"],
							modelLifecycle: { status: "ACTIVE" },
						},
						{
							modelId: "embedding-model",
							inputModalities: ["TEXT"],
							outputModalities: ["EMBEDDING"],
							responseStreamingSupported: false,
							inferenceTypesSupported: ["ON_DEMAND"],
							modelLifecycle: { status: "ACTIVE" },
						},
						{
							modelId: "legacy-model",
							inputModalities: ["TEXT"],
							outputModalities: ["TEXT"],
							responseStreamingSupported: true,
							inferenceTypesSupported: ["ON_DEMAND"],
							modelLifecycle: { status: "LEGACY" },
						},
					],
				}
			}
			if (command instanceof ListInferenceProfilesCommand) {
				if (!command.input.nextToken) {
					return {
						inferenceProfileSummaries: [
							{
								inferenceProfileId: "us.text-model",
								inferenceProfileArn: "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.text-model",
								inferenceProfileName: "US Text Model",
								status: "ACTIVE",
								type: "SYSTEM_DEFINED",
								models: [{ modelArn: "arn:aws:bedrock:us-east-1::foundation-model/text-model" }],
							},
							{
								inferenceProfileId: "us.image-model",
								inferenceProfileArn: "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.image-model",
								inferenceProfileName: "US Stable Image",
								status: "ACTIVE",
								type: "SYSTEM_DEFINED",
								models: [{ modelArn: "arn:aws:bedrock:us-east-1::foundation-model/image-model" }],
							},
						],
						nextToken: "page-2",
					}
				}
				return {
					inferenceProfileSummaries: [
						{
							inferenceProfileId: "application-text",
							inferenceProfileArn:
								"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/application-text",
							inferenceProfileName: "Application Text",
							status: "ACTIVE",
							type: "APPLICATION",
							models: [
								{
									modelArn: "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.text-model",
								},
							],
						},
						{
							inferenceProfileId: "application-direct",
							inferenceProfileArn:
								"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/application-direct",
							inferenceProfileName: "Application Direct",
							status: "ACTIVE",
							type: "APPLICATION",
							models: [],
						},
						{
							inferenceProfileId: "us.text-model",
							inferenceProfileArn: "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.text-model",
							inferenceProfileName: "US Text Model",
							status: "ACTIVE",
							type: "SYSTEM_DEFINED",
							models: [{ modelArn: "arn:aws:bedrock:us-east-1::foundation-model/text-model" }],
						},
					],
				}
			}
			if (command instanceof GetInferenceProfileCommand) {
				return {
					inferenceProfileId: "application-direct",
					inferenceProfileArn:
						"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/application-direct",
					inferenceProfileName: "Application Direct",
					status: "ACTIVE",
					type: "APPLICATION",
					models: [{ modelArn: "arn:aws:bedrock:us-east-1::foundation-model/text-model" }],
				}
			}
			throw new Error("Unexpected command")
		})

		const result = await new BedrockDiscoveryService({ send }).discover(new AbortController().signal)

		expect(result.inferenceProfilePages).toBe(2)
		expect(result.targets.map((target) => target.displayName)).toEqual([
			"Text Model",
			"Application Direct",
			"Application Text",
			"US Text Model",
		])
		expect(result.targets.some((target) => target.displayName.includes("Image"))).toBe(false)
		expect(result.targets.find((target) => target.displayName === "US Text Model")?.invocationId).toBe("us.text-model")
		expect(result.targets.find((target) => target.displayName === "Application Text")?.invocationId).toBe(
			"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/application-text",
		)
		expect(send).toHaveBeenCalledTimes(4)
	})
})
