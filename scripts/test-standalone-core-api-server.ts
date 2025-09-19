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

import { mkdtempSync, rmSync } from "node:fs"
import * as os from "node:os"
import { ChildProcess, execSync, spawn } from "child_process"
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
		await ClineApiServerMock.startGlobalServer()
		console.log("Cline API Server started in-process")
	} catch (error) {
		console.error("Failed to start Cline API Server:", error)
		process.exit(1)
	}

	// Fixed extension directory
	const extensionsDir = path.join(distDir, "vsce-extension")

	// Create temporary directories like e2e tests
	const userDataDir = mkdtempSync(path.join(os.tmpdir(), "vsce"))
	const clineTestWorkspace = mkdtempSync(path.join(os.tmpdir(), "cline-test-workspace-"))

	// Start hostbridge test server in background.
	// We run it as a child process to emulate how the extension currently operates
	console.log("Starting HostBridge test server...")
	const hostbridge: ChildProcess = spawn("npx", ["tsx", path.join(__dirname, "test-hostbridge-server.ts")], {
		stdio: "pipe",
		detached: false,
		env: {
			...process.env,
			TEST_HOSTBRIDGE_WORKSPACE_DIR: clineTestWorkspace,
			HOST_BRIDGE_ADDRESS: `127.0.0.1:${HOSTBRIDGE_PORT}`,
		},
	})

	console.log(`Temp user data dir: ${userDataDir}`)
	console.log(`Temp extensions dir: ${extensionsDir}`)

	// Extract standalone.zip to the extensions directory
	const standaloneZipPath = path.join(distDir, "standalone.zip")
	if (!fs.existsSync(standaloneZipPath)) {
		console.error(`standalone.zip not found at: ${standaloneZipPath}`)
		process.exit(1)
	}

	console.log("Extracting standalone.zip to extensions directory...")
	try {
		if (!fs.existsSync(extensionsDir)) {
			execSync(`unzip -q "${standaloneZipPath}" -d "${extensionsDir}"`, { stdio: "inherit" })
		}
		console.log(`Successfully extracted standalone.zip to: ${extensionsDir}`)
	} catch (error) {
		console.error("Failed to extract standalone.zip:", error)
		process.exit(1)
	}

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
			CLINE_DIR: userDataDir,
			INSTALL_DIR: extensionsDir,
		},
		stdio: "inherit",
	})

	// Handle graceful shutdown
	const shutdown = async (): Promise<void> => {
		console.log(`\n Shutting down services...\n${userDataDir}\n${extensionsDir}\n${clineTestWorkspace}\n`)
		hostbridge.kill()
		coreService.kill()
		await ClineApiServerMock.stopGlobalServer()

		// Cleanup temp directories
		try {
			rmSync(userDataDir, { recursive: true, force: true })
			rmSync(clineTestWorkspace, { recursive: true, force: true })
			console.log("Cleaned up temporary directories")
		} catch (error) {
			console.warn("Failed to cleanup temp directories:", error)
		}

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
