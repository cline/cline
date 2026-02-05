import { AwsBedrockHandler, type AwsBedrockHandlerOptions } from "../src/core/api/providers/bedrock"
import type { ApiStreamChunk } from "../src/core/api/transform/stream"

const REGION = process.env.AWS_REGION || "us-east-1"
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "anthropic.claude-sonnet-4-5-20250929-v1:0"
const USE_CROSS_REGION = process.env.BEDROCK_USE_CROSS_REGION === "true"

function createTestHandler(options: Partial<AwsBedrockHandlerOptions> = {}) {
	return new AwsBedrockHandler({
		apiModelId: MODEL_ID,
		awsRegion: REGION,
		awsAccessKey: process.env.AWS_ACCESS_KEY_ID || "",
		awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY || "",
		awsSessionToken: process.env.AWS_SESSION_TOKEN || "",
		awsUseProfile: !!process.env.AWS_PROFILE,
		awsProfile: process.env.AWS_PROFILE || "",
		awsUseCrossRegionInference: USE_CROSS_REGION,
		awsBedrockUsePromptCache: false,
		thinkingBudgetTokens: 0,
		...options,
	})
}

async function collectStream(stream: AsyncGenerator<ApiStreamChunk>) {
	const chunks: ApiStreamChunk[] = []
	try {
		for await (const chunk of stream) {
			chunks.push(chunk)
		}
		return { chunks }
	} catch (error) {
		return { chunks, error: error as Error }
	}
}

function makeReadFileTool() {
	return {
		name: "read_file",
		description: "Read the contents of a file at the specified path.",
		input_schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "The path of the file to read" },
			},
			required: ["path"],
		},
	}
}

function groupToolCalls(chunks: ApiStreamChunk[]) {
	const calls = new Map<string, { name: string; args: string }>()
	for (const chunk of chunks) {
		if (chunk.type === "tool_calls") {
			const id = chunk.tool_call.function.id || chunk.tool_call.call_id || "unknown"
			const existing = calls.get(id) || { name: "", args: "" }
			if (chunk.tool_call.function.name) {
				existing.name = chunk.tool_call.function.name
			}
			existing.args += chunk.tool_call.function.arguments || ""
			calls.set(id, existing)
		}
	}
	return calls
}

type TestResult = { name: string; passed: boolean; detail: string; duration: number }

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(`Assertion failed: ${message}`)
}

async function runTest(name: string, fn: () => Promise<void>): Promise<TestResult> {
	const start = Date.now()
	try {
		await fn()
		const duration = Date.now() - start
		console.log(`  ✅ ${name} (${duration}ms)`)
		return { name, passed: true, detail: "OK", duration }
	} catch (error) {
		const duration = Date.now() - start
		const detail = error instanceof Error ? error.message : String(error)
		console.error(`  ❌ ${name} (${duration}ms): ${detail}`)
		return { name, passed: false, detail, duration }
	}
}

async function runWithRetries(name: string, fn: () => Promise<void>, retries = 2): Promise<TestResult> {
	let lastResult: TestResult | undefined
	for (let attempt = 0; attempt <= retries; attempt++) {
		lastResult = await runTest(`${name}${attempt > 0 ? ` (retry ${attempt})` : ""}`, fn)
		if (lastResult.passed) {
			return { ...lastResult, name }
		}
	}
	return { ...lastResult!, name }
}

function ensureCredentials() {
	if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
		throw new Error("Missing AWS credentials. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or AWS_PROFILE.")
	}
}

