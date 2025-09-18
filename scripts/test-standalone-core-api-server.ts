#!/usr/bin/env npx tsx

import { ChildProcess, spawn } from "child_process"
import * as fs from "fs"
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
import { mkdtempSync, rmSync } from "fs"
import * as os from "os"
import * as path from "path"
import { ClineApiServerMock } from "../src/test/e2e/fixtures/server/index"

const PROTOBUS_PORT = process.env.PROTOBUS_PORT || "26040"
const HOSTBRIDGE_PORT = process.env.HOSTBRIDGE_PORT || "26041"
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd()
const E2E_TEST = process.env.E2E_TEST || "true"
const CLINE_ENVIRONMENT = process.env.CLINE_ENVIRONMENT || "local"

const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const distDir = process.env.CLINE_DIST_DIR || path.join(projectRoot, "dist-standalone")
const clineCoreFile = process.env.CLINE_CORE_FILE || "cline-core.js"
const coreFile = path.join(distDir, clineCoreFile)

const childProcesses: ChildProcess[] = []

async function main(): Promise<void> {
	console.log("Starting Simple Cline gRPC Server...")

	if (!fs.existsSync(coreFile)) {
		console.error(`Standalone build not found at: ${coreFile}`)
		process.exit(1)
	}

	// Start in-process mock server
	await ClineApiServerMock.startGlobalServer()
	console.log("Cline API Server started in-process")

	const extensionsDir = path.join(distDir, "vsce-extension")
	const userDataDir = mkdtempSync(path.join(os.tmpdir(), "vsce"))
	const clineTestWorkspace = mkdtempSync(path.join(os.tmpdir(), "cline-test-workspace-"))

	// HostBridge
	const hostbridge = spawn("npx", ["tsx", path.join(__dirname, "test-hostbridge-server.ts")], {
		stdio: "pipe",
		env: {
			...process.env,
			TEST_HOSTBRIDGE_WORKSPACE_DIR: clineTestWorkspace,
			HOST_BRIDGE_ADDRESS: `127.0.0.1:${HOSTBRIDGE_PORT}`,
		},
	})
	childProcesses.push(hostbridge)

	// Extract standalone.zip if needed
	const standaloneZipPath = path.join(distDir, "standalone.zip")
	if (!fs.existsSync(standaloneZipPath)) {
		console.error(`standalone.zip not found at: ${standaloneZipPath}`)
		process.exit(1)
	}
	if (!fs.existsSync(extensionsDir)) {
		spawn("unzip", ["-q", standaloneZipPath, "-d", extensionsDir], { stdio: "inherit" }).on("exit", (code) => {
			if (code !== 0) console.error("Failed to unzip standalone.zip")
		})
	}

	// Core service
	const coreService = spawn("node", [clineCoreFile], {
		cwd: distDir,
		env: {
			...process.env,
			NODE_PATH: "./node_modules",
			DEV_WORKSPACE_FOLDER: WORKSPACE_DIR,
			PROTOBUS_ADDRESS: `127.0.0.1:${PROTOBUS_PORT}`,
			HOST_BRIDGE_ADDRESS: `localhost:${HOSTBRIDGE_PORT}`,
			E2E_TEST,
			CLINE_ENVIRONMENT,
			CLINE_DIR: userDataDir,
			INSTALL_DIR: extensionsDir,
		},
		stdio: "inherit",
	})
	childProcesses.push(coreService)

	// Unified shutdown
	const shutdown = async () => {
		console.log("\nShutting down services...")

		// Kill all child processes
		for (const child of childProcesses) {
			if (!child.killed) child.kill("SIGINT")
		}

		// Stop in-process server
		await ClineApiServerMock.stopGlobalServer()

		// Cleanup temp dirs
		try {
			rmSync(userDataDir, { recursive: true, force: true })
			rmSync(clineTestWorkspace, { recursive: true, force: true })
			console.log("Cleaned up temporary directories")
		} catch (err) {
			console.warn("Failed to cleanup temp directories:", err)
		}

		process.exit(0)
	}

	process.on("SIGINT", shutdown)
	process.on("SIGTERM", shutdown)

	// Ensure process exits if any critical child exits
	coreService.on("exit", (code) => {
		console.log(`Core service exited with code ${code}`)
		shutdown()
	})
	hostbridge.on("exit", (code) => {
		console.log(`HostBridge exited with code ${code}`)
		shutdown()
	})

	console.log(`Cline gRPC Server is running on 127.0.0.1:${PROTOBUS_PORT}`)
	console.log("Press Ctrl+C to stop")
}

if (require.main === module) {
	main().catch((err) => {
		console.error("Failed to start simple Cline server:", err)
		process.exit(1)
	})
}
