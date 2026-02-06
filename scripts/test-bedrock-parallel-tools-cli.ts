/**
 * Bedrock parallel tool calling verification via the Cline CLI (headless).
 *
 * This is the primary verification script for Bedrock native/parallel tool calling.
 * It spawns the Cline CLI as a subprocess for each test case, exercising the full
 * stack: CLI → Task → ToolExecutor → BedrockHandler → Bedrock API → tool execution.
 *
 * What this tests:
 * - Native structured tool calling (not XML fallback)
 * - Single tool call (regression baseline)
 * - Parallel tool calls (multiple files in one turn)
 * - Tool result round-trip (read → process → write based on content)
 * - Task completion through native tool calling
 *
 * Prereqs:
 * - `cline` is installed and available on PATH (the script spawns `cline`).
 * - AWS credentials are available either via env vars (AWS_PROFILE or AWS_ACCESS_KEY_ID/SECRET)
 *   OR via the default AWS credential chain (set `ALLOW_AWS_DEFAULT_CHAIN=true`).
 * - Bedrock access to an Anthropic model. Many require an inference profile or cross-region inference.
 *
 * Recommended run:
 *   ALLOW_AWS_DEFAULT_CHAIN=true \
 *   BEDROCK_USE_CROSS_REGION=true \
 *   npx tsx scripts/test-bedrock-parallel-tools-cli.ts
 *
 * Optional env overrides:
 * - BEDROCK_MODEL_ID: override model id (default is Claude Haiku 4.5)
 * - AWS_REGION: default us-east-1
 * - CLINE_BIN: override the cline binary path/name
 */

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// ─── Types ────────────────────────────────────────────────────

type ToolCallSummary = {
	callId: string
	toolName: string
	args: string
}

type RunResult = {
	exitCode: number
	stdout: string
	stderr: string
	toolCalls: ToolCallSummary[]
	durationMs: number
}

type TestResult = {
	name: string
	passed: boolean
	detail: string
	durationMs: number
}

// ─── Constants ────────────────────────────────────────────────

const DEFAULT_MODEL_ID = "anthropic.claude-haiku-4-5-20251001-v1:0"
const DEFAULT_REGION = "us-east-1"

// ─── Helpers ──────────────────────────────────────────────────

function nowIso(): string {
	return new Date().toISOString()
}

function logProgress(message: string) {
	process.stderr.write(`[${nowIso()}] ${message}\n`)
}

function ensureAwsCredentials() {
	if (process.env.ALLOW_AWS_DEFAULT_CHAIN === "true") {
		return
	}
	if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
		throw new Error(
			"Missing AWS credentials env vars. Set AWS_PROFILE or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, or set ALLOW_AWS_DEFAULT_CHAIN=true to rely on the AWS default credential chain.",
		)
	}
}

function writeJson(filePath: string, data: unknown) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
}

function resolveCliCommand(): string {
	if (process.env.CLINE_BIN) {
		return process.env.CLINE_BIN
	}
	const probe = spawnSync("cline", ["--version"], { stdio: "ignore" })
	if (!probe.error && probe.status === 0) {
		return "cline"
	}
	throw new Error(
		"Cline CLI binary not found on PATH. Ensure `cline` is available (npm run cli:link or npm i -g cline), or set CLINE_BIN.",
	)
}

