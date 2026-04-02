import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { exit } from "node:process"
import { ClineEndpoint } from "@/config"
import { fetch } from "@/shared/net"
import { printInfo, printSuccess, printWarning } from "./display"
import { resolveKanbanInstallCommand, spawnKanbanInstallProcess } from "./kanban"

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

interface CheckForUpdatesOptions {
	verbose?: boolean
	includeKanban?: boolean
}

/**
 * Check if a version string is a nightly build.
 */
function isNightlyVersion(version: string): boolean {
	return version.includes("-nightly.")
}

/**
 * Get the npm tag to use based on the current version.
 */
function getNpmTag(currentVersion: string): string {
	return isNightlyVersion(currentVersion) ? "nightly" : "latest"
}

/**
 * Detect how the CLI was installed and return the appropriate update command.
 * Uses the correct npm tag based on whether the current version is nightly.
 */
function getInstallationInfo(currentVersion: string): InstallationInfo {
	const tag = getNpmTag(currentVersion)

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
				updateCommand: `pnpm add -g cline@${tag}`,
			}
		}

		// yarn global
		if (scriptPath.includes("/.yarn/") || scriptPath.includes("/yarn/global")) {
			return {
				packageManager: PackageManager.YARN,
				updateCommand: `yarn global add cline@${tag}`,
			}
		}

		// bun global
		if (scriptPath.includes("/.bun/bin")) {
			return {
				packageManager: PackageManager.BUN,
				updateCommand: `bun add -g cline@${tag}`,
			}
		}

		// npm global (node_modules/cline)
		if (scriptPath.includes("/node_modules/cline/")) {
			return {
				packageManager: PackageManager.NPM,
				updateCommand: `npm install -g cline@${tag}`,
			}
		}
	} catch {
		// If we can't resolve the path, assume unknown
	}

	return { packageManager: PackageManager.UNKNOWN }
}

/**
 * Fetch the latest version from npm registry.
 * Uses the appropriate tag based on whether the current version is nightly.
 */
async function getLatestVersion(currentVersion: string): Promise<string | null> {
	return getLatestPackageVersion("cline", getNpmTag(currentVersion))
}

