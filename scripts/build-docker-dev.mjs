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

	buildPrerequisites()

	// Build Docker image for native platform
	// Docker will automatically use the correct architecture (arm64 on Apple Silicon, amd64 on Intel)
	runCommand("docker build -f docker/Dockerfile -t cline-cli:dev .", "Building Docker image")

	console.log("✅ Docker image built successfully!")
	console.log("\nUsage:")
	console.log("  docker run --rm cline-cli:dev --help")
	console.log("  docker run --rm cline-cli:dev version")
	console.log("  docker run --rm -it -v $(pwd):/workspace cline-cli:dev")
	console.log("\nInteractive shell:")
	console.log("  npm run docker:shell")
}

main()
