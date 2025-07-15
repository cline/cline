const https = require("https")

// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const MARTIAN_API_KEY = process.env.MARTIAN_API_KEY

if (!OPENAI_API_KEY || !MARTIAN_API_KEY) {
	console.error("Please set both OPENAI_API_KEY and MARTIAN_API_KEY environment variables")
	process.exit(1)
}

// Simple test message that Cline might send
const testRequest = {
	model: "gpt-4o-mini",
	messages: [
		{
			role: "system",
			content: "You are Cline, a highly skilled software engineer...",
		},
		{
			role: "user",
			content: "Write a simple hello world function in Python",
		},
	],
	temperature: 0,
	max_tokens: 150,
	stream: true, // Cline uses streaming
}

// Make streaming request and collect all data
async function testStreamingAPI(apiUrl, apiKey, requestData) {
	return new Promise((resolve, reject) => {
		const url = new URL(apiUrl)
		const chunks = []
		let fullResponse = ""

		const options = {
			hostname: url.hostname,
			port: 443,
			path: url.pathname,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				Accept: "text/event-stream",
			},
		}

		const req = https.request(options, (res) => {
			console.log(`Status Code: ${res.statusCode}`)
			console.log(`Headers:`, res.headers)

			res.on("data", (chunk) => {
				const chunkStr = chunk.toString()
				fullResponse += chunkStr

				// Parse SSE chunks
				const lines = chunkStr.split("\n")
				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6)
						if (data !== "[DONE]" && data.trim()) {
							try {
								const parsed = JSON.parse(data)
								chunks.push(parsed)
							} catch (e) {
								console.log("Failed to parse chunk:", data)
							}
						}
					}
				}
			})

			res.on("end", () => {
				resolve({ chunks, fullResponse, statusCode: res.statusCode })
			})
		})

		req.on("error", reject)
		req.write(JSON.stringify(requestData))
		req.end()
	})
}

// Extract key features from response
function analyzeResponse(apiName, response) {
	console.log(`\n${"=".repeat(50)}`)
	console.log(`${apiName} Analysis:`)
	console.log(`${"=".repeat(50)}`)

	console.log(`Total chunks received: ${response.chunks.length}`)

	if (response.chunks.length > 0) {
		// Check first chunk structure
		console.log("\nFirst chunk structure:")
		console.log(JSON.stringify(response.chunks[0], null, 2))

		// Check if usage data is in any chunk
		const chunksWithUsage = response.chunks.filter((chunk) => chunk.usage)
		console.log(`\nChunks with usage data: ${chunksWithUsage.length}`)

		if (chunksWithUsage.length > 0) {
			console.log("Usage data found:")
			chunksWithUsage.forEach((chunk, i) => {
				console.log(`Chunk ${i}:`, chunk.usage)
			})
		}

		// Check last chunk (often contains final usage)
		const lastChunk = response.chunks[response.chunks.length - 1]
		console.log("\nLast chunk:")
		console.log(JSON.stringify(lastChunk, null, 2))

		// Collect all content
		let fullContent = ""
		response.chunks.forEach((chunk) => {
			if (chunk.choices?.[0]?.delta?.content) {
				fullContent += chunk.choices[0].delta.content
			}
		})

		console.log("\nFull generated content:")
		console.log(fullContent)

		// Check for specific fields Cline needs
		console.log("\nCline-specific requirements:")
		console.log("- Streaming: ✓")
		console.log(`- Content chunks: ${fullContent ? "✓" : "✗"}`)
		console.log(`- Token usage: ${chunksWithUsage.length > 0 ? "✓" : "✗"}`)
		console.log(`- Model in response: ${response.chunks[0]?.model ? "✓" : "✗"}`)
	}
}

// Run comparison
async function compareAPIs() {
	console.log("Testing OpenAI vs Martian API for Cline requirements...\n")

	try {
		// Test OpenAI
		console.log("Testing OpenAI API...")
		const openaiResult = await testStreamingAPI("https://api.openai.com/v1/chat/completions", OPENAI_API_KEY, testRequest)

		// Test Martian
		console.log("\nTesting Martian API...")
		const martianResult = await testStreamingAPI(
			"https://withmartian.com/api/openai/v1/chat/completions",
			MARTIAN_API_KEY,
			testRequest,
		)

		// Analyze both
		analyzeResponse("OpenAI", openaiResult)
		analyzeResponse("Martian", martianResult)

		// Direct comparison
		console.log(`\n${"=".repeat(50)}`)
		console.log("Direct Comparison:")
		console.log(`${"=".repeat(50)}`)

		const openaiHasUsage = openaiResult.chunks.some((c) => c.usage)
		const martianHasUsage = martianResult.chunks.some((c) => c.usage)

		console.log(`\nToken usage in stream:`)
		console.log(`- OpenAI: ${openaiHasUsage ? "YES" : "NO"}`)
		console.log(`- Martian: ${martianHasUsage ? "YES" : "NO"}`)

		if (!martianHasUsage && openaiHasUsage) {
			console.log("\n⚠️  WARNING: Martian API does not return token usage in streaming responses!")
			console.log("This is why token counts are not showing in Cline when using Martian.")
		}
	} catch (error) {
		console.error("Error:", error)
	}
}

// Also test non-streaming to see if usage is returned there
async function testNonStreaming() {
	console.log(`\n${"=".repeat(50)}`)
	console.log("Testing non-streaming responses:")
	console.log(`${"=".repeat(50)}`)

	const nonStreamRequest = { ...testRequest, stream: false }

	try {
		// Make non-streaming requests
		const makeNonStreamRequest = async (apiUrl, apiKey) => {
			return new Promise((resolve, reject) => {
				const url = new URL(apiUrl)
				const options = {
					hostname: url.hostname,
					port: 443,
					path: url.pathname,
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
				}

				const req = https.request(options, (res) => {
					let data = ""
					res.on("data", (chunk) => (data += chunk))
					res.on("end", () => {
						try {
							resolve(JSON.parse(data))
						} catch (e) {
							reject(e)
						}
					})
				})

				req.on("error", reject)
				req.write(JSON.stringify(nonStreamRequest))
				req.end()
			})
		}

		const openaiNonStream = await makeNonStreamRequest("https://api.openai.com/v1/chat/completions", OPENAI_API_KEY)

		const martianNonStream = await makeNonStreamRequest(
			"https://withmartian.com/api/openai/v1/chat/completions",
			MARTIAN_API_KEY,
		)

		console.log("\nOpenAI non-streaming usage:", openaiNonStream.usage || "No usage data")
		console.log("Martian non-streaming usage:", martianNonStream.usage || "No usage data")
	} catch (error) {
		console.error("Non-streaming test error:", error.message)
	}
}

// Run all tests
compareAPIs()
	.then(() => testNonStreaming())
	.then(() => console.log("\nTests completed!"))
	.catch(console.error)
