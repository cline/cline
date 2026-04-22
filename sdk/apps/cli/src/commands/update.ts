import { type ChildProcess, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolveSharedHubOwnerContext } from "@clinebot/core";
import { probeHubServer, readHubDiscovery } from "@clinebot/hub";
import { version } from "../../package.json";
import { ensureCliHubServer } from "../utils/hub-runtime";
import { c, writeErr, writeln } from "../utils/output";

const PACKAGE_NAME = "@clinebot/cli";

export enum PackageManager {
	NPM = "npm",
	PNPM = "pnpm",
	YARN = "yarn",
	BUN = "bun",
	NPX = "npx",
	UNKNOWN = "unknown",
}

interface InstallationInfo {
	packageManager: PackageManager;
	updateCommand?: string;
}

function isNightlyVersion(v: string): boolean {
	return v.includes("-nightly.");
}

function getNpmTag(v: string): string {
	return isNightlyVersion(v) ? "nightly" : "latest";
}

interface ParsedVersion {
	base: number[];
	isNightly: boolean;
	timestamp: number;
}

function parseVersion(v: string): ParsedVersion {
	const m = v.match(/^(\d+\.\d+\.\d+)-nightly\.(\d+)$/);
	if (m) {
		return {
			base: m[1].split(".").map(Number),
			isNightly: true,
			timestamp: Number.parseInt(m[2], 10),
		};
	}
	return { base: v.split(".").map(Number), isNightly: false, timestamp: 0 };
}

function compareVersions(v1: string, v2: string): number {
	const p1 = parseVersion(v1);
	const p2 = parseVersion(v2);
	for (let i = 0; i < Math.max(p1.base.length, p2.base.length); i++) {
		const a = p1.base[i] || 0;
		const b = p2.base[i] || 0;
		if (a > b) return 1;
		if (a < b) return -1;
	}
	if (p1.isNightly && !p2.isNightly) return -1;
	if (!p1.isNightly && p2.isNightly) return 1;
	if (p1.isNightly && p2.isNightly) {
		if (p1.timestamp > p2.timestamp) return 1;
		if (p1.timestamp < p2.timestamp) return -1;
	}
	return 0;
}

function getInstallationInfo(currentVersion: string): InstallationInfo {
	const tag = getNpmTag(currentVersion);
	try {
		const scriptPath = realpathSync(process.argv[1] || "").replace(/\\/g, "/");

		if (scriptPath.includes("/.npm/_npx") || scriptPath.includes("/npm/_npx")) {
			return { packageManager: PackageManager.NPX };
		}
		if (
			scriptPath.includes("/.pnpm/global") ||
			scriptPath.includes("/pnpm/global")
		) {
			return {
				packageManager: PackageManager.PNPM,
				updateCommand: `pnpm add -g ${PACKAGE_NAME}@${tag}`,
			};
		}
		if (scriptPath.includes("/.yarn/") || scriptPath.includes("/yarn/global")) {
			return {
				packageManager: PackageManager.YARN,
				updateCommand: `yarn global add ${PACKAGE_NAME}@${tag}`,
			};
		}
		if (scriptPath.includes("/.bun/bin")) {
			return {
				packageManager: PackageManager.BUN,
				updateCommand: `bun add -g ${PACKAGE_NAME}@${tag}`,
			};
		}
		if (scriptPath.includes("/node_modules/")) {
			return {
				packageManager: PackageManager.NPM,
				updateCommand: `npm install -g ${PACKAGE_NAME}@${tag}`,
			};
		}
	} catch {
		// Fall through to unknown
	}
	return { packageManager: PackageManager.UNKNOWN };
}

async function getLatestVersion(
	currentVersion: string,
): Promise<string | null> {
	const tag = getNpmTag(currentVersion);
	try {
		const res = await fetch(
			`https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/${tag}`,
		);
		if (!res.ok) return null;
		const data = (await res.json()) as { version: string };
		return data.version || null;
	} catch {
		return null;
	}
}

function waitForProcessExit(child: ChildProcess): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		child.once("close", (code) => resolve(code ?? 1));
		child.once("error", reject);
	});
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Restart the hub server if one is currently running.
 * Sends SIGTERM to the running hub process, waits for it to stop, then
 * re-ensures a new instance is spawned so clients reconnect to the updated binary.
 */
