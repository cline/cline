import { describe, it } from "mocha"
import "should"
import { AwsBedrockHandler } from "./bedrock"
import { ApiHandlerOptions, bedrockDefaultModelId } from "../../shared/api"

describe("AwsBedrockHandler", () => {
	describe("getModel", () => {
		it("should return correct model and model info", () => {
			const options: ApiHandlerOptions = {
				apiModelId: bedrockDefaultModelId,
			}

			const handler = new AwsBedrockHandler(options)
			const model = handler.getModel()
			model.id.should.equal(bedrockDefaultModelId)
			model.info.should.not.be.undefined()
		})

		it("should use provided model ID when valid", () => {
			const options: ApiHandlerOptions = {
				apiModelId: bedrockDefaultModelId,
			}

			const handler = new AwsBedrockHandler(options)
			const model = handler.getModel()
			model.id.should.equal(bedrockDefaultModelId)
		})

		it("should fall back to default model ID when invalid", () => {
			const options: ApiHandlerOptions = {
				apiModelId: "invalid-model" as any,
			}

			const handler = new AwsBedrockHandler(options)
			const model = handler.getModel()
			model.id.should.equal(bedrockDefaultModelId)
		})
	})

	describe("getModelId", () => {
		it("should add APAC prefix for APAC region with cross-region inference", async () => {
			const options: ApiHandlerOptions = {
				awsRegion: "ap-northeast-1",
				awsUseCrossRegionInference: true,
				apiModelId: bedrockDefaultModelId,
			}

			const handler = new AwsBedrockHandler(options)
			const modelId = await handler.getModelId()
			modelId.should.equal(`apac.${bedrockDefaultModelId}`)
		})

		it("should add US prefix for US region with cross-region inference", async () => {
			const options: ApiHandlerOptions = {
				awsRegion: "us-east-1",
				awsUseCrossRegionInference: true,
				apiModelId: bedrockDefaultModelId,
			}

			const handler = new AwsBedrockHandler(options)
			const modelId = await handler.getModelId()
			modelId.should.equal(`us.${bedrockDefaultModelId}`)
		})

		it("should add EU prefix for EU region with cross-region inference", async () => {
			const options: ApiHandlerOptions = {
				awsRegion: "eu-west-1",
				awsUseCrossRegionInference: true,
				apiModelId: bedrockDefaultModelId,
			}

			const handler = new AwsBedrockHandler(options)
			const modelId = await handler.getModelId()
			modelId.should.equal(`eu.${bedrockDefaultModelId}`)
		})

		it("should not add prefix when cross-region inference is disabled", async () => {
			const options: ApiHandlerOptions = {
				awsRegion: "ap-northeast-1",
				awsUseCrossRegionInference: false,
				apiModelId: bedrockDefaultModelId,
			}

			const handler = new AwsBedrockHandler(options)
			const modelId = await handler.getModelId()
			modelId.should.equal(bedrockDefaultModelId)
		})

		it("should not add prefix for unsupported regions with cross-region inference", async () => {
			const options: ApiHandlerOptions = {
				awsRegion: "sa-east-1",
				awsUseCrossRegionInference: true,
				apiModelId: bedrockDefaultModelId,
			}

			const handler = new AwsBedrockHandler(options)
			const modelId = await handler.getModelId()
			modelId.should.equal(bedrockDefaultModelId)
		})

		it("should not add prefix when region is undefined and cross-region inference is disabled", async () => {
			const options: ApiHandlerOptions = {
				awsUseCrossRegionInference: false,
				apiModelId: bedrockDefaultModelId,
			}

			const handler = new AwsBedrockHandler(options)
			const modelId = await handler.getModelId()
			modelId.should.equal(bedrockDefaultModelId)
		})
	})
})
