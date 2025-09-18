#!/usr/bin/env npx tsx
/**
 * CI-Safe Test Orchestrator
 *
 * Automates server lifecycle for running spec files against the standalone server.
 * Handles proper shutdown even in non-interactive environments like GitHub Actions.
 */

import { ChildProcess, spawn } from "child_process"
import fs from "fs"
import minimist from "minimist"
import path from "path"
import kill from "tree-kill"

const SERVER_BOOT_DELAY = Number(process.env.SERVER_BOOT_DELAY) || 1300

let showServerLogs = false
let fix = false

// Generate a CI-safe random port if needed
function getGrpcPort(): string {
	return process.env.STANDALONE_GRPC_SERVER_PORT || "26040"
}

function startServer(): Promise<ChildProcess> {
	return new Promise((resolve, reject) => {
		const grpcPort = getGrpcPort()
		const server = spawn("npx", ["tsx", "scripts/test-standalone-core-api-server.ts"], {
			stdio: showServerLogs ? "inherit" : "pipe",
			env: { ...process.env, STANDALONE_GRPC_SERVER_PORT: grpcPort },
		})

		server.once("error", reject)

		setTimeout(() => {
			if (server.killed) reject(new Error("Server died during startup"))
			else resolve(server)
		}, SERVER_BOOT_DELAY)
	})
}

function stopServer(server: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (!server.pid) return resolve()

		kill(server.pid, "SIGKILL", (err) => {
			if (err) console.warn("Failed to kill server process:", err)
			// Ensure we resolve after process exit
			server.once("exit", () => resolve())
		})
	})
}

function runTestingPlatform(specFile: string, grpcPort: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const testProcess = spawn("npx", ["ts-node", "index.ts", specFile, ...(fix ? ["--fix"] : [])], {
			cwd: path.join(process.cwd(), "testing-platform"),
			stdio: "inherit",
			env: {
				...process.env,
				STANDALONE_GRPC_SERVER_PORT: grpcPort,
			},
		})

		testProcess.once("error", reject)
		testProcess.once("exit", (code) => {
			code === 0 ? resolve() : reject(new Error(`Exit code ${code}`))
		})
	})
}

async function runSpec(specFile: string): Promise<void> {
	const grpcPort = getGrpcPort()
	const server = await startServer()
	try {
		await runTestingPlatform(specFile, grpcPort)
		console.log(`✅ ${path.basename(specFile)} passed`)
	} finally {
		await stopServer(server)
		await new Promise((r) => setTimeout(r, 500)) // Small delay to release port
	}
}

function collectSpecFiles(inputPath: string): string[] {
	const fullPath = path.resolve(inputPath)
	if (!fs.existsSync(fullPath)) throw new Error(`Path does not exist: ${fullPath}`)

	const stat = fs.statSync(fullPath)
	if (stat.isDirectory()) {
		return fs
			.readdirSync(fullPath)
			.filter((f) => f.endsWith(".json"))
			.map((f) => path.join(fullPath, f))
	}
	if (fullPath.endsWith(".json")) return [fullPath]
	throw new Error("Spec path must be a JSON file or a folder containing JSON files")
}

async function runAll(inputPath: string, count: number) {
	const specFiles = collectSpecFiles(inputPath)
	if (specFiles.length === 0) {
		console.warn(`⚠️ No spec files found in ${inputPath}`)
		return
	}

	let success = 0
	let failure = 0
	const totalStart = Date.now()

	for (let i = 0; i < count; i++) {
		console.log(`\n🔁 Run #${i + 1} of ${count}`)
		for (const specFile of specFiles) {
			try {
				await runSpec(specFile)
				success++
			} catch (err) {
				console.error(`❌ run #${i + 1}: ${path.basename(specFile)} failed:`, (err as Error).message)
				failure++
			}
		}

		if (failure > 0) process.exitCode = 1
	}

	console.log(`✅ Passed: ${success}`)
	if (failure > 0) console.log(`❌ Failed: ${failure}`)
	console.log(`📋 Total specs: ${specFiles.length} Total runs: ${specFiles.length * count}`)
	console.log(`🏁 All runs completed in ${((Date.now() - totalStart) / 1000).toFixed(2)}s`)
}

async function main() {
	const args = minimist(process.argv.slice(2), { default: { count: 1 } })
	const inputPath = args._[0]
	const count = Number(args.count)
	showServerLogs = Boolean(args["server-logs"])
	fix = Boolean(args["fix"])

	if (!inputPath) {
		console.error(
			"Usage: npx tsx scripts/testing-platform-orchestrator.ts <spec-file-or-folder> [--count=N] [--server-logs] [--fix]",
		)
		process.exit(1)
	}

	await runAll(inputPath, count)
}

if (require.main === module) {
	main().catch((err) => {
		console.error("❌ Fatal error:", err)
		process.exit(1)
	})
}
