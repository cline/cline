#!/usr/bin/env npx tsx

/**
 * Simple Cline gRPC Server
 *
 * This script provides a minimal way to run the Cline core gRPC service
 * without requiring the full installation, while automatically mocking all external services. Simply run:
 *
 *   # One-time setup (generates protobuf files)
 *	 npm run compile-standalone
 *   npm run test:sca-server
 *
 * The following components are started automatically:
 *   1. HostBridge test server
 *   2. ClineApiServerMock (mock implementation of the Cline API)
 *   3. AuthServiceMock (activated if E2E_TEST="true")
 *
 * Environment Variables for Customization:
 *   PROJECT_ROOT - Override project root directory (default: parent of scripts dir)
 *   CLINE_DIST_DIR - Override distribution directory (default: PROJECT_ROOT/dist-standalone)
 *   CLINE_CORE_FILE - Override core file name (default: cline-core.js)
 *   PROTOBUS_PORT - gRPC server port (default: 26040)
 *   HOSTBRIDGE_PORT - HostBridge server port (default: 26041)
 *   WORKSPACE_DIR - Working directory (default: current directory)
 *   E2E_TEST - Enable E2E test mode (default: true)
 *   CLINE_ENVIRONMENT - Environment setting (default: local)
 *
 * Ideal for local development, testing, or lightweight E2E scenarios.
 */

import { ChildProcess, spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { ClineApiServerMock } from "../src/test/e2e/fixtures/server/index"

// Configuration
const PROTOBUS_PORT = process.env.PROTOBUS_PORT || "26040"
const HOSTBRIDGE_PORT = process.env.HOSTBRIDGE_PORT || "26041"
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd()
const E2E_TEST = process.env.E2E_TEST || "true"
const CLINE_ENVIRONMENT = process.env.CLINE_ENVIRONMENT || "local"

// Locate the standalone build directory and core file with flexible path resolution
const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const distDir = process.env.CLINE_DIST_DIR || path.join(projectRoot, "dist-standalone")
const clineCoreFile = process.env.CLINE_CORE_FILE || "cline-core.js"
const coreFile = path.join(distDir, clineCoreFile)

async function main(): Promise<void> {
	console.log("Starting Simple Cline gRPC Server...")
	console.log(`Workspace: ${WORKSPACE_DIR}`)
	console.log(`ProtoBus Port: ${PROTOBUS_PORT}`)
	console.log(`HostBridge Port: ${HOSTBRIDGE_PORT}`)

	console.log(`Looking for standalone build at: ${coreFile}`)

	if (!fs.existsSync(coreFile)) {
		console.error(`Standalone build not found at: ${coreFile}`)
		console.error("Available environment variables for customization:")
		console.error("  PROJECT_ROOT - Override project root directory")
		console.error("  CLINE_DIST_DIR - Override distribution directory")
		console.error("  CLINE_CORE_FILE - Override core file name")
		console.error("")
		console.error("To build the standalone version, run: npm run compile-standalone")
		process.exit(1)
	}

	try {
		const apiServer = await ClineApiServerMock.startGlobalServer()
		console.log("Cline API Server started in-process")
	} catch (error) {
		console.error("Failed to start Cline API Server:", error)
		process.exit(1)
	}

	// Start hostbridge test server in background.
	// We run it as a child process to emulate how the extension currently operates
	console.log("Starting HostBridge test server...")
	const hostbridge: ChildProcess = spawn("npx", ["tsx", path.join(__dirname, "test-hostbridge-server.ts")], {
		stdio: "pipe",
		detached: false,
	})

	// Start the core service
	// We run it as a child process to emulate how the extension currently operates
	console.log("Starting Cline Core Service...")
	const coreService: ChildProcess = spawn("node", [clineCoreFile], {
		cwd: distDir,
		env: {
			...process.env,
			NODE_PATH: "./node_modules",
			DEV_WORKSPACE_FOLDER: WORKSPACE_DIR,
			PROTOBUS_ADDRESS: `127.0.0.1:${PROTOBUS_PORT}`,
			HOST_BRIDGE_ADDRESS: `localhost:${HOSTBRIDGE_PORT}`,
			E2E_TEST: E2E_TEST,
			CLINE_ENVIRONMENT: CLINE_ENVIRONMENT,
		},
		stdio: "inherit",
	})

	// Handle graceful shutdown
	const shutdown = async (): Promise<void> => {
		console.log("\n Shutting down services...")
		hostbridge.kill()
		coreService.kill()
		await ClineApiServerMock.stopGlobalServer()
		process.exit(0)
	}

	process.on("SIGINT", shutdown)
	process.on("SIGTERM", shutdown)

	coreService.on("exit", (code) => {
		console.log(`Core service exited with code ${code}`)
		hostbridge.kill()
		process.exit(code || 0)
	})

	hostbridge.on("exit", (code) => {
		console.log(`HostBridge exited with code ${code}`)
		coreService.kill()
		process.exit(code || 0)
	})

	console.log("Cline gRPC Server is running!")
	console.log(`Connect to: 127.0.0.1:${PROTOBUS_PORT}`)
	console.log("Press Ctrl+C to stop")
}

if (require.main === module) {
	main().catch((error) => {
		console.error("Failed to start simple Cline server:", error)
		process.exit(1)
	})
}
