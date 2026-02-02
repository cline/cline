import { spawn } from "node:child_process"
import { realpathSync } from "node:fs"
import { exit } from "node:process"
import { fetch } from "@/shared/net"
import { printInfo, printWarning } from "./display"

export enum PackageManager {
	NPM = "npm",
	PNPM = "pnpm",
	YARN = "yarn",
	BUN = "bun",
	NPX = "npx",
	UNKNOWN = "unknown",
}

interface InstallationInfo {
	packageManager: PackageManager
	updateCommand?: string
}

/**
 * Detect how the CLI was installed and return the appropriate update command.
 */
function getInstallationInfo(): InstallationInfo {
	try {
		const scriptPath = realpathSync(process.argv[1] || "").replace(/\\/g, "/")

		// npx - skip auto-update (ephemeral execution)
		if (scriptPath.includes("/.npm/_npx") || scriptPath.includes("/npm/_npx")) {
			return { packageManager: PackageManager.NPX }
		}

		// pnpm global
		if (scriptPath.includes("/.pnpm/global") || scriptPath.includes("/pnpm/global")) {
			return {
				packageManager: PackageManager.PNPM,
				updateCommand: "pnpm add -g cline@latest",
			}
		}

		// yarn global
		if (scriptPath.includes("/.yarn/") || scriptPath.includes("/yarn/global")) {
			return {
				packageManager: PackageManager.YARN,
				updateCommand: "yarn global add cline@latest",
			}
		}

		// bun global
		if (scriptPath.includes("/.bun/bin")) {
			return {
				packageManager: PackageManager.BUN,
				updateCommand: "bun add -g cline@latest",
			}
		}

		// npm global (node_modules/cline)
		if (scriptPath.includes("/node_modules/cline/")) {
			return {
				packageManager: PackageManager.NPM,
				updateCommand: "npm install -g cline@latest",
			}
		}
	} catch {
		// If we can't resolve the path, assume unknown
	}

	return { packageManager: PackageManager.UNKNOWN }
}

/**
 * Fetch the latest version from npm registry.
 */
async function getLatestVersion(): Promise<string | null> {
	try {
		const response = await fetch("https://registry.npmjs.org/cline/latest")
		if (!response.ok) return null
		const data = (await response.json()) as { version: string }
		return data.version || null
	} catch {
		return null
	}
}

/**
 * Auto-update check that runs on CLI startup.
 * Checks for updates asynchronously (non-blocking), then spawns a detached
 * process to install if a newer version is available.
 *
 * Supports npm, pnpm, yarn, and bun global installs.
 * Skipped for npx, local dev, and unknown installations.
 * Can be disabled with CLINE_NO_AUTO_UPDATE=1 environment variable.
 */
export function autoUpdateOnStartup(currentVersion: string): void {
	// Skip in dev mode
	if (process.env.IS_DEV === "true") {
		return
	}

	// Skip if auto-update is disabled via env var
	if (process.env.CLINE_NO_AUTO_UPDATE === "1") {
		return
	}

	const { updateCommand } = getInstallationInfo()
	if (!updateCommand) {
		return
	}

	// Async version check - non-blocking, fire and forget
	checkAndUpdate(currentVersion, updateCommand)
}

async function checkAndUpdate(currentVersion: string, updateCommand: string): Promise<void> {
	try {
		const latestVersion = await getLatestVersion()
		if (!latestVersion) return

		// Only update if latest is newer
		if (compareVersions(currentVersion, latestVersion) >= 0) return

		// Spawn detached process to run the update command
		const child = spawn(updateCommand, {
			shell: true,
			detached: true,
			stdio: "ignore",
			env: process.env,
		})
		child.unref()
	} catch {
		// Silently ignore errors - auto-update is best-effort
	}
}

/**
 * Check for updates and install if available (manual command)
 */
export async function checkForUpdates(currentVersion: string, options?: { verbose?: boolean }) {
	printInfo("Checking for updates...")

	const { updateCommand, packageManager } = getInstallationInfo()

	try {
		const latestVersion = await getLatestVersion()
		if (!latestVersion) {
			printWarning("Failed to check for updates: could not fetch latest version")
			exit(1)
		}

		if (options?.verbose) {
			printInfo(`Current version: ${currentVersion}`)
			printInfo(`Latest version: ${latestVersion}`)
			printInfo(`Package manager: ${packageManager}`)
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

		if (!updateCommand) {
			printInfo("Unable to determine update command for your installation.")
			printInfo("Please update manually using your package manager.")
			exit(0)
		}

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

		printInfo(`Installing update via ${packageManager}...`)

		const updateProcess = spawn(updateCommand, {
			stdio: "inherit",
			shell: true,
			env: process.env,
			windowsHide: true,
		})

		updateProcess.on("close", (code) => {
			if (code === 0) {
				printInfo(`Successfully updated to version ${latestVersion}`)
				exit(0)
			} else {
				printWarning(`Update failed. Please try running: ${updateCommand}`)
				exit(1)
			}
		})

		updateProcess.on("error", (err) => {
			printWarning(`Failed to run update: ${err.message}`)
			printInfo(`Please try running manually: ${updateCommand}`)
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