async function main() {
	console.log("Bedrock tool calling live test")
	ensureCredentials()

	const results: TestResult[] = []

	results.push(
		await runWithRetries("Test 1: Basic connectivity", async () => {
			const handler = createTestHandler()
			const stream = handler.createMessage("You are a helpful assistant.", [
				{ role: "user", content: [{ type: "text", text: "Say hello in exactly 3 words." }] },
			])
			const { chunks, error } = await collectStream(stream)
			if (error) throw error
			assert(
				chunks.some((chunk) => chunk.type === "text"),
				"Expected text chunks",
			)
			assert(
				chunks.some((chunk) => chunk.type === "usage"),
				"Expected usage chunk",
			)
		}),
	)

	results.push(
		await runWithRetries("Test 2: Single tool call", async () => {
			const handler = createTestHandler()
			const tools = [makeReadFileTool()]
			const stream = handler.createMessage(
				"You are a helpful assistant. You MUST use the read_file tool to answer questions about files. Do not respond with text — only use tools.",
				[{ role: "user", content: [{ type: "text", text: "What is in the file /tmp/test.txt?" }] }],
				tools,
			)
			const { chunks, error } = await collectStream(stream)
			if (error) throw error
			assert(
				chunks.some((chunk) => chunk.type === "tool_calls"),
				"Expected tool call chunks",
			)
			const calls = groupToolCalls(chunks)
			const firstCall = Array.from(calls.values())[0]
			assert(firstCall?.name === "read_file", "Expected read_file tool call")
			assert(firstCall?.args.includes("/tmp/test.txt"), "Expected path argument")
		}),
	)

	results.push(
		await runWithRetries("Test 3: Parallel tool calls", async () => {
			const handler = createTestHandler()
			const tools = [makeReadFileTool()]
			const stream = handler.createMessage(
				"You are a helpful assistant. You MUST use the read_file tool to answer questions about files. Do not respond with text — only use tools.",
				[
					{
						role: "user",
						content: [{ type: "text", text: "Read these three files: /tmp/a.txt, /tmp/b.txt, /tmp/c.txt" }],
					},
				],
				tools,
			)
			const { chunks, error } = await collectStream(stream)
			if (error) throw error
			assert(
				chunks.some((chunk) => chunk.type === "tool_calls"),
				"Expected tool call chunks",
			)
			const calls = groupToolCalls(chunks)
			if (calls.size < 2) {
				console.warn("  ⚠️  Expected >= 2 tool calls, got", calls.size)
			}
		}),
	)

	results.push(
		await runWithRetries("Test 4: Tool result round-trip", async () => {
			const handler = createTestHandler()
			const tools = [makeReadFileTool()]
			const firstStream = handler.createMessage(
				"You are a helpful assistant. You MUST use the read_file tool to answer questions about files. Do not respond with text — only use tools.",
				[{ role: "user", content: [{ type: "text", text: "What is in the file /tmp/test.txt?" }] }],
				tools,
			)
			const { chunks: firstChunks, error: firstError } = await collectStream(firstStream)
			if (firstError) throw firstError
			const calls = groupToolCalls(firstChunks)
			const [firstCallId] = calls.keys()
			assert(!!firstCallId, "Expected tool call id")

			const messages = [
				{ role: "user", content: [{ type: "text", text: "What is in the file /tmp/test.txt?" }] },
				{
					role: "assistant",
					content: [{ type: "tool_use", id: firstCallId, name: "read_file", input: { path: "/tmp/test.txt" } }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: firstCallId, content: "Hello, this is the file content." }],
				},
			]

			const secondStream = handler.createMessage("You are a helpful assistant.", messages, tools)
			const { chunks: secondChunks, error: secondError } = await collectStream(secondStream)
			if (secondError) throw secondError
			assert(
				secondChunks.some((chunk) => chunk.type === "text" || chunk.type === "tool_calls"),
				"Expected follow-up response",
			)
		}),
	)

	results.push(
		await runWithRetries("Test 5: Text + tool interleaving", async () => {
			const handler = createTestHandler()
			const tools = [makeReadFileTool()]
			const stream = handler.createMessage(
				"You are a helpful assistant. When asked about files, first briefly explain what you're going to do, then use the read_file tool.",
				[{ role: "user", content: [{ type: "text", text: "Can you check what's in /tmp/test.txt?" }] }],
				tools,
			)
			const { chunks, error } = await collectStream(stream)
			if (error) throw error
			const hasText = chunks.some((chunk) => chunk.type === "text")
			const hasTool = chunks.some((chunk) => chunk.type === "tool_calls")
			if (!hasText || !hasTool) {
				console.warn("  ⚠️  Expected text + tool_calls, got", { hasText, hasTool })
			}
		}),
	)

	results.push(
		await runWithRetries("Test 6: Thinking + tool calling", async () => {
			const handler = createTestHandler({ thinkingBudgetTokens: 2048 })
			const tools = [makeReadFileTool()]
			const stream = handler.createMessage(
				"You are a helpful assistant. You MUST use the read_file tool to answer questions about files. Do not respond with text — only use tools.",
				[{ role: "user", content: [{ type: "text", text: "What is in the file /tmp/test.txt?" }] }],
				tools,
			)
			const { chunks, error } = await collectStream(stream)
			if (error) throw error
			assert(
				chunks.some((chunk) => chunk.type === "reasoning"),
				"Expected reasoning chunks",
			)
			assert(
				chunks.some((chunk) => chunk.type === "tool_calls"),
				"Expected tool call chunks",
			)
		}),
	)

	const failed = results.filter((result) => !result.passed)
	console.log("\nSummary")
	results.forEach((result) => {
		console.log(`${result.passed ? "✅" : "❌"} ${result.name}: ${result.detail}`)
	})

	if (failed.length > 0) {
		process.exit(1)
	}

	process.exit(0)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
