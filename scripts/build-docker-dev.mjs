#!/usr/bin/env node

import { execSync } from "child_process"

/**
 * Build Docker image for Cline CLI
 * This script builds a Docker image using pre-built binaries from dist-standalone/
 *
 * Prerequisites:
 * - Run `npm run compile-standalone` first to build all platform binaries
 * - Run `npm run compile-cli` first to build CLI binaries
 */

function runCommand(command, description) {
	console.log(`\n${description}...`)
	try {
		execSync(command, { stdio: "inherit" })
		console.log("✓ Success\n")
	} catch (error) {
		console.error(`✗ Failed: ${error.message}`)
		process.exit(1)
	}
}

function getCommandOutput(command) {
	try {
		return execSync(command, { encoding: "utf-8" }).trim()
	} catch (error) {
		return ""
	}
}

function buildPrerequisites() {
	console.log("Building prerequisites...\n")

	// Build standalone (includes cline-core and platform-specific native modules)
	runCommand("npm run compile-standalone", "Running npm run compile-standalone")

	// Build CLI binaries for all platforms
	runCommand("npm run compile-cli-all-platforms", "Running npm run compile-cli-all-platforms")

	console.log("✓ All prerequisites built successfully\n")
}

function main() {
	console.log("🐳 Building Cline CLI Docker Image\n")

	// Remove existing container to ensure clean state after rebuild
	const containerId = getCommandOutput(`docker ps -aq --filter "name=^cline-cli-dev$"`)
	if (containerId) {
		console.log("🗑️  Removing existing container to ensure fresh start...")
		try {
			execSync(`docker rm -f cline-cli-dev`, { stdio: "inherit" })
			console.log("✓ Container removed\n")
		} catch (error) {
			console.log("Note: Container cleanup failed, continuing anyway\n")
		}
	}

	buildPrerequisites()

	// Build Docker image for native platform
	// Docker will automatically use the correct architecture (arm64 on Apple Silicon, amd64 on Intel)
	runCommand("docker build -f docker/Dockerfile -t cline-cli:dev .", "Building Docker image")

	console.log("✅ Docker image built successfully!")
	console.log("\n📋 Next steps:\n")
	console.log("Interactive shell:")
	console.log("  npm run docker:shell\n")
	console.log("This will:")
	console.log("  • Reuse existing 'cline-cli-dev' container if running")
	console.log("  • Start stopped container if it exists")
	console.log("  • Create new persistent container if none exists")
	console.log("  • Mount current directory at /workspace")
	console.log("  • Provide all CLI commands (cline auth, cline task, etc.)")
	console.log("\nContainer persists between sessions. To remove:")
	console.log("  docker rm -f cline-cli-dev\n")
}

main()
