import { describe, it } from "mocha"
import "should"
import { OpenAiHandler } from "./openai"
import { ApiHandlerOptions, azureOpenAiDefaultApiVersion } from "../../shared/api"

describe("OpenAI Provider", () => {
	describe("Client Initialization", () => {
		it("should initialize standard OpenAI client when no Azure URL is provided", () => {
			const openAiBaseUrl = "https://api.openai.com/v1"
			const options: ApiHandlerOptions = {
				openAiBaseUrl,
				openAiApiKey: "test-key",
				openAiModelId: "gpt-4o",
			}
			const handler = new OpenAiHandler(options)
			// @ts-ignore - accessing private property for testing
			handler.client.should.have.property("baseURL", openAiBaseUrl)
			// @ts-ignore - accessing private property for testing
			handler.client.should.not.have.property("apiVersion")
		})

		it("should initialize Azure OpenAI client when Azure OpenAI Service URL is provided", () => {
			const openAiBaseUrl = "https://my-resource.openai.azure.com/openai/deployments/my-deployment"
			const options: ApiHandlerOptions = {
				openAiBaseUrl,
				openAiApiKey: "test-key",
				openAiModelId: "gpt-4o",
				isAzureOpenAiService: true,
			}
			const handler = new OpenAiHandler(options)
			// @ts-ignore - accessing private property for testing
			handler.client.should.have.property("baseURL", openAiBaseUrl)
			// @ts-ignore - accessing private property for testing
			handler.client.should.have.property("apiVersion")
		})

		it("should initialize Azure OpenAI client when Azure API Management URL is provided", () => {
			const openAiBaseUrl = "https://my-resource.azure-api.net/openai/deployments/my-deployment"
			const options: ApiHandlerOptions = {
				openAiBaseUrl,
				openAiApiKey: "test-key",
				openAiModelId: "gpt-4o",
				isAzureOpenAiService: true,
			}
			const handler = new OpenAiHandler(options)
			// @ts-ignore - accessing private property for testing
			handler.client.should.have.property("baseURL", openAiBaseUrl)
			// @ts-ignore - accessing private property for testing
			handler.client.should.have.property("apiVersion")
		})

		it("should auto-detect Azure OpenAI service from URL", () => {
			const openAiBaseUrl = "https://my-resource.openai.azure.com"
			const options: ApiHandlerOptions = {
				openAiBaseUrl,
				openAiApiKey: "test-key",
				openAiModelId: "gpt-4o",
			}
			const handler = new OpenAiHandler(options)
			// @ts-ignore - accessing private property for testing
			handler.client.should.have.property("baseURL", openAiBaseUrl)
			// @ts-ignore - accessing private property for testing
			handler.client.should.have.property("apiVersion")
		})

		it("should use custom API version for Azure OpenAI service", () => {
			const azureApiVersion = "2024-10-21"
			const options: ApiHandlerOptions = {
				openAiBaseUrl: "https://my-resource.azure-api.net/openai/deployments/my-deployment",
				openAiApiKey: "test-key",
				openAiModelId: "gpt-4o",
				isAzureOpenAiService: true,
				azureApiVersion,
			}
			const handler = new OpenAiHandler(options)
			// @ts-ignore - accessing private property for testing
			handler.client.should.have.property("apiVersion", azureApiVersion)
		})

		it("should use default API version when not specified for Azure OpenAI service", () => {
			const options: ApiHandlerOptions = {
				openAiBaseUrl: "https://my-resource.azure-api.net/openai/deployments/my-deployment",
				openAiApiKey: "test-key",
				openAiModelId: "gpt-4o",
				isAzureOpenAiService: true,
			}
			const handler = new OpenAiHandler(options)
			// @ts-ignore - accessing private property for testing
			handler.client.should.have.property("apiVersion", azureOpenAiDefaultApiVersion)
		})
	})

	describe("Model Information", () => {
		it("should return model information with provided ID", () => {
			const openAiModelId = "gpt-4o"
			const options: ApiHandlerOptions = {
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiApiKey: "test-key",
				openAiModelId,
			}
			const handler = new OpenAiHandler(options)
			const model = handler.getModel()
			model.should.have.property("id", openAiModelId)
			model.should.have.property("info")
		})

		it("should handle undefined model ID", () => {
			const options: ApiHandlerOptions = {
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiApiKey: "test-key",
			}
			const handler = new OpenAiHandler(options)
			const model = handler.getModel()
			model.should.have.property("id", "")
			model.should.have.property("info")
		})
	})
})
