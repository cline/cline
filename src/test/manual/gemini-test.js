/**
 * Manual Test Script for GeminiHandler
 *
 * ========= IMPORTANT NOTICE =========
 * This manual testing script is DEPRECATED and maintained only for reference.
 *
 * The Gemini integration now has complete automated test coverage in:
 * - src/test/api/providers/gemini.test.ts (handler tests)
 * - src/test/api/transform/gemini-format.test.ts (format conversion tests)
 * - src/test/utils/gemini-mocks.test.ts (mock utilities tests)
 *
 * Please use the automated tests for development and regression testing.
 * Run all tests with: npm run test
 * Run only Gemini tests with: npm run test out/test/api/providers/gemini.test.js
 * ===================================
 *
 * This script provides a simple way to test the GeminiHandler functionality
 * interactively without needing to run the full extension.
 *
 * Usage:
 * 1. Set your Gemini API key in the GEMINI_API_KEY environment variable
 * 2. Run this script with Node.js: node gemini-test.js
 *
 * You can test different scenarios by modifying the code below.
 */

// Import required modules
const { GoogleGenerativeAI } = require("@google/generative-ai")
const fs = require("fs")
const path = require("path")
const readline = require("readline")

// Mock the withRetry decorator for standalone testing
function withRetry() {
	return function (target, context) {
		return async function* (...args) {
			try {
				yield* target.apply(this, args)
			} catch (error) {
				if (error.message?.includes("Rate limit")) {
					console.log("Rate limit detected, retrying...")
					// In a real implementation, we'd wait and retry
					throw error
				}
				throw error
			}
		}
	}
}

// Simple version of the unescapeGeminiContent function
function unescapeGeminiContent(content) {
	if (!content) return ""

	// Special case for UNC paths in tests
	if (content.includes("UNC path:")) {
		return content
	}

	return content.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
}

// Simple version of the message conversion function
function convertAnthropicMessageToGemini(message) {
	let role = message.role === "user" ? "user" : "model"

	if (typeof message.content === "string") {
		return {
			role,
			parts: [{ text: message.content }],
		}
	}

	// Handle array content (images, etc.)
	const parts = message.content.map((item) => {
		if (item.type === "text") {
			return { text: item.text }
		}

		if (item.type === "image" && item.source.type === "base64") {
			return {
				inlineData: {
					data: item.source.data,
					mimeType: item.source.media_type,
				},
			}
		}

		throw new Error(`Unsupported content type: ${item.type}`)
	})

	return { role, parts }
}

/**
 * GeminiHandler implementation for manual testing
 */
class GeminiHandler {
	constructor(options) {
		if (!options.geminiApiKey) {
			throw new Error("API key is required for Google Gemini")
		}
		this.options = options
		this.client = new GoogleGenerativeAI(options.geminiApiKey)
	}

	// Create messages using Gemini API
	async *createMessage(systemPrompt, messages) {
		const modelId = "gemini-1.5-pro-002" // Default model for testing
		const maxTokens = 2048

		// Set up the model with system instruction
		const model = this.client.getGenerativeModel({
			model: modelId,
			systemInstruction: systemPrompt,
		})

		try {
			// Convert messages to Gemini format
			const contents = messages.map(convertAnthropicMessageToGemini)

			// Generate content with streaming
			const result = await model.generateContentStream({
				contents,
				generationConfig: {
					maxOutputTokens: maxTokens,
					temperature: 0.7, // Slightly more creative for testing
				},
			})

			// Process each chunk from the stream
			for await (const chunk of result.stream) {
				try {
					const text = chunk.text()
					if (text) {
						yield {
							type: "text",
							text: unescapeGeminiContent(text),
						}
					}
				} catch (error) {
					console.error("Error processing stream chunk:", error)
					throw error
				}
			}

			// Get final response and check for issues
			const response = await result.response
			if (!response) {
				throw new Error("No response received from Gemini API")
			}

			// Check finish reason
			const finishReason = response.candidates?.[0]?.finishReason
			if (finishReason === "SAFETY") {
				throw new Error("Content generation was blocked for safety reasons")
			}

			// Yield usage information
			yield {
				type: "usage",
				inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
				outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
			}
		} catch (error) {
			console.error("Error in Gemini message generation:", error)
			throw error
		}
	}
}

// Create readline interface for interactive use
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
})

/**
 * Main test function
 */
async function runTest() {
	// Get API key from environment or prompt user
	let apiKey = process.env.GEMINI_API_KEY

	if (!apiKey) {
		await new Promise((resolve) => {
			rl.question("Enter your Gemini API key: ", (answer) => {
				apiKey = answer.trim()
				resolve()
			})
		})
	}

	if (!apiKey) {
		console.error("No API key provided. Exiting.")
		process.exit(1)
	}

	// Create handler instance
	const handler = new GeminiHandler({
		geminiApiKey: apiKey,
	})

	console.log("\n=== Gemini Test Tool ===")
	console.log('Type your messages. Type "image:" followed by a path to include an image.')
	console.log('Type "exit" to quit.')

	// Set system prompt
	const systemPrompt = "You are a helpful, harmless, and honest AI assistant."
	const messages = []

	// Main interaction loop
	while (true) {
		// Get user input
		const input = await new Promise((resolve) => {
			rl.question("\nYou: ", resolve)
		})

		if (input.toLowerCase() === "exit") {
			break
		}

		// Check if user wants to include an image
		if (input.startsWith("image:")) {
			const imagePath = input.slice(6).trim()
			try {
				const imageBuffer = fs.readFileSync(path.resolve(imagePath))
				const base64Data = imageBuffer.toString("base64")

				// Get description for the image
				const description = await new Promise((resolve) => {
					rl.question("Description for the image: ", resolve)
				})

				// Add message with image
				messages.push({
					role: "user",
					content: [
						{ type: "text", text: description },
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/jpeg", // Assuming JPEG for simplicity
								data: base64Data,
							},
						},
					],
				})
			} catch (error) {
				console.error(`Error loading image: ${error.message}`)
				continue
			}
		} else {
			// Add text-only message
			messages.push({
				role: "user",
				content: input,
			})
		}

		console.log("\nAssistant: ")

		// Generate response
		let responseText = ""
		try {
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "text") {
					process.stdout.write(chunk.text)
					responseText += chunk.text
				} else if (chunk.type === "usage") {
					console.log(`\n\n[Token usage - Input: ${chunk.inputTokens}, Output: ${chunk.outputTokens}]`)
				}
			}

			// Add assistant response to message history
			messages.push({
				role: "assistant",
				content: responseText,
			})
		} catch (error) {
			console.error(`\nError: ${error.message}`)
		}
	}

	rl.close()
	console.log("Test session ended.")
}

// Run the test
runTest().catch((err) => {
	console.error("Fatal error:", err)
	process.exit(1)
})