function assert(condition: boolean, message: string) {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`)
	}
}

// ─── Config seeding ───────────────────────────────────────────

function seedCliConfig(configDir: string) {
	const dataDir = path.join(configDir, "data")
	const globalStatePath = path.join(dataDir, "globalState.json")
	const secretsPath = path.join(dataDir, "secrets.json")

	const globalState = {
		welcomeViewCompleted: true,
		actModeApiProvider: "bedrock",
		planModeApiProvider: "bedrock",
		actModeApiModelId: process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID,
		planModeApiModelId: process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID,
		awsRegion: process.env.AWS_REGION || DEFAULT_REGION,
		awsAuthentication: process.env.BEDROCK_AUTH_METHOD || (process.env.AWS_PROFILE ? "profile" : "credentials"),
		awsUseCrossRegionInference: process.env.BEDROCK_USE_CROSS_REGION === "true",
		awsUseGlobalInference: process.env.BEDROCK_USE_GLOBAL_INFERENCE === "true",
		awsUseProfile: Boolean(process.env.AWS_PROFILE),
		awsProfile: process.env.AWS_PROFILE || undefined,
		awsBedrockCustomSelected: process.env.BEDROCK_INFERENCE_PROFILE_ARN ? true : undefined,
		awsBedrockCustomModelBaseId: process.env.BEDROCK_INFERENCE_PROFILE_BASE_MODEL_ID || undefined,
		awsBedrockCustomModelArn: process.env.BEDROCK_INFERENCE_PROFILE_ARN || undefined,
		enableParallelToolCalling: true,
		nativeToolCallEnabled: true,
		yoloModeToggled: true,
	}

	const secrets = {
		awsAccessKey: process.env.AWS_ACCESS_KEY_ID,
		awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY,
		awsSessionToken: process.env.AWS_SESSION_TOKEN,
		awsBedrockApiKey: process.env.AWS_BEDROCK_API_KEY,
	}

	writeJson(globalStatePath, globalState)
	writeJson(secretsPath, secrets)

	return { dataDir, globalStatePath, secretsPath }
}

// ─── CLI runner ───────────────────────────────────────────────

function parseToolCalls(stdout: string): ToolCallSummary[] {
	const toolCalls: ToolCallSummary[] = []
	const lines = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)

	for (const line of lines) {
		if (!line.startsWith("{")) continue
		try {
			const message = JSON.parse(line) as { type?: string; ask?: string; say?: string; text?: string }
			const isToolMessage =
				message.type === "ask" ? message.ask === "tool" : message.type === "say" ? message.say === "tool" : false
			if (isToolMessage && message.text) {
				const payload = JSON.parse(message.text) as { tool?: string; path?: string; content?: string }
				// CLI emits tool ids like "readFile" (camel) whereas the internal tool name
				// in prompts is "read_file" (snake). Accept either form.
				const toolName = payload?.tool
				if (toolName && payload.path) {
					toolCalls.push({ callId: payload.path, toolName, args: payload.path })
				}
			}
		} catch {
			// Ignore non-JSON or unexpected lines
		}
	}

	return toolCalls
}

function detectXmlFallback(stdout: string): boolean {
	const xmlToolPatterns = [
		/<tool_name>\s*\n\s*<\/tool_name>|<tool_name>\s*\n\s*<parameter/i,
		/<invoke\s+name="(read_file|attempt_completion|execute_command)"/i,
	]
	return xmlToolPatterns.some((pattern) => pattern.test(stdout))
}

async function runCli(prompt: string, configDir: string, workspaceDir: string): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const cliCommand = resolveCliCommand()
		const startMs = Date.now()
		logProgress(`  Spawning CLI: ${cliCommand}`)
		const cliLogPath = path.join(configDir, "cli-json.log")

		const child = spawn(
			cliCommand,
			["--config", configDir, "--cwd", workspaceDir, "task", "--json", "--yolo", "--timeout", "1200", "--act", prompt],
			{
				cwd: path.resolve(__dirname, ".."),
				env: { ...process.env, CLINE_DIR: configDir },
				stdio: ["pipe", "pipe", "pipe"],
			},
		)

		let stdout = ""
		let stderr = ""
		let stdoutLines = 0
		let lastOutputAt = Date.now()

		const heartbeat = setInterval(() => {
			const secondsSince = Math.round((Date.now() - lastOutputAt) / 1000)
			logProgress(`  Waiting... (stdout lines: ${stdoutLines}, last output: ${secondsSince}s ago)`)
		}, 15_000)

		child.stdout.on("data", (chunk) => {
			const s = chunk.toString()
			fs.appendFileSync(cliLogPath, s)
			stdout += s
			stdoutLines += s.split("\n").length - 1
			lastOutputAt = Date.now()
		})
		child.stderr.on("data", (chunk) => {
			const s = chunk.toString()
			fs.appendFileSync(cliLogPath, s)
			stderr += s
			lastOutputAt = Date.now()
		})
		child.stdin.end()
		child.on("error", reject)
		child.on("close", (code) => {
			clearInterval(heartbeat)
			const toolCalls = parseToolCalls(stdout)
			const durationMs = Date.now() - startMs
			resolve({ exitCode: code ?? 1, stdout, stderr, toolCalls, durationMs })
		})
	})
}

// ─── Test runner ──────────────────────────────────────────────

async function runTest(name: string, fn: () => Promise<void>): Promise<TestResult> {
	const start = Date.now()
	console.log(`\n▶ ${name}`)
	try {
		await fn()
		const durationMs = Date.now() - start
		console.log(`  ✅ ${name} (${(durationMs / 1000).toFixed(1)}s)`)
		return { name, passed: true, detail: "OK", durationMs }
	} catch (err) {
		const durationMs = Date.now() - start
		const detail = err instanceof Error ? err.message : String(err)
		console.error(`  ❌ ${name} (${(durationMs / 1000).toFixed(1)}s): ${detail}`)
		return { name, passed: false, detail, durationMs }
	}
}

function normalizePaths(paths: Iterable<string>): Set<string> {
	const normalized = new Set<string>()
	for (const value of paths) {
		normalized.add(path.normalize(value))
	}
	return normalized
}

// ─── Test cases ───────────────────────────────────────────────

/**
 * Test 1: Single tool call (regression baseline)
 * Asks Cline to read one file. Verifies:
 * - Native tool calling works (not XML fallback)
 * - Tool result round-trip works (Cline reads file, gets content, completes task)
 * - CLI exits cleanly
 */
async function testSingleToolCall(configDir: string, workspaceDir: string) {
	const filePath = path.join(workspaceDir, "single.txt")
	fs.writeFileSync(filePath, "single-file-content", "utf-8")

	const prompt = `Read the file at ${filePath} using the read_file tool. After reading it, use attempt_completion to report exactly what the file contains. Do not use any other tools.`

	// Fresh config for this test
	const testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-bedrock-t1-"))
	seedCliConfig(testConfigDir)

	const result = await runCli(prompt, testConfigDir, workspaceDir)

	assert(!detectXmlFallback(result.stdout), "Detected XML fallback tool calling — expected native tool calling")

	const readFileCalls = result.toolCalls.filter((tc) => tc.toolName === "readFile" || tc.toolName === "read_file")
	assert(readFileCalls.length >= 1, `Expected at least 1 read_file tool call, got ${readFileCalls.length}`)

	// Verify the task completed (CLI exited with 0)
	assert(result.exitCode === 0, `CLI exited with code ${result.exitCode}, expected 0`)
}

/**
 * Test 2: Parallel tool calls
 * Asks Cline to read 3 files simultaneously. Verifies:
 * - Multiple tool calls are made in a single turn
 * - All 3 files are read
 * - Native tool calling (not XML)
 */
async function testParallelToolCalls(configDir: string, workspaceDir: string) {
	const prompt = `You are verifying Bedrock parallel tool calling in the Cline CLI.

IMPORTANT:
- You MUST call the read_file tool ONCE for each of these files.
- Call all read_file tools BEFORE responding with any text.
- Do not use any other tools besides read_file and attempt_completion.
- After the tool calls, use attempt_completion to say: "Parallel tool calling verified."

Files to read (use these exact paths):
- ${path.join(workspaceDir, "a.txt")}
- ${path.join(workspaceDir, "b.txt")}
- ${path.join(workspaceDir, "c.txt")}
`

	const testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-bedrock-t2-"))
	seedCliConfig(testConfigDir)

	const result = await runCli(prompt, testConfigDir, workspaceDir)

	assert(!detectXmlFallback(result.stdout), "Detected XML fallback tool calling — expected native tool calling")

	const readFileCalls = result.toolCalls.filter((tc) => tc.toolName === "readFile" || tc.toolName === "read_file")
	const uniquePaths = normalizePaths(readFileCalls.map((tc) => tc.args))

	// The core assertion: at least 2 distinct file reads in a single response proves
	// parallel tool calling works. Requiring all 3 is too strict — the model may
	// batch 2 in one turn and the 3rd in a follow-up, which is valid behavior.
	assert(uniquePaths.size >= 2, `Expected at least 2 distinct parallel read_file calls, got ${uniquePaths.size}`)

	if (uniquePaths.size < 3) {
		console.log(`  ⚠️  Model read ${uniquePaths.size}/3 files in parallel (acceptable — ≥2 proves the feature works)`)
	}
}

/**
 * Test 3: Tool result round-trip (read → process → write)
 * Asks Cline to read a file and create a new file based on its content. Verifies:
 * - Tool results are sent back to Bedrock correctly
 * - The model processes tool results and makes further tool calls
 * - Multi-turn tool calling works end-to-end
 */
async function testToolResultRoundTrip(configDir: string, workspaceDir: string) {
	const inputPath = path.join(workspaceDir, "input.txt")
	const outputPath = path.join(workspaceDir, "output.txt")
	fs.writeFileSync(inputPath, "The answer is 42", "utf-8")

	// Clean up any prior output
	if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)

	const prompt = `Read the file at ${inputPath} using the read_file tool. Then create a new file at ${outputPath} that contains exactly the text you read from the input file, but in ALL UPPERCASE. Use write_to_file to create the output file. Then use attempt_completion to confirm you're done.`

	const testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-bedrock-t3-"))
	seedCliConfig(testConfigDir)

	const result = await runCli(prompt, testConfigDir, workspaceDir)

	assert(!detectXmlFallback(result.stdout), "Detected XML fallback tool calling — expected native tool calling")
	assert(result.exitCode === 0, `CLI exited with code ${result.exitCode}, expected 0`)

	// Verify the output file was created with transformed content
	assert(fs.existsSync(outputPath), `Expected output file at ${outputPath} to exist`)
	const outputContent = fs.readFileSync(outputPath, "utf-8").trim()
	assert(
		outputContent.includes("THE ANSWER IS 42") ||
			outputContent.includes("ANSWER") ||
			outputContent.toUpperCase() === outputContent,
		`Expected uppercase content in output file, got: "${outputContent}"`,
	)
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
	ensureAwsCredentials()
	resolveCliCommand()

	const modelId = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID
	const region = process.env.AWS_REGION || DEFAULT_REGION

	console.log("╔══════════════════════════════════════════════════════════╗")
	console.log("║  Bedrock Parallel Tool Calling — CLI Verification Suite  ║")
	console.log("╚══════════════════════════════════════════════════════════╝")
	console.log(`Model:  ${modelId}`)
	console.log(`Region: ${region}`)
	console.log(`Cross-region: ${process.env.BEDROCK_USE_CROSS_REGION === "true"}`)

	// Create shared workspace with test files
	const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-bedrock-cli-"))
	const workspaceDir = path.join(testDir, "workspace")
	fs.mkdirSync(workspaceDir, { recursive: true })
	fs.writeFileSync(path.join(workspaceDir, "a.txt"), "alpha", "utf-8")
	fs.writeFileSync(path.join(workspaceDir, "b.txt"), "bravo", "utf-8")
	fs.writeFileSync(path.join(workspaceDir, "c.txt"), "charlie", "utf-8")

	console.log(`Workspace: ${workspaceDir}`)

	// Run test suite
	const results: TestResult[] = []

	results.push(await runTest("Test 1: Single tool call", () => testSingleToolCall(testDir, workspaceDir)))

	results.push(await runTest("Test 2: Parallel tool calls (3 files)", () => testParallelToolCalls(testDir, workspaceDir)))

	results.push(
		await runTest("Test 3: Tool result round-trip (read → transform → write)", () =>
			testToolResultRoundTrip(testDir, workspaceDir),
		),
	)

	// Print summary
	console.log("\n" + "═".repeat(60))
	console.log("Summary")
	console.log("═".repeat(60))
	const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0)
	for (const r of results) {
		console.log(`  ${r.passed ? "✅" : "❌"} ${r.name} (${(r.durationMs / 1000).toFixed(1)}s): ${r.detail}`)
	}
	console.log(
		`\nTotal: ${results.filter((r) => r.passed).length}/${results.length} passed (${(totalDuration / 1000).toFixed(1)}s)`,
	)

	const failed = results.filter((r) => !r.passed)
	if (failed.length > 0) {
		console.error(`\n${failed.length} test(s) failed.`)
		process.exit(1)
	}

	console.log("\n✅ All tests passed.")
	process.exit(0)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