async function getLatestPackageVersion(packageName: string, tag = "latest"): Promise<string | null> {
	try {
		const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/${tag}`)
		if (!response.ok) return null
		const data = (await response.json()) as { version: string }
		return data.version || null
	} catch {
		return null
	}
}

async function getLatestKanbanVersion(): Promise<string | null> {
	return getLatestPackageVersion("kanban")
}

function getInstalledKanbanVersion(): string | null {
	try {
		const command = process.platform === "win32" ? "kanban.cmd" : "kanban"
		const result = spawnSync(command, ["--version"], {
			encoding: "utf8",
			shell: process.platform === "win32",
		})
		if (result.status !== 0) {
			return null
		}

		const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
		const versionMatch = output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)
		return versionMatch?.[0] ?? null
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
 * Skipped for npx, local dev, unknown installations, and bundled enterprise packages.
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

	// Skip if using bundled enterprise config (single source of truth)
	if (ClineEndpoint.isBundledConfig()) {
		return
	}

	const { updateCommand } = getInstallationInfo(currentVersion)
	if (!updateCommand) {
		return
	}

	// Async version check - non-blocking, fire and forget
	checkAndUpdate(currentVersion, updateCommand)
}

async function checkAndUpdate(currentVersion: string, updateCommand: string): Promise<void> {
	try {
		const latestVersion = await getLatestVersion(currentVersion)
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

async function waitForProcessExit(updateProcess: ChildProcess): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		updateProcess.once("close", (code) => {
			resolve(code ?? 1)
		})

		updateProcess.once("error", (error) => {
			reject(error)
		})
	})
}

async function runClineUpdate(updateCommand: string): Promise<number> {
	const updateProcess = spawn(updateCommand, {
		stdio: "inherit",
		shell: true,
		env: process.env,
		windowsHide: true,
	})

	return waitForProcessExit(updateProcess)
}

type KanbanInstallCommand = NonNullable<ReturnType<typeof resolveKanbanInstallCommand>>

async function runKanbanUpdate(installCommand: KanbanInstallCommand): Promise<number> {
	const updateProcess = spawnKanbanInstallProcess(installCommand, {
		env: process.env,
		windowsHide: true,
	})
	return waitForProcessExit(updateProcess)
}

function formatUpdateSummaryTargets(targets: string[]): string {
	if (targets.length === 0) {
		return ""
	}
	if (targets.length === 1) {
		return targets[0]
	}
	if (targets.length === 2) {
		return `${targets[0]} and ${targets[1]}`
	}
	return `${targets.slice(0, -1).join(", ")}, and ${targets.at(-1)}`
}

/**
 * Check for updates and install if available (manual command)
 */
export async function checkForUpdates(currentVersion: string, options: CheckForUpdatesOptions = {}) {
	const includeKanban = options.includeKanban ?? true

	printInfo("Checking for updates to cline and kanban packages...")

	const { updateCommand, packageManager } = getInstallationInfo(currentVersion)

	try {
		const latestClineVersion = await getLatestVersion(currentVersion)
		const canCheckClineVersion = latestClineVersion !== null

		if (options?.verbose) {
			printInfo(`Current version: ${currentVersion}`)
			printInfo(`Package manager: ${packageManager}`)
			if (canCheckClineVersion) {
				printInfo(`Latest version: ${latestClineVersion}`)
			}
		}

		if (!canCheckClineVersion) {
			printWarning("Failed to check for Cline updates: could not fetch latest version")
		}

		const clineComparison = latestClineVersion ? compareVersions(currentVersion, latestClineVersion) : null
		const clineUpdateAvailable = clineComparison !== null && clineComparison < 0
		const clineIsUpToDate = clineComparison !== null && clineComparison === 0
		const canUpdateCline = clineUpdateAvailable && Boolean(updateCommand)

		if (clineUpdateAvailable && latestClineVersion) {
			printInfo(`New version available: ${latestClineVersion} (current: ${currentVersion})`)
		}

		if (clineUpdateAvailable && !updateCommand) {
			printInfo("Unable to determine Cline update command for your installation.")
			printInfo("Please update Cline manually using your package manager.")
		}

		const kanbanInstallCommand = includeKanban ? resolveKanbanInstallCommand() : null
		const kanbanInstallerAvailable = kanbanInstallCommand !== null
		if (includeKanban && !kanbanInstallerAvailable && options.verbose) {
			printWarning("Unable to determine Kanban update command (npm, pnpm, or bun not found in PATH).")
		}
		const latestKanbanVersion = kanbanInstallerAvailable ? await getLatestKanbanVersion() : null
		const installedKanbanVersion = includeKanban ? getInstalledKanbanVersion() : null
		const kanbanIsUpToDate =
			latestKanbanVersion !== null &&
			installedKanbanVersion !== null &&
			compareVersions(installedKanbanVersion, latestKanbanVersion) >= 0
		const shouldInstallKanban =
			kanbanInstallerAvailable &&
			latestKanbanVersion !== null &&
			(installedKanbanVersion === null || compareVersions(installedKanbanVersion, latestKanbanVersion) < 0)

		if (!canCheckClineVersion && !shouldInstallKanban) {
			exit(1)
		}

		if (!canUpdateCline && !shouldInstallKanban) {
			if (clineIsUpToDate && kanbanIsUpToDate && installedKanbanVersion) {
				printInfo(`You are already on the latest version cline@${currentVersion} and kanban@${installedKanbanVersion}`)
			} else if (clineIsUpToDate) {
				printInfo(`You are already on the latest version cline@${currentVersion}`)
			}
			exit(0)
		}

		let hadFailure = false
		const installedUpdates: string[] = []

		if (canUpdateCline && updateCommand && latestClineVersion) {
			printInfo(`Installing cline@${latestClineVersion}...`)
			try {
				const clineUpdateCode = await runClineUpdate(updateCommand)
				if (clineUpdateCode === 0) {
					installedUpdates.push(`cline@${latestClineVersion}`)
				} else {
					printWarning(`Cline update failed. Please try running: ${updateCommand}`)
					hadFailure = true
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				printWarning(`Failed to run Cline update: ${message}`)
				printInfo(`Please try running manually: ${updateCommand}`)
				hadFailure = true
			}
		}

		if (shouldInstallKanban && kanbanInstallCommand && latestKanbanVersion) {
			const kanbanTargetVersion = latestKanbanVersion ?? "latest"
			printInfo(`Installing kanban@${kanbanTargetVersion}...`)
			try {
				const kanbanUpdateCode = await runKanbanUpdate(kanbanInstallCommand)
				if (kanbanUpdateCode === 0) {
					installedUpdates.push(`kanban@${kanbanTargetVersion}`)
				} else {
					printWarning(`Kanban update failed. Please try running: ${kanbanInstallCommand.displayCommand}`)
					hadFailure = true
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				printWarning(`Failed to run Kanban update: ${message}`)
				if (kanbanInstallCommand) {
					printInfo(`Please try running manually: ${kanbanInstallCommand.displayCommand}`)
				}
				hadFailure = true
			}
		}

		if (!hadFailure) {
			if (installedUpdates.length > 1) {
				printSuccess(`Installed updates for ${formatUpdateSummaryTargets(installedUpdates)}`)
			} else if (installedUpdates.length === 1) {
				printSuccess(`Installed update for ${installedUpdates[0]}`)
			} else {
				printInfo("No updates were installed.")
			}
		}

		if (hadFailure) {
			exit(1)
		}

		if (canUpdateCline || shouldInstallKanban) {
			exit(0)
		}
		exit(1)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		printWarning(`Error checking for updates: ${message}`)
		exit(1)
	}
}

interface ParsedVersion {
	base: number[]
	isNightly: boolean
	timestamp: number
}

/**
 * Parse a version string into its components.
 * Handles both stable versions (2.0.0) and nightly versions (2.0.0-nightly.1736365200).
 */
function parseVersion(version: string): ParsedVersion {
	const nightlyMatch = version.match(/^(\d+\.\d+\.\d+)-nightly\.(\d+)$/)
	if (nightlyMatch) {
		return {
			base: nightlyMatch[1].split(".").map(Number),
			isNightly: true,
			timestamp: Number.parseInt(nightlyMatch[2], 10),
		}
	}
	return {
		base: version.split(".").map(Number),
		isNightly: false,
		timestamp: 0,
	}
}

/**
 * Compare two semantic version strings.
 * Handles both stable versions and nightly versions.
 * Nightly versions are compared by their timestamps.
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
	const p1 = parseVersion(v1)
	const p2 = parseVersion(v2)

	// Compare base versions first
	for (let i = 0; i < Math.max(p1.base.length, p2.base.length); i++) {
		const part1 = p1.base[i] || 0
		const part2 = p2.base[i] || 0

		if (part1 > part2) return 1
		if (part1 < part2) return -1
	}

	// Base versions are equal, check nightly status
	// Nightly is considered less than stable (it's a pre-release)
	if (p1.isNightly && !p2.isNightly) return -1
	if (!p1.isNightly && p2.isNightly) return 1

	// Both are nightly, compare timestamps
	if (p1.isNightly && p2.isNightly) {
		if (p1.timestamp > p2.timestamp) return 1
		if (p1.timestamp < p2.timestamp) return -1
	}

	return 0
}
