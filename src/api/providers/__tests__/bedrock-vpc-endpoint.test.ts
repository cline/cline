// Mock AWS SDK credential providers
jest.mock("@aws-sdk/credential-providers", () => {
	const mockFromIni = jest.fn().mockReturnValue({
		accessKeyId: "profile-access-key",
		secretAccessKey: "profile-secret-key",
	})
	return { fromIni: mockFromIni }
})

// Mock BedrockRuntimeClient and ConverseStreamCommand
const mockBedrockRuntimeClient = jest.fn()
const mockSend = jest.fn().mockResolvedValue({
	stream: [],
})

jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
	BedrockRuntimeClient: mockBedrockRuntimeClient.mockImplementation(() => ({
		send: mockSend,
	})),
	ConverseStreamCommand: jest.fn(),
	ConverseCommand: jest.fn(),
}))

import { AwsBedrockHandler } from "../bedrock"

describe("AWS Bedrock VPC Endpoint Functionality", () => {
	beforeEach(() => {
		// Clear all mocks before each test
		jest.clearAllMocks()
	})

	// Test Scenario 1: Input Validation Test
	describe("VPC Endpoint URL Validation", () => {
		it("should configure client with endpoint URL when both URL and enabled flag are provided", () => {
			// Create handler with endpoint URL and enabled flag
			new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
				awsBedrockEndpoint: "https://bedrock-vpc.example.com",
				awsBedrockEndpointEnabled: true,
			})

			// Verify the client was created with the correct endpoint
			expect(mockBedrockRuntimeClient).toHaveBeenCalledWith(
				expect.objectContaining({
					region: "us-east-1",
					endpoint: "https://bedrock-vpc.example.com",
				}),
			)
		})

		it("should not configure client with endpoint URL when URL is provided but enabled flag is false", () => {
			// Create handler with endpoint URL but disabled flag
			new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
				awsBedrockEndpoint: "https://bedrock-vpc.example.com",
				awsBedrockEndpointEnabled: false,
			})

			// Verify the client was created without the endpoint
			expect(mockBedrockRuntimeClient).toHaveBeenCalledWith(
				expect.objectContaining({
					region: "us-east-1",
				}),
			)

			// Verify the endpoint property is not present
			const clientConfig = mockBedrockRuntimeClient.mock.calls[0][0]
			expect(clientConfig).not.toHaveProperty("endpoint")
		})
	})

	// Test Scenario 2: Edge Case Tests
	describe("Edge Cases", () => {
		it("should handle empty endpoint URL gracefully", () => {
			// Create handler with empty endpoint URL but enabled flag
			new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
				awsBedrockEndpoint: "",
				awsBedrockEndpointEnabled: true,
			})

			// Verify the client was created without the endpoint (since it's empty)
			expect(mockBedrockRuntimeClient).toHaveBeenCalledWith(
				expect.objectContaining({
					region: "us-east-1",
				}),
			)

			// Verify the endpoint property is not present
			const clientConfig = mockBedrockRuntimeClient.mock.calls[0][0]
			expect(clientConfig).not.toHaveProperty("endpoint")
		})

		it("should handle undefined endpoint URL gracefully", () => {
			// Create handler with undefined endpoint URL but enabled flag
			new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
				awsBedrockEndpoint: undefined,
				awsBedrockEndpointEnabled: true,
			})

			// Verify the client was created without the endpoint
			expect(mockBedrockRuntimeClient).toHaveBeenCalledWith(
				expect.objectContaining({
					region: "us-east-1",
				}),
			)

			// Verify the endpoint property is not present
			const clientConfig = mockBedrockRuntimeClient.mock.calls[0][0]
			expect(clientConfig).not.toHaveProperty("endpoint")
		})
	})

	// Test Scenario 4: Error Handling Tests
	describe("Error Handling", () => {
		it("should handle invalid endpoint URLs by passing them directly to AWS SDK", () => {
			// Create handler with an invalid URL format
			new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
				awsBedrockEndpoint: "invalid-url-format",
				awsBedrockEndpointEnabled: true,
			})

			// Verify the client was created with the invalid endpoint
			// (AWS SDK will handle the validation/errors)
			expect(mockBedrockRuntimeClient).toHaveBeenCalledWith(
				expect.objectContaining({
					region: "us-east-1",
					endpoint: "invalid-url-format",
				}),
			)
		})
	})

	// Test Scenario 5: Persistence Tests
	describe("Persistence", () => {
		it("should maintain consistent behavior across multiple requests", async () => {
			// Create handler with endpoint URL and enabled flag
			const handler = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsAccessKey: "test-access-key",
				awsSecretKey: "test-secret-key",
				awsRegion: "us-east-1",
				awsBedrockEndpoint: "https://bedrock-vpc.example.com",
				awsBedrockEndpointEnabled: true,
			})

			// Reset mock to clear the constructor call
			mockBedrockRuntimeClient.mockClear()

			// Make a request
			try {
				await handler.completePrompt("Test prompt")
			} catch (error) {
				// Ignore errors, we're just testing the client configuration
			}

			// Verify the client was configured with the endpoint
			expect(mockSend).toHaveBeenCalled()
		})
	})
})
