/**
 * Bedrock parallel tool calling verification via the Cline CLI (headless).
 *
 * What this tests (important):
 * - This targets Cline's **structured/native tool calling** path ("tool_use" / "tool_calls"),
 *   which is the prerequisite for **parallel** tool execution.
 * - It will FAIL if it detects legacy XML fallback tool calling (`<tool_name>...`).
 *
 * Prereqs:
 * - `cline` is installed and available on PATH (the script spawns `cline`).
 * - AWS credentials are available either via env vars (AWS_PROFILE or AWS_ACCESS_KEY_ID/SECRET)
 *   OR via the default AWS credential chain (set `ALLOW_AWS_DEFAULT_CHAIN=true`).
 * - Bedrock access to an Anthropic model. Many require an inference profile or cross-region inference.
 *
 * Recommended run (works well for Bedrock Anthropic inference profiles):
 *   ALLOW_AWS_DEFAULT_CHAIN=true \
 *   BEDROCK_USE_CROSS_REGION=true \
 *   npx tsx scripts/test-bedrock-parallel-tools-cli.ts
 *
 * If you need to force an inference profile:
 *   BEDROCK_INFERENCE_PROFILE_ARN=arn:aws:bedrock:... \
 *   BEDROCK_INFERENCE_PROFILE_BASE_MODEL_ID=anthropic.claude-haiku-4-5-20251001-v1:0 \
 *   npx tsx scripts/test-bedrock-parallel-tools-cli.ts
 *
 * Optional env overrides:
 * - BEDROCK_MODEL_ID: override model id (default is a Claude Haiku 4.5 id)
 * - AWS_REGION: default us-east-1
 * - CLINE_BIN: override the cline binary path/name
 */

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

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
}

function nowIso(): string {
	return new Date().toISOString()
}

function logProgress(message: string) {
	process.stderr.write(`[${nowIso()}] ${message}\n`)
}

const DEFAULT_MODEL_ID = "anthropic.claude-sonnet-4-5-20250514-v1:0"
const DEFAULT_REGION = "us-east-1"

function ensureAwsCredentials() {
	// Note: In CI/dev environments, credentials are often provided via the default AWS
	// provider chain (e.g., ~/.aws/config + SSO cache, EC2/ECS metadata, etc.)
	// without setting AWS_PROFILE or AWS_ACCESS_KEY_ID.
	//
	// For this script, we only *require* that the caller indicates credentials are
	// available via either:
	// - explicit env vars (AWS_PROFILE / AWS_ACCESS_KEY_ID), OR
	// - opting into default provider chain with ALLOW_AWS_DEFAULT_CHAIN=true
	//
	// This keeps the script autonomous while still avoiding confusing failures when
	// no auth is possible at all.
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
		// Many Bedrock Anthropic models require an inference profile (or cross-region inference)
		// and will fail with: "on-demand throughput isn’t supported".
		// If a profile ARN is provided, seed config to use it.
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

function buildPrompt(testDir: string) {
	return `You are verifying Bedrock parallel tool calling in the Cline CLI.

IMPORTANT:
- You MUST call the read_file tool ONCE for each of these files.
- Call all read_file tools BEFORE responding with any text.
- Do not use any other tools.
- After the tool calls, reply with a single sentence: "Parallel tool calling verified."

Files to read (use these exact paths):
- ${path.join(testDir, "a.txt")}
- ${path.join(testDir, "b.txt")}
- ${path.join(testDir, "c.txt")}
`
}

function parseToolCalls(stdout: string): ToolCallSummary[] {
	const toolCalls: ToolCallSummary[] = []
	const lines = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)

	for (const line of lines) {
		if (!line.startsWith("{")) {
			continue
		}
		try {
			const message = JSON.parse(line) as { type?: string; ask?: string; say?: string; text?: string }
			const isToolMessage =
				message.type === "ask" ? message.ask === "tool" : message.type === "say" ? message.say === "tool" : false
			if (isToolMessage && message.text) {
				const payload = JSON.parse(message.text) as { tool?: string; path?: string }
				// CLI emits tool ids like "readFile" (camel) whereas the internal tool name
				// in prompts is "read_file" (snake). Accept either.
				if ((payload?.tool === "readFile" || payload?.tool === "read_file") && payload.path) {
					toolCalls.push({ callId: payload.path, toolName: payload.tool, args: payload.path })
				}
			}
		} catch {
			// Ignore non-JSON or unexpected lines
		}
	}

	return toolCalls
}

function parseToolCallsFromEmbeddedInvokeText(stdout: string): ToolCallSummary[] {
	// Some models (or tool formats) may emit tool calls as embedded XML/"invoke" text
	// rather than as structured tool messages. We treat those as a fallback signal.
	const toolCalls: ToolCallSummary[] = []
	const invokeRegex = /<invoke\s+name="read_file">[\s\S]*?<parameter\s+name="path">([^<]+)<\/parameter>/g
	let match: RegExpExecArray | null
	while ((match = invokeRegex.exec(stdout))) {
		const p = match[1]?.trim()
		if (p) toolCalls.push({ callId: p, toolName: "read_file", args: p })
	}
	return toolCalls
}

