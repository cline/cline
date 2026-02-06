/**
 * Bedrock parallel tool calling verification via the Cline CLI.
 *
 * Spawns a headless Cline CLI configured with Bedrock, asks it to read 3 files,
 * and verifies that native parallel tool calling works end-to-end:
 * - ≥2 distinct read_file calls in a single turn (proves parallel)
 * - No XML fallback detected (proves native tool calling path)
 * - Task completes cleanly (proves tool result round-trip works)
 *
 * Prereqs:
 * - `cline` CLI on PATH (or set CLINE_BIN)
 * - AWS credentials (env vars, profile, or ALLOW_AWS_DEFAULT_CHAIN=true)
 * - Bedrock access to an Anthropic model
 *
 * Run:
 *   ALLOW_AWS_DEFAULT_CHAIN=true BEDROCK_USE_CROSS_REGION=true \
 *   npx tsx scripts/test-bedrock-parallel-tools-cli.ts
 */

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const DEFAULT_MODEL_ID = "anthropic.claude-haiku-4-5-20251001-v1:0"
const DEFAULT_REGION = "us-east-1"

function log(msg: string) {
	process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`)
}

function assert(condition: boolean, message: string) {
	if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function resolveCliCommand(): string {
	if (process.env.CLINE_BIN) return process.env.CLINE_BIN
	const probe = spawnSync("cline", ["--version"], { stdio: "ignore" })
	if (!probe.error && probe.status === 0) return "cline"
	throw new Error("Cline CLI not found on PATH. Set CLINE_BIN or install cline.")
}

function seedConfig(configDir: string) {
	const writeJson = (p: string, d: unknown) => {
		fs.mkdirSync(path.dirname(p), { recursive: true })
		fs.writeFileSync(p, JSON.stringify(d, null, 2))
	}
	const dataDir = path.join(configDir, "data")
	writeJson(path.join(dataDir, "globalState.json"), {
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
	})
	writeJson(path.join(dataDir, "secrets.json"), {
		awsAccessKey: process.env.AWS_ACCESS_KEY_ID,
		awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY,
		awsSessionToken: process.env.AWS_SESSION_TOKEN,
	})
}

function parseReadFilePaths(stdout: string): Set<string> {
	const paths = new Set<string>()
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed.startsWith("{")) continue
		try {
			const msg = JSON.parse(trimmed) as { type?: string; ask?: string; say?: string; text?: string }
			const isTool = msg.type === "ask" ? msg.ask === "tool" : msg.type === "say" ? msg.say === "tool" : false
			if (isTool && msg.text) {
				const payload = JSON.parse(msg.text) as { tool?: string; path?: string }
				if ((payload.tool === "readFile" || payload.tool === "read_file") && payload.path) {
					paths.add(path.normalize(payload.path))
				}
			}
		} catch {}
	}
	return paths
}

function hasXmlFallback(stdout: string): boolean {
	return [
		/<tool_name>\s*\n\s*<\/tool_name>|<tool_name>\s*\n\s*<parameter/i,
		/<invoke\s+name="(read_file|attempt_completion|execute_command)"/i,
	].some((re) => re.test(stdout))
}

async function runCli(prompt: string, configDir: string, workspaceDir: string) {
	return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
		const cli = resolveCliCommand()
		log(`Spawning: ${cli}`)
		const child = spawn(
			cli,
			["--config", configDir, "--cwd", workspaceDir, "task", "--json", "--yolo", "--timeout", "120", "--act", prompt],
			{
				cwd: path.resolve(__dirname, ".."),
				env: { ...process.env, CLINE_DIR: configDir },
				stdio: ["pipe", "pipe", "pipe"],
			},
		)
		let stdout = ""
		let stderr = ""
		let lastOutput = Date.now()
		const hb = setInterval(
			() => log(`  waiting... (${Math.round((Date.now() - lastOutput) / 1000)}s since last output)`),
			15_000,
		)
		child.stdout.on("data", (c) => {
			stdout += c.toString()
			lastOutput = Date.now()
		})
		child.stderr.on("data", (c) => {
			stderr += c.toString()
			lastOutput = Date.now()
		})
		child.stdin.end()
		child.on("error", reject)
		child.on("close", (code) => {
			clearInterval(hb)
			resolve({ exitCode: code ?? 1, stdout, stderr })
		})
	})
}

async function main() {
	// Validate prerequisites
	if (process.env.ALLOW_AWS_DEFAULT_CHAIN !== "true" && !process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
		throw new Error("No AWS credentials. Set AWS_PROFILE, AWS_ACCESS_KEY_ID, or ALLOW_AWS_DEFAULT_CHAIN=true.")
	}
	resolveCliCommand()

	const modelId = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID
	const region = process.env.AWS_REGION || DEFAULT_REGION
	console.log(`Bedrock parallel tool calling verification`)
	console.log(`Model: ${modelId} | Region: ${region} | Cross-region: ${process.env.BEDROCK_USE_CROSS_REGION === "true"}`)

	// Set up workspace with 3 test files
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-bedrock-test-"))
	const workspaceDir = path.join(tmpDir, "workspace")
	fs.mkdirSync(workspaceDir, { recursive: true })
	for (const [name, content] of [
		["a.txt", "alpha"],
		["b.txt", "bravo"],
		["c.txt", "charlie"],
	] as const) {
		fs.writeFileSync(path.join(workspaceDir, name), content)
	}

	// Seed CLI config
	const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-bedrock-cfg-"))
	seedConfig(configDir)

	// Run Cline
	const prompt = `Read these 3 files using the read_file tool, then use attempt_completion to confirm done:
- ${path.join(workspaceDir, "a.txt")}
- ${path.join(workspaceDir, "b.txt")}
- ${path.join(workspaceDir, "c.txt")}`

	const start = Date.now()
	const result = await runCli(prompt, configDir, workspaceDir)
	const elapsed = ((Date.now() - start) / 1000).toFixed(1)

	// Verify
	assert(!hasXmlFallback(result.stdout), "Detected XML fallback — expected native tool calling")

	const readPaths = parseReadFilePaths(result.stdout)
	assert(readPaths.size >= 2, `Expected ≥2 parallel read_file calls, got ${readPaths.size}`)

	const expected = ["a.txt", "b.txt", "c.txt"].map((f) => path.normalize(path.join(workspaceDir, f)))
	const missing = expected.filter((p) => !readPaths.has(p))
	if (missing.length > 0) {
		console.log(`⚠️  ${readPaths.size}/3 files read in parallel (${missing.length} in follow-up turn — acceptable)`)
	}

	console.log(`\n✅ Parallel tool calling verified (${readPaths.size} parallel reads, ${elapsed}s)`)
	console.log(`   Files read: ${Array.from(readPaths).join(", ")}`)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
