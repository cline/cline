#!/usr/bin/env npx tsx

/**
 * Simple Cline gRPC Server
 *
 * This is a minimal script to run the Cline core gRPC service without
 * the complex installation process. Just run: npx tsx scripts/simple-cline-server.ts
 */

import { ChildProcess, spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { ClineApiServerMock } from "../src/test/e2e/fixtures/server/index"

// Configuration
const PROTOBUS_PORT = process.env.PROTOBUS_PORT || "26040"
const HOSTBRIDGE_PORT = process.env.HOSTBRIDGE_PORT || "26041"
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd()

console.log("🚀 Starting Simple Cline gRPC Server...")
console.log(`📁 Workspace: ${WORKSPACE_DIR}`)
console.log(`🌐 ProtoBus Port: ${PROTOBUS_PORT}`)
console.log(`🔍 HostBridge Port: ${HOSTBRIDGE_PORT}`)

async function main(): Promise<void> {
	// Check if we have the built standalone files
	const distDir = path.join(__dirname, "..", "dist-standalone")
	const coreFile = path.join(distDir, "cline-core.js")

	if (!fs.existsSync(coreFile)) {
		console.error("❌ Standalone build not found. Please run: npm run compile-standalone")
		process.exit(1)
	}

	// [TODO]: We can sping up cline-core.ts and host-bridge without creating a new process
	try {
		const server = await ClineApiServerMock.startGlobalServer()
	} catch (error) {
		console.log("coso raro", error)
	}

	// Start hostbridge test server in background
	console.log("🔧 Starting HostBridge test server...")
	const hostbridge: ChildProcess = spawn("npx", ["tsx", path.join(__dirname, "test-hostbridge-server.ts")], {
		stdio: "pipe",
		detached: false,
	})

	// Wait a moment for hostbridge to start
	await new Promise((resolve) => setTimeout(resolve, 2000))

	// Start the core service
	console.log("🎯 Starting Cline Core Service...")
	const coreService: ChildProcess = spawn("node", ["cline-core.js"], {
		cwd: distDir,
		env: {
			...process.env,
			NODE_PATH: "./node_modules",
			DEV_WORKSPACE_FOLDER: WORKSPACE_DIR,
			PROTOBUS_ADDRESS: `127.0.0.1:${PROTOBUS_PORT}`,
			HOST_BRIDGE_ADDRESS: `localhost:${HOSTBRIDGE_PORT}`,
			TEMP_PROFILE: "true",
			E2E_TEST: "true",
			CLINE_ENVIRONMENT: "local",
			// IS_DEV:"true",
		},
		stdio: "inherit",
	})

	// Handle graceful shutdown
	const shutdown = (): void => {
		console.log("\n🛑 Shutting down services...")
		hostbridge.kill()
		coreService.kill()
		process.exit(0)
	}

	process.on("SIGINT", shutdown)
	process.on("SIGTERM", shutdown)

	coreService.on("exit", (code) => {
		console.log(`💀 Core service exited with code ${code}`)
		hostbridge.kill()
		process.exit(code || 0)
	})

	hostbridge.on("exit", (code) => {
		console.log(`💀 HostBridge exited with code ${code}`)
		coreService.kill()
		process.exit(code || 0)
	})

	console.log("✅ Cline gRPC Server is running!")
	console.log(`🔗 Connect to: 127.0.0.1:${PROTOBUS_PORT}`)
	console.log("📋 Press Ctrl+C to stop")
}

if (require.main === module) {
	main().catch((error) => {
		console.error("Failed to start simple Cline server:", error)
		process.exit(1)
	})
}
