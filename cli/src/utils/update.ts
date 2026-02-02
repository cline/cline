import { spawn } from "node:child_process"
import { realpathSync } from "node:fs"
import { exit } from "node:process"
import { fetch } from "@/shared/net"
import { printInfo, printWarning } from "./display"

/**
 * Check if cline was installed via npm global install.
 * Only returns true for paths that look like npm global installs.
 */
function isNpmGlobalInstall(): boolean {
	try {
		// Resolve symlinks to get the real path
		// npm global bin is a symlink: /usr/local/bin/cline -> ../lib/node_modules/cline/dist/cli.mjs
		const scriptPath = realpathSync(process.argv[1] || "")

		// npm global installs are in node_modules/cline/
		// e.g. /usr/local/lib/node_modules/cline/dist/cli.mjs
		// e.g. ~/.npm-global/lib/node_modules/cline/dist/cli.mjs
		if (scriptPath.includes("/node_modules/cline/") || scriptPath.includes("\\node_modules\\cline\\")) {
			return true
		}
	} catch {
		// If we can't resolve the path, assume not npm global
	}

	return false
}

/**
 * Auto-update check that runs on CLI startup.
 * Runs completely in the background - no blocking, no latency impact.
 * If a new version is found, it installs silently. User gets it next run.
 *
 * Only runs for npm global installs. Skipped for Homebrew, local dev, etc.
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

	// Only auto-update for npm global installs
	if (!isNpmGlobalInstall()) {
		return
	}

	// Spawn a detached background process to check and install
	// This runs completely independently - no impact on main CLI startup
	const updateScript = `
		const https = require('https');
		const { execSync } = require('child_process');

		const currentVersion = '${currentVersion}';

		https.get('https://registry.npmjs.org/cline/latest', (res) => {
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				try {
					const latest = JSON.parse(data).version;
					if (latest && latest !== currentVersion) {
						// Compare versions
						const cur = currentVersion.split('.').map(Number);
						const lat = latest.split('.').map(Number);
						let needsUpdate = false;
						for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
							if ((lat[i] || 0) > (cur[i] || 0)) { needsUpdate = true; break; }
							if ((lat[i] || 0) < (cur[i] || 0)) { break; }
						}
						if (needsUpdate) {
							execSync('npm install -g cline@latest', { stdio: 'ignore' });
						}
					}
				} catch {}
			});
		}).on('error', () => {});
	`

	const child = spawn(process.execPath, ["-e", updateScript], {
		detached: true,
		stdio: "ignore",
		env: process.env,
	})

	// Unref so the parent can exit independently
	child.unref()
}

/**
 * Check for updates and install if available (manual command)
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
