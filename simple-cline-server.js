#!/usr/bin/env node

/**
 * Simple Cline gRPC Server
 *
 * This is a minimal script to run the Cline core gRPC service without
 * the complex installation process. Just run: node simple-cline-server.js
 */

const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")

// Configuration
const PROTOBUS_PORT = process.env.PROTOBUS_PORT || 26040
const HOSTBRIDGE_PORT = process.env.HOSTBRIDGE_PORT || 26041
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd()

console.log("🚀 Starting Simple Cline gRPC Server...")
console.log(`📁 Workspace: ${WORKSPACE_DIR}`)
console.log(`🌐 ProtoBus Port: ${PROTOBUS_PORT}`)
console.log(`🔍 HostBridge Port: ${HOSTBRIDGE_PORT}`)

async function main() {
	// Check if we have the built standalone files
	const distDir = path.join(__dirname, "dist-standalone")
	const coreFile = path.join(distDir, "cline-core.js")

	if (!fs.existsSync(coreFile)) {
		console.error("❌ Standalone build not found. Please run: npm run compile-standalone")
		process.exit(1)
	}

	// Start hostbridge test server in background
	console.log("🔧 Starting HostBridge test server...")
	const hostbridge = spawn("npx", ["tsx", path.join(__dirname, "scripts/test-hostbridge-server.ts")], {
		stdio: "pipe",
		detached: false,
	})

	// Wait a moment for hostbridge to start
	await new Promise((resolve) => setTimeout(resolve, 2000))

	// Start the core service
	console.log("🎯 Starting Cline Core Service...")
	const coreService = spawn("node", ["cline-core.js"], {
		cwd: distDir,
		env: {
			...process.env,
			NODE_PATH: "./node_modules",
			DEV_WORKSPACE_FOLDER: WORKSPACE_DIR,
			PROTOBUS_ADDRESS: `127.0.0.1:${PROTOBUS_PORT}`,
			HOST_BRIDGE_ADDRESS: `localhost:${HOSTBRIDGE_PORT}`,
		},
		stdio: "inherit",
	})

	// Handle graceful shutdown
	process.on("SIGINT", () => {
		console.log("\n🛑 Shutting down services...")
		hostbridge.kill()
		coreService.kill()
		process.exit(0)
	})

	process.on("SIGTERM", () => {
		console.log("\n🛑 Shutting down services...")
		hostbridge.kill()
		coreService.kill()
		process.exit(0)
	})

	coreService.on("exit", (code) => {
		console.log(`💀 Core service exited with code ${code}`)
		hostbridge.kill()
		process.exit(code)
	})

	hostbridge.on("exit", (code) => {
		console.log(`💀 HostBridge exited with code ${code}`)
		coreService.kill()
		process.exit(code)
	})

	console.log("✅ Cline gRPC Server is running!")
	console.log(`🔗 Connect to: 127.0.0.1:${PROTOBUS_PORT}`)
	console.log("📋 Press Ctrl+C to stop")
}

main().catch(console.error)
