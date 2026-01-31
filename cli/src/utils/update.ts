import { spawn } from "node:child_process"
import { exit } from "node:process"
import { fetch } from "@/shared/net"
import { printInfo, printWarning } from "./display"

/**
 * Check for updates and install if available
 */
export async function checkForUpdates(currentVersion: string, options?: { verbose?: boolean }) {
	printInfo("Checking for updates...")

	try {
		// Fetch latest version from npm registry
		const response = await fetch("https://registry.npmjs.org/cline/latest")
		if (!response.ok && response.statusText !== "OK") {
			printWarning(`Failed to check for updates: ${response.statusText}`)
			exit(1)
		}

		const data = (await response.json()) as { version: string }
		const latestVersion = data.version

		if (options?.verbose) {
			printInfo(`Current version: ${currentVersion}`)
			printInfo(`Latest version: ${latestVersion}`)
		}

		// Compare versions
		if (latestVersion === currentVersion) {
			printInfo(`You are already on the latest version (${currentVersion})`)
			exit(0)
		}

		// Check if current is newer (dev version)
		if (compareVersions(currentVersion, latestVersion) > 0) {
			printInfo(`You are already on a newer version ${currentVersion} (latest: ${latestVersion})`)
			exit(0)
		}

		printInfo(`New version available: ${latestVersion} (current: ${currentVersion})`)
		// Ask user to confirm update
		const userConfirmed = new Promise<boolean>((resolve) => {
			process.stdout.write("Do you want to update now? (y/N): ")
			process.stdin.setEncoding("utf-8")
			process.stdin.once("data", (dataBuff) => {
				const input = dataBuff.toString().trim().toLowerCase()
				resolve(input === "y" || input === "yes")
			})
		})

		if (!(await userConfirmed)) {
			exit(0)
		}

		printInfo("Installing update...")

		// Run npm install -g cline@latest
		const npmProcess = spawn("npm", ["install", "-g", "cline@latest"], {
			stdio: "inherit",
			shell: true,
			// Ensures the process uses the same environment
			env: process.env,
			detached: false,
			windowsHide: true,
		})

		npmProcess.on("close", (code) => {
			if (code === 0) {
				printInfo(`Successfully updated to version ${latestVersion}`)
				exit(0)
			} else {
				printWarning("Update failed. Please try running: npm install -g cline@latest")
				exit(1)
			}
		})

		npmProcess.on("error", (err) => {
			printWarning(`Failed to run npm install: ${err.message}`)
			printInfo("Please try running manually: npm install -g cline@latest")
			exit(1)
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		printWarning(`Error checking for updates: ${message}`)
		exit(1)
	}
}

/**
 * Compare two semantic version strings
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
	const parts1 = v1.split(".").map(Number)
	const parts2 = v2.split(".").map(Number)

	for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
		const part1 = parts1[i] || 0
		const part2 = parts2[i] || 0

		if (part1 > part2) return 1
		if (part1 < part2) return -1
	}

	return 0
}