async function restartHubServerIfRunning(): Promise<void> {
	const owner = resolveSharedHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath).catch(
		() => undefined,
	);

	const health = discovery?.url
		? await probeHubServer(discovery.url).catch(() => undefined)
		: undefined;
	if (!health?.url) return;

	const pid = discovery?.pid;
	writeln(`${c.dim}[hub] restarting server…${c.reset}`);

	if (pid) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// best-effort
		}
	}

	// Wait for the server to fully stop (up to ~3 s).
	for (let i = 0; i < 30; i++) {
		const check = discovery?.url
			? await probeHubServer(discovery.url).catch(() => undefined)
			: undefined;
		if (!check?.url) break;
		await sleep(100);
	}

	// Re-ensure a fresh hub instance is spawned.
	try {
		await ensureCliHubServer(process.cwd());
		writeln(`${c.green}✓${c.reset} ${c.dim}[hub] server restarted${c.reset}`);
	} catch (err) {
		writeErr(
			`[hub] failed to restart server: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * Non-blocking auto-update check for CLI startup.
 * Spawns a detached install process if a newer version is available.
 * Skipped for npx, dev, unknown installs. Disable with CLINE_NO_AUTO_UPDATE=1.
 */
export function autoUpdateOnStartup(): void {
	if (process.env.IS_DEV === "true") return;
	if (process.env.CLINE_NO_AUTO_UPDATE === "1") return;

	const { updateCommand } = getInstallationInfo(version);
	if (!updateCommand) return;

	void (async () => {
		try {
			const latest = await getLatestVersion(version);
			if (!latest || compareVersions(version, latest) >= 0) return;
			const child = spawn(updateCommand, {
				shell: true,
				detached: true,
				stdio: "ignore",
				env: process.env,
			});
			const exitCode = await waitForProcessExit(child);
			if (exitCode === 0) {
				await restartHubServerIfRunning();
			}
		} catch {
			// Best-effort — silently ignore
		}
	})();
}

export interface CheckForUpdatesOptions {
	verbose?: boolean;
}

/**
 * Manual update: fetch latest version, print status, run the install command.
 * Returns an exit code.
 */
export async function checkForUpdates(
	options: CheckForUpdatesOptions = {},
): Promise<number> {
	const currentVersion = version;
	writeln(`${c.cyan}Checking for updates…${c.reset}`);

	const { updateCommand, packageManager } = getInstallationInfo(currentVersion);

	try {
		const latestVersion = await getLatestVersion(currentVersion);

		if (options.verbose) {
			writeln(`${c.dim}Current version: ${currentVersion}${c.reset}`);
			writeln(`${c.dim}Package manager: ${packageManager}${c.reset}`);
			if (latestVersion) {
				writeln(`${c.dim}Latest version:  ${latestVersion}${c.reset}`);
			}
		}

		if (!latestVersion) {
			writeErr("Failed to check for updates: could not fetch latest version");
			return 1;
		}

		if (compareVersions(currentVersion, latestVersion) >= 0) {
			writeln(
				`${c.green}✓${c.reset} Already on the latest version ${c.bold}${currentVersion}${c.reset}`,
			);
			return 0;
		}

		writeln(
			`${c.yellow}New version available:${c.reset} ${c.bold}${latestVersion}${c.reset} (current: ${currentVersion})`,
		);

		if (!updateCommand) {
			writeln(
				`${c.dim}Unable to determine update command. Please update manually with your package manager.${c.reset}`,
			);
			return 1;
		}

		writeln(`${c.cyan}Installing ${PACKAGE_NAME}@${latestVersion}…${c.reset}`);
		const updateProcess = spawn(updateCommand, {
			stdio: "inherit",
			shell: true,
			env: process.env,
			windowsHide: true,
		});
		const exitCode = await waitForProcessExit(updateProcess);

		if (exitCode === 0) {
			writeln(
				`${c.green}✓${c.reset} Updated to ${c.bold}${PACKAGE_NAME}@${latestVersion}${c.reset}`,
			);
			await restartHubServerIfRunning();
			return 0;
		}

		writeErr(
			`Update failed (exit code ${exitCode}). Try running: ${updateCommand}`,
		);
		return 1;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeErr(`Error checking for updates: ${message}`);
		return 1;
	}
}
