#!/usr/bin/env npx tsx

/**
 * Test Orchestrator Script
 *
 * This script manages the lifecycle of the standalone server for each spec file run.
 * It starts a fresh server instance for each spec, runs the test, then tears down the server.
 * This ensures clean isolation between test runs.
 */

import { ChildProcess, spawn } from "child_process"
import fs from "fs"
import path from "path"

const STANDALONE_GRPC_SERVER_PORT = process.env.HOSTBRIDGE_PORT || "26040"
const SERVER_BOOT_DELAY = 3000 // 3 seconds for server to boot

/**
 * Starts the standalone server and returns the process
 */
function startServer(): Promise<ChildProcess> {
	return new Promise((resolve, reject) => {
		console.log("🚀 Starting standalone server...")

		const server = spawn("npx", ["tsx", "scripts/test-standalone-core-api-server.ts"], {
			stdio: "inherit",
			detached: false,
		})

		server.on("error", (error) => {
			console.error("❌ Failed to start server:", error)
			reject(error)
		})

		// Give the server time to boot up
		setTimeout(() => {
			if (server.killed) {
				reject(new Error("Server was killed during startup"))
			} else {
				console.log("✅ Server started successfully")
				resolve(server)
			}
		}, SERVER_BOOT_DELAY)
	})
}

/**
 * Stops the server gracefully
 */
function stopServer(server: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		console.log("🛑 Stopping server...")

		server.on("exit", () => {
			console.log("✅ Server stopped")
			resolve()
		})

		// Send SIGINT for graceful shutdown
		server.kill("SIGINT")

		// Force kill after 5 seconds if it doesn't stop gracefully
		setTimeout(() => {
			if (!server.killed) {
				console.log("⚠️ Force killing server...")
				server.kill("SIGKILL")
				resolve()
			}
		}, 5000)
	})
}

/**
 * Runs the testing platform with a specific spec file
 */
function runTestingPlatform(specFile: string): Promise<void> {
	return new Promise((resolve, reject) => {
		console.log(`🧪 Running spec: ${path.basename(specFile)}`)

		const testProcess = spawn("npx", ["ts-node", "index.ts", specFile], {
			cwd: path.join(process.cwd(), "testing-platform"),
			stdio: "inherit",
			env: {
				...process.env,
				HOSTBRIDGE_PORT: STANDALONE_GRPC_SERVER_PORT,
			},
		})

		testProcess.on("error", (error) => {
			console.error("❌ Failed to run test:", error)
			reject(error)
		})

		testProcess.on("exit", (code) => {
			if (code === 0) {
				console.log("✅ Test completed successfully")
				resolve()
			} else {
				reject(new Error(`Test failed with exit code ${code}`))
			}
		})
	})
}

/**
 * Runs a single spec file with server lifecycle management
 */
async function runSpecWithServer(specFile: string): Promise<void> {
	let server: ChildProcess | null = null

	try {
		// Start server
		server = await startServer()

		// Run the spec using the testing platform
		await runTestingPlatform(specFile)
	} finally {
		// Stop server
		if (server) {
			await stopServer(server)
		}
	}
}

/**
 * Main orchestrator function
 */
async function main(): Promise<void> {
	const inputPath = process.argv[2]
	if (!inputPath) {
		console.error("Usage: npx tsx scripts/test-orchestrator.ts <spec-file-or-folder>")
		process.exit(1)
	}

	const fullPath = path.resolve(inputPath)

	if (!fs.existsSync(fullPath)) {
		console.error(`❌ Path does not exist: ${fullPath}`)
		process.exit(1)
	}

	const stat = fs.statSync(fullPath)
	let specFiles: string[] = []

	if (stat.isDirectory()) {
		// Get all JSON spec files from directory
		const files = fs.readdirSync(fullPath).filter((f) => f.endsWith(".json"))
		if (files.length === 0) {
			console.warn(`⚠️ No JSON spec files found in ${fullPath}`)
			return
		}
		specFiles = files.map((f) => path.join(fullPath, f))
	} else {
		// Single spec file
		if (!fullPath.endsWith(".json")) {
			console.error("❌ Spec file must be a JSON file")
			process.exit(1)
		}
		specFiles = [fullPath]
	}

	console.log(`📋 Found ${specFiles.length} spec file(s) to run`)

	let successCount = 0
	let failureCount = 0

	// Run each spec file with its own server instance
	for (const specFile of specFiles) {
		const fileName = path.basename(specFile)
		console.log(`\n📂 Running spec file: ${fileName}`)
		console.log("=".repeat(50))

		try {
			await runSpecWithServer(specFile)
			successCount++
			console.log(`✅ ${fileName} completed successfully`)
		} catch (error) {
			failureCount++
			console.error(`❌ ${fileName} failed:`, error instanceof Error ? error.message : error)
		}

		console.log("=".repeat(50))
	}

	// Summary
	console.log(`\n📊 Test Summary:`)
	console.log(`✅ Successful: ${successCount}`)
	console.log(`❌ Failed: ${failureCount}`)
	console.log(`📋 Total: ${specFiles.length}`)

	if (failureCount > 0) {
		process.exit(1)
	}
}

// Handle graceful shutdown
process.on("SIGINT", () => {
	console.log("\n🛑 Received SIGINT, shutting down...")
	process.exit(0)
})

process.on("SIGTERM", () => {
	console.log("\n🛑 Received SIGTERM, shutting down...")
	process.exit(0)
})

if (require.main === module) {
	main().catch((error) => {
		console.error("❌ Fatal error:", error)
		process.exit(1)
	})
}
