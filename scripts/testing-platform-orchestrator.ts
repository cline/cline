#!/usr/bin/env npx tsx
/**
 * Test Orchestrator
 *
 * Automates server lifecycle for running spec files against the standalone server.
 *
 * Prerequisites:
 *   Build standalone first: `npm run compile-standalone`
 *
 * Usage:
 *   - Single file:   `npm run test:tp-orchestrator path/to/spec.json`
 *   - All specs dir: `npm run test:tp-orchestrator tests/specs`
 *
 * Flags:
 *   --server-logs        Show server logs (hidden by default)
 *   --count=<number>     Repeat execution N times (default: 1)
 *   --fix     			  Automatically update spec files with actual responses
 *
 * Environment Variables:
 *   STANDALONE_GRPC_SERVER_PORT     	gRPC server port (default: 26040)
 *   SERVER_BOOT_DELAY    				Server startup delay in ms (default: 1300)
 */

import { ChildProcess, spawn } from "child_process"
import fs from "fs"
import minimist from "minimist"
import path from "path"

const STANDALONE_GRPC_SERVER_PORT = process.env.STANDALONE_GRPC_SERVER_PORT || "26040"
const SERVER_BOOT_DELAY = Number(process.env.SERVER_BOOT_DELAY) || 1300

let showServerLogs = false
let fix = false

function startServer(): Promise<ChildProcess> {
	return new Promise((resolve, reject) => {
		const server = spawn("npx", ["tsx", "scripts/test-standalone-core-api-server.ts"], {
			stdio: showServerLogs ? "inherit" : "ignore",
		})

		server.once("error", reject)

		setTimeout(() => {
			if (server.killed) {
				reject(new Error("Server died during startup"))
			} else {
				resolve(server)
			}
		}, SERVER_BOOT_DELAY)
	})
}

function stopServer(server: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		server.once("exit", () => resolve())
		server.kill("SIGINT")
		setTimeout(() => {
			if (!server.killed) {
				server.kill("SIGKILL")
				resolve()
			}
		}, 5000)
	})
}

function runTestingPlatform(specFile: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const testProcess = spawn("npx", ["ts-node", "index.ts", specFile, ...(fix ? ["--fix"] : [])], {
			cwd: path.join(process.cwd(), "testing-platform"),
			stdio: "inherit",
			env: {
				...process.env,
				STANDALONE_GRPC_SERVER_PORT,
			},
		})

		testProcess.once("error", reject)
		testProcess.once("exit", (code) => {
			code === 0 ? resolve() : reject(new Error(`Exit code ${code}`))
		})
	})
}

async function runSpec(specFile: string): Promise<void> {
	const server = await startServer()
	try {
		await runTestingPlatform(specFile)
		console.log(`✅ ${path.basename(specFile)} passed`)
	} finally {
		await stopServer(server)
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
	const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(2)
	console.log(`\n🏁 All runs completed in ${totalElapsed}s`)
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