function normalizePaths(paths: Iterable<string>): Set<string> {
	const normalized = new Set<string>()
	for (const value of paths) {
		normalized.add(path.normalize(value))
	}
	return normalized
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

async function runCli(prompt: string, configDir: string, workspaceDir: string): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const cliCommand = resolveCliCommand()
		logProgress(`Spawning CLI: ${cliCommand}`)
		const cliLogPath = path.join(configDir, "cli-json.log")
		// Important: pass the real test prompt as the task content (not a placeholder like "x").
		const child = spawn(
			cliCommand,
			["--config", configDir, "--cwd", workspaceDir, "task", "--json", "--yolo", "--timeout", "1200", "--act", prompt],
			{
				cwd: path.resolve(__dirname, ".."),
				env: {
					...process.env,
					CLINE_DIR: configDir,
				},
				stdio: ["pipe", "pipe", "pipe"],
			},
		)

		let stdout = ""
		let stderr = ""
		let stdoutLines = 0
		let lastOutputAt = Date.now()

		const heartbeat = setInterval(() => {
			const secondsSince = Math.round((Date.now() - lastOutputAt) / 1000)
			logProgress(`Waiting... (stdout lines: ${stdoutLines}, last output: ${secondsSince}s ago)`)
		}, 10_000)

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
		// Still close stdin; we pass prompt as CLI arg.
		child.stdin.end()
		child.on("error", reject)
		child.on("close", (code) => {
			clearInterval(heartbeat)
			const toolCalls = [...parseToolCalls(stdout), ...parseToolCallsFromEmbeddedInvokeText(stdout)]
			resolve({ exitCode: code ?? 1, stdout, stderr, toolCalls })
		})
	})
}

function assert(condition: boolean, message: string) {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`)
	}
}

async function main() {
	ensureAwsCredentials()
	resolveCliCommand()

	const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-bedrock-cli-"))
	const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-bedrock-files-"))
	const workspaceDir = path.join(testDir, "workspace")
	fs.mkdirSync(workspaceDir, { recursive: true })

	fs.writeFileSync(path.join(workspaceDir, "a.txt"), "alpha", "utf-8")
	fs.writeFileSync(path.join(workspaceDir, "b.txt"), "bravo", "utf-8")
	fs.writeFileSync(path.join(workspaceDir, "c.txt"), "charlie", "utf-8")

	seedCliConfig(configDir)

	const prompt = buildPrompt(workspaceDir)
	console.log("Running Cline CLI Bedrock parallel tool calling verification...")
	console.log(`Config dir: ${configDir}`)
	console.log(`Workspace dir: ${workspaceDir}`)
	console.log(`Model: ${process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID}`)
	console.log(`Region: ${process.env.AWS_REGION || DEFAULT_REGION}`)

	const result = await runCli(prompt, configDir, workspaceDir)

	if (result.exitCode !== 0) {
		console.error("CLI exited with non-zero status.")
		console.error(result.stderr)
		process.exit(result.exitCode)
	}

	const uniquePaths = new Set(result.toolCalls.map((call) => call.args))
	// Ensure we are testing *structured/native* tool calling rather than XML fallback.
	// NOTE: The CLI may include the literal string "<tool_name>" inside *error/help text*.
	// To avoid false positives, only fail if we see actual XML tool invocation tags.
	const xmlToolPatterns = [
		/<tool_name>\s*\n\s*<\/tool_name>|<tool_name>\s*\n\s*<parameter/i,
		/<invoke\s+name="(read_file|attempt_completion|execute_command)"/i,
	]
	for (const pattern of xmlToolPatterns) {
		if (pattern.test(result.stdout)) {
			console.error(
				`Detected XML/invoke tool invocation in output (pattern: ${pattern}); this indicates legacy XML tool calling path, not native tool calling.`,
			)
			process.exit(1)
		}
	}
	if (uniquePaths.size < 2) {
		console.warn("Expected at least 2 parallel read_file tool calls. Parsed tool calls:")
		console.warn(result.toolCalls)
		console.warn("CLI stdout:")
		console.warn(result.stdout)
		process.exit(1)
	}

	const expectedPaths = normalizePaths([
		path.join(workspaceDir, "a.txt"),
		path.join(workspaceDir, "b.txt"),
		path.join(workspaceDir, "c.txt"),
	])
	const observedPaths = normalizePaths(uniquePaths)

	assert(
		Array.from(expectedPaths).every((expected) => observedPaths.has(expected)),
		"Expected tool calls for all three files.",
	)

	console.log("✅ Parallel tool calling verified via CLI.")
	console.log(`Detected tool calls: ${Array.from(uniquePaths).join(", ")}`)
	console.log("Done.")
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
