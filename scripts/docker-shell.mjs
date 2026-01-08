#!/usr/bin/env node

import { execSync } from "child_process"
import { platform } from "os"

const CONTAINER_NAME = "cline-cli-dev"

function runCommand(command) {
	try {
		return execSync(command, { encoding: "utf-8" }).trim()
	} catch (error) {
		return ""
	}
}

function getCurrentDirectory() {
	// Get current working directory in a cross-platform way
	return process.cwd()
}

function main() {
	console.log("🐳 Cline CLI Docker Shell\n")

	// Check if container exists (running or stopped)
	const containerId = runCommand(`docker ps -a --filter "name=^${CONTAINER_NAME}$" --format "{{.ID}}"`)

	if (containerId) {
		// Check if container is running
		const isRunning = runCommand(`docker ps --filter "id=${containerId}" --format "{{.ID}}"`)

		if (isRunning) {
			console.log(`📦 Connecting to running container: ${CONTAINER_NAME}\n`)
			try {
				execSync(`docker exec -it ${containerId} /bin/bash`, { stdio: "inherit" })
			} catch (error) {
				// User exited shell normally
			}
		} else {
			console.log(`▶️  Starting stopped container: ${CONTAINER_NAME}\n`)
			try {
				execSync(`docker start ${containerId}`, { stdio: "inherit" })
				execSync(`docker exec -it ${containerId} /bin/bash`, { stdio: "inherit" })
			} catch (error) {
				// User exited shell normally
			}
		}
	} else {
		console.log(`🚀 Creating new container: ${CONTAINER_NAME}\n`)
		const cwd = getCurrentDirectory()

		try {
			// Use different volume mount syntax for Windows vs Unix
			const isWindows = platform() === "win32"
			const volumeMount = isWindows ? `${cwd.replace(/\\/g, "/")}:/workspace` : `${cwd}:/workspace`

			execSync(
				`docker run -it --name ${CONTAINER_NAME} -v "${volumeMount}" -w /workspace --entrypoint /bin/bash cline-cli:dev`,
				{ stdio: "inherit" },
			)
		} catch (error) {
			// User exited shell normally
		}
	}
}

main()
