const https = require("https")
const http = require("http")

// Test configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "your-openai-api-key"
const MARTIAN_API_KEY = process.env.MARTIAN_API_KEY || "your-martian-api-key"

// Test cases
const tests = {
	// 1. Basic completion with token counting
	basicCompletion: {
		model: "gpt-4o-mini",
		messages: [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "What is 2+2?" },
		],
		temperature: 0.7,
		max_tokens: 100,
	},

	// 2. Function calling test
	functionCalling: {
		model: "gpt-4o-mini",
		messages: [{ role: "user", content: "What's the weather like in San Francisco?" }],
		tools: [
			{
				type: "function",
				function: {
					name: "get_weather",
					description: "Get the current weather in a given location",
					parameters: {
						type: "object",
						properties: {
							location: {
								type: "string",
								description: "The city and state, e.g. San Francisco, CA",
							},
							unit: {
								type: "string",
								enum: ["celsius", "fahrenheit"],
							},
						},
						required: ["location"],
					},
				},
			},
		],
		tool_choice: "auto",
	},

	// 3. Structured JSON output
	structuredOutput: {
		model: "gpt-4o-mini",
		messages: [{ role: "user", content: "Extract the name and age from this text: John is 25 years old." }],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "person_info",
				strict: true,
				schema: {
					type: "object",
					properties: {
						name: { type: "string" },
						age: { type: "integer" },
					},
					required: ["name", "age"],
					additionalProperties: false,
				},
			},
		},
	},

	// 4. Streaming test
	streaming: {
		model: "gpt-4o-mini",
		messages: [{ role: "user", content: "Count from 1 to 5 slowly." }],
		stream: true,
		max_tokens: 100,
	},
}

// Helper function to make API request
function makeRequest(apiEndpoint, apiKey, testData, isStreaming = false) {
	return new Promise((resolve, reject) => {
		const url = new URL(apiEndpoint)
		const options = {
			hostname: url.hostname,
			port: url.port || (url.protocol === "https:" ? 443 : 80),
			path: url.pathname,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
		}

		const protocol = url.protocol === "https:" ? https : http
		const req = protocol.request(options, (res) => {
			let data = ""
			const chunks = []
			const startTime = Date.now()

			res.on("data", (chunk) => {
				if (isStreaming) {
					chunks.push({
						time: Date.now() - startTime,
						data: chunk.toString(),
					})
				}
				data += chunk
			})

			res.on("end", () => {
				if (res.statusCode !== 200) {
					reject(new Error(`HTTP ${res.statusCode}: ${data}`))
					return
				}

				if (isStreaming) {
					resolve({
						chunks,
						fullResponse: data,
						headers: res.headers,
					})
				} else {
					try {
						resolve({
							data: JSON.parse(data),
							headers: res.headers,
						})
					} catch (e) {
						reject(new Error(`Failed to parse response: ${data}`))
					}
				}
			})
		})

		req.on("error", reject)
		req.write(JSON.stringify(testData))
		req.end()
	})
}

// Compare responses
async function compareAPIs(testName, testData) {
	console.log(`\n${"=".repeat(60)}`)
	console.log(`Testing: ${testName}`)
	console.log(`${"=".repeat(60)}`)

	const isStreaming = testData.stream === true

	try {
		// Test OpenAI API
		console.log("\n--- OpenAI API ---")
		const openaiStart = Date.now()
		const openaiResponse = await makeRequest(
			"https://api.openai.com/v1/chat/completions",
			OPENAI_API_KEY,
			testData,
			isStreaming,
		)
		const openaiTime = Date.now() - openaiStart

		// Test Martian API
		console.log("\n--- Martian API ---")
		const martianStart = Date.now()
		const martianResponse = await makeRequest(
			"https://withmartian.com/api/openai/v1/chat/completions",
			MARTIAN_API_KEY,
			testData,
			isStreaming,
		)
		const martianTime = Date.now() - martianStart

		// Compare results
		console.log("\n--- Comparison ---")
		console.log(`Response time - OpenAI: ${openaiTime}ms, Martian: ${martianTime}ms`)

		if (isStreaming) {
			console.log("\nStreaming support:")
			console.log(`OpenAI chunks: ${openaiResponse.chunks.length}`)
			console.log(`Martian chunks: ${martianResponse.chunks.length}`)

			// Parse SSE data
			const parseSSE = (data) => {
				const lines = data.split("\n")
				const events = []
				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const content = line.slice(6)
						if (content !== "[DONE]") {
							try {
								events.push(JSON.parse(content))
							} catch (e) {
								// Ignore parse errors
							}
						}
					}
				}
				return events
			}

			const openaiEvents = parseSSE(openaiResponse.fullResponse)
			const martianEvents = parseSSE(martianResponse.fullResponse)

			console.log(`OpenAI events: ${openaiEvents.length}`)
			console.log(`Martian events: ${martianEvents.length}`)

			// Check for usage in final event
			if (openaiEvents.length > 0) {
				const lastEvent = openaiEvents[openaiEvents.length - 1]
				console.log("\nOpenAI final event usage:", lastEvent.usage || "No usage data")
			}
			if (martianEvents.length > 0) {
				const lastEvent = martianEvents[martianEvents.length - 1]
				console.log("Martian final event usage:", lastEvent.usage || "No usage data")
			}
		} else {
			// Non-streaming response
			const openai = openaiResponse.data
			const martian = martianResponse.data

			console.log("\nToken Usage:")
			console.log("OpenAI:", openai.usage || "No usage data")
			console.log("Martian:", martian.usage || "No usage data")

			if (testName === "functionCalling") {
				console.log("\nFunction Calling:")
				console.log("OpenAI tool calls:", openai.choices?.[0]?.message?.tool_calls || "None")
				console.log("Martian tool calls:", martian.choices?.[0]?.message?.tool_calls || "None")
			}

			if (testName === "structuredOutput") {
				console.log("\nStructured Output:")
				console.log("OpenAI content:", openai.choices?.[0]?.message?.content)
				console.log("Martian content:", martian.choices?.[0]?.message?.content)

				// Try to parse JSON
				try {
					const openaiJson = JSON.parse(openai.choices?.[0]?.message?.content || "{}")
					const martianJson = JSON.parse(martian.choices?.[0]?.message?.content || "{}")
					console.log("OpenAI parsed:", openaiJson)
					console.log("Martian parsed:", martianJson)
				} catch (e) {
					console.log("Failed to parse JSON responses")
				}
			}

			// Model info
			console.log("\nModel Info:")
			console.log("OpenAI model:", openai.model)
			console.log("Martian model:", martian.model)
		}
	} catch (error) {
		console.error(`\nError in ${testName}:`, error.message)
	}
}

// Run all tests
async function runAllTests() {
	console.log("Starting API comparison tests...")
	console.log("Make sure to set OPENAI_API_KEY and MARTIAN_API_KEY environment variables\n")

	for (const [name, data] of Object.entries(tests)) {
		await compareAPIs(name, data)
		// Add delay between tests to avoid rate limiting
		await new Promise((resolve) => setTimeout(resolve, 2000))
	}

	console.log("\n\nAll tests completed!")
}

// Check if API keys are provided
if (!OPENAI_API_KEY || OPENAI_API_KEY === "your-openai-api-key") {
	console.error("Please set OPENAI_API_KEY environment variable")
	process.exit(1)
}

if (!MARTIAN_API_KEY || MARTIAN_API_KEY === "your-martian-api-key") {
	console.error("Please set MARTIAN_API_KEY environment variable")
	process.exit(1)
}

// Run tests
runAllTests().catch(console.error)
