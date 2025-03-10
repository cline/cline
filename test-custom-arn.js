// Test script to verify AWS Bedrock functionality with custom ARNs
// This file should be deleted after testing

// IMPORTANT: Before running this script, make sure you have:
// 1. Configured an AWS profile in your AWS credentials file (~/.aws/credentials)
// 2. For prompt routing, created a prompt router in AWS Bedrock (https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-routing.html)
// 3. For prompt routing, have the prompt router ARN in the format: arn:aws:bedrock:region:account-id:default-prompt-router/router-name

const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime")
const { fromIni } = require("@aws-sdk/credential-providers")

// The model ID or ARN provided by the user (not stored in source code)
const modelIdOrArn = process.env.CUSTOM_ARN
// The AWS profile to use for authentication
const awsProfile = process.env.AWS_PROFILE || "default"

if (!modelIdOrArn) {
	console.error("Please provide a model ID or ARN via the CUSTOM_ARN environment variable")
	process.exit(1)
}

console.log(`Using AWS profile: ${awsProfile}`)

// Check if the input is an ARN or a model ID
const arnRegex =
	/^arn:aws:bedrock:([^:]+):(\d+):(foundation-model|provisioned-model|default-prompt-router|prompt-router)\/(.+)$/
const match = modelIdOrArn.match(arnRegex)
const isArn = !!match

// If it's not an ARN, assume it's a model ID
if (!isArn) {
	console.log(`Using model ID: ${modelIdOrArn}`)
}

// Use us-west-2 region by default
const defaultRegion = "us-west-2"
// Always use the default region, ignoring the region in the ARN
const region = defaultRegion

if (isArn) {
	console.log(`Using region: ${region} with AWS profile "${awsProfile}" (overriding ARN region: ${match[1]})`)
} else {
	console.log(`Using region: ${region} with AWS profile "${awsProfile}"`)
}

// Create a client with the specified AWS profile
let client
try {
	client = new BedrockRuntimeClient({
		region: region,
		credentials: fromIni({
			profile: awsProfile,
		}),
	})
	console.log("Successfully created Bedrock client")
} catch (error) {
	console.error("Error creating Bedrock client:", error)
	process.exit(1)
}

// Use the input as the model ID
if (isArn) {
	console.log(`Using custom ARN as model ID: ${modelIdOrArn}`)
} else {
	console.log(`Using standard model ID: ${modelIdOrArn}`)
}

const payload = {
	modelId: modelIdOrArn,
	messages: [
		{
			role: "user",
			content: [
				{
					text: isArn
						? "Hello, can you verify that this prompt router ARN is working correctly? This is a test of AWS Bedrock Intelligent Prompt Routing."
						: `Hello, can you verify that this model ID is working correctly with the specified AWS profile?`,
				},
			],
		},
	],
	inferenceConfig: {
		// For Claude models, use appropriate token limits based on model type
		// Claude 3.7 Sonnet: 8192, Claude 3.5 Sonnet: 8192, Claude 3 Opus: 4096, Claude 3 Haiku: 4096
		maxTokens: 4096, // Conservative default that works for all Claude models
		temperature: 0.3,
		topP: 0.1,
	},
}

console.log(
	isArn
		? "Sending request to Bedrock API using prompt router ARN..."
		: "Sending request to Bedrock API using standard model ID...",
)

async function testCustomArn() {
	try {
		const command = new ConverseCommand(payload)
		const response = await client.send(command)

		// Handle the response format where output is an object
		if (response.output && typeof response.output === "object") {
			if (response.output.message && response.output.message.content) {
				console.log("Success! Received response:")
				console.log(JSON.stringify(response))
				console.log(response.output.message.content)
				return
			}
		}
		// Handle the response format where output is a Uint8Array
		else if (response.output && response.output instanceof Uint8Array) {
			try {
				const outputStr = new TextDecoder().decode(response.output)
				const output = JSON.parse(outputStr)
				if (output.content) {
					console.log("Success! Received response:")
					console.log(output.content)
					return
				}
			} catch (parseError) {
				console.error("Failed to parse Bedrock response:", parseError)
			}
		}
		console.error("No valid response content received")
	} catch (error) {
		console.error(isArn ? "Error occurred with custom ARN:" : "Error occurred with model ID:", error)

		if (error.message) {
			const errorMessage = error.message.toLowerCase()

			// Access denied errors
			if (
				errorMessage.includes("access") &&
				(errorMessage.includes("model") || errorMessage.includes("denied"))
			) {
				if (isArn) {
					console.error("\nThis appears to be a permissions issue with the prompt router ARN. Please verify:")
					console.error("1. The ARN is correct and points to a valid prompt router")
					console.error(
						`2. Your AWS credentials (${awsProfile} profile) have permission to access this prompt router`,
					)
					console.error("3. The region in the ARN matches the region where the prompt router is deployed")
					console.error("4. The prompt router is properly configured and active")
				} else {
					console.error("\nThis appears to be a permissions issue with the model. Please verify:")
					console.error(
						`1. Your AWS credentials (${awsProfile} profile) have permission to access this model`,
					)
					console.error("2. The model exists in the specified region")
					console.error("3. The model is available for use with your account")
				}
			}
			// Model not found errors
			else if (errorMessage.includes("not found") || errorMessage.includes("does not exist")) {
				if (isArn) {
					console.error("\nThis appears to be an invalid prompt router ARN. Please check:")
					console.error(
						"1. The ARN format is correct (arn:aws:bedrock:region:account-id:default-prompt-router/router-name)",
					)
					console.error("2. The prompt router exists in the specified region")
					console.error("3. The account ID in the ARN is correct")
				} else {
					console.error("\nThis appears to be an invalid model ID. Please check:")
					console.error("1. The model ID is correct")
					console.error("2. The model exists in the specified region")
				}
			}
			// Validation errors
			else if (errorMessage.includes("validation")) {
				if (isArn) {
					console.error("\nThis appears to be a validation error with the prompt router ARN. Please check:")
					console.error("1. The ARN format is correct")
					console.error("2. The prompt router is properly configured")
					console.error("3. The request payload is valid for prompt routing")
				} else {
					console.error("\nThis appears to be a validation error with the model ID. Please check:")
					console.error("1. The model ID format is correct")
					console.error("2. The request payload is valid for this model")
				}
			}
			// Throttling errors
			else if (
				errorMessage.includes("throttl") ||
				errorMessage.includes("rate") ||
				errorMessage.includes("limit")
			) {
				console.error("\nThis appears to be a throttling or rate limit issue. Please try:")
				console.error("1. Reducing the frequency of requests")
				console.error("2. Contact AWS support to request a quota increase if needed")
			}
		}
	}
}

testCustomArn()
