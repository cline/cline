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

import { type ChildProcess, spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import minimist from "minimist"
import kill from "tree-kill"

let showServerLogs = false
let fix = false

const STANDALONE_GRPC_SERVER_PORT = process.env.STANDALONE_GRPC_SERVER_PORT || "26040"
const WAIT_SERVER_DEFAULT_TIMEOUT = 15000

// Poll until port is accepting connections
async function waitForPort(port: number, host = "127.0.0.1", timeout = 10000): Promise<void> {
	const start = Date.now()
	const waitForPortSleepMs = 100
	while (Date.now() - start < timeout) {
		await new Promise((res) => setTimeout(res, waitForPortSleepMs))
		try {
			await new Promise<void>((resolve, reject) => {
				const socket = net.connect(port, host, () => {
					socket.destroy()
					resolve()
				})
				socket.on("error", reject)
			})
			return
		} catch {
			// try again
		}
	}
	throw new Error(`Timeout waiting for ${host}:${port}`)
}

async function startServer(): Promise<{ server: ChildProcess; grpcPort: string }> {
	const grpcPort = STANDALONE_GRPC_SERVER_PORT

	const server = spawn("npx", ["tsx", "scripts/test-standalone-core-api-server.ts"], {
		stdio: showServerLogs ? "inherit" : "pipe",
		env: { ...process.env, STANDALONE_GRPC_SERVER_PORT: grpcPort },
	})

	// Wait for either the server to become ready or fail on spawn error
	await Promise.race([
		waitForPort(Number(grpcPort), "127.0.0.1", WAIT_SERVER_DEFAULT_TIMEOUT),
		new Promise((_, reject) => server.once("error", reject)),
	])

	return { server, grpcPort }
}

function stopServer(server: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (!server.pid) {
			return resolve()
		}

		kill(server.pid, "SIGKILL", (err) => {
			if (err) {
				console.warn("Failed to kill server process:", err)
			}
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
	const { server, grpcPort } = await startServer()
	try {
		await runTestingPlatform(specFile, grpcPort)
		console.log(`✅ ${path.basename(specFile)} passed`)
	} finally {
		await stopServer(server)
	}
}

function collectSpecFiles(inputPath: string): string[] {
	const fullPath = path.resolve(inputPath)
	if (!fs.existsSync(fullPath)) {
		throw new Error(`Path does not exist: ${fullPath}`)
	}

	const stat = fs.statSync(fullPath)
	if (stat.isDirectory()) {
		return fs
			.readdirSync(fullPath)
			.filter((f) => f.endsWith(".json"))
			.map((f) => path.join(fullPath, f))
	}
	if (fullPath.endsWith(".json")) {
		return [fullPath]
	}
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

		if (failure > 0) {
			process.exitCode = 1
		}
	}

	console.log(`✅ Passed: ${success}`)
	if (failure > 0) {
		console.log(`❌ Failed: ${failure}`)
	}
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
