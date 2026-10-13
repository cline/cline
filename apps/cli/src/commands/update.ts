import { type ChildProcess, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import {
	isAutoUpdateEnabledGlobally,
	NodeHubClient,
	readHubDiscovery,
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
} from "@cline/core";
import { resolveClineBuildEnv } from "@cline/shared";
import { version } from "../../package.json";
import { c, writeErr, writeln } from "../utils/output";
import {
	getInstalledKanbanVersion,
	type KanbanInstaller,
	resolveKanbanInstallCommand,
	spawnKanbanInstallProcess,
} from "./kanban";

const DEFAULT_PACKAGE_NAME = "cline";

type CliPackageName = typeof DEFAULT_PACKAGE_NAME;

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
	packageName: CliPackageName;
	updateCommand?: string;
}

interface ManualUpdateCommand {
	command: string;
	env?: Readonly<Record<string, string>>;
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

export function getInstallationInfo(currentVersion: string): InstallationInfo {
	const tag = getNpmTag(currentVersion);
	try {
		const scriptPath = realpathSync(
			process.env.CLINE_WRAPPER_PATH || process.argv[1] || "",
		).replace(/\\/g, "/");

		if (scriptPath.includes("/.npm/_npx") || scriptPath.includes("/npm/_npx")) {
			return {
				packageManager: PackageManager.NPX,
				packageName: DEFAULT_PACKAGE_NAME,
			};
		}
		if (
			scriptPath.includes("/.pnpm/global") ||
			scriptPath.includes("/pnpm/global")
		) {
			return {
				packageManager: PackageManager.PNPM,
				packageName: DEFAULT_PACKAGE_NAME,
				updateCommand: `pnpm add -g ${DEFAULT_PACKAGE_NAME}@${tag}`,
			};
		}
		if (scriptPath.includes("/.yarn/") || scriptPath.includes("/yarn/global")) {
			return {
				packageManager: PackageManager.YARN,
				packageName: DEFAULT_PACKAGE_NAME,
				updateCommand: `yarn global add ${DEFAULT_PACKAGE_NAME}@${tag}`,
			};
		}
		// `bun add -g` symlinks bins into ~/.bun/bin, but realpathSync resolves
		// them to ~/.bun/install/global/node_modules/..., so match both.
		if (
			scriptPath.includes("/.bun/bin") ||
			scriptPath.includes("/.bun/install/global/")
		) {
			return {
				packageManager: PackageManager.BUN,
				packageName: DEFAULT_PACKAGE_NAME,
				updateCommand: `bun add -g ${DEFAULT_PACKAGE_NAME}@${tag}`,
			};
		}
		if (scriptPath.includes("/node_modules/")) {
			return {
				packageManager: PackageManager.NPM,
				packageName: DEFAULT_PACKAGE_NAME,
				updateCommand: `npm update -g ${DEFAULT_PACKAGE_NAME} --tag ${tag}`,
			};
		}
	} catch {
		// Fall through to unknown
	}
	return {
		packageManager: PackageManager.UNKNOWN,
		packageName: DEFAULT_PACKAGE_NAME,
	};
}

export function withMinimumReleaseAgeBypass(
	updateCommand: string,
	packageManager: PackageManager,
): ManualUpdateCommand {
	switch (packageManager) {
		case PackageManager.NPM:
			return { command: `${updateCommand} --min-release-age=0` };
		case PackageManager.PNPM:
			return {
				command: updateCommand,
				env: {
					PNPM_CONFIG_MINIMUM_RELEASE_AGE: "0",
					pnpm_config_minimum_release_age: "0",
					npm_config_minimum_release_age: "0",
				},
			};
		case PackageManager.YARN:
			return {
				command: updateCommand,
				env: { YARN_NPM_MINIMAL_AGE_GATE: "0" },
			};
		case PackageManager.BUN:
			return { command: `${updateCommand} --minimum-release-age=0` };
		default:
			return { command: updateCommand };
	}
}

async function getLatestVersion(
	packageName: CliPackageName,
	currentVersion: string,
): Promise<string | null> {
	const tag = getNpmTag(currentVersion);
	return getLatestPackageVersion(packageName, tag);
}

async function getLatestPackageVersion(
	packageName: string,
	tag = "latest",
): Promise<string | null> {
	try {
		const res = await fetch(
			`https://registry.npmjs.org/${encodeURIComponent(packageName)}/${tag}`,
		);
		if (!res.ok) return null;
		const data = (await res.json()) as { version: string };
		return data.version || null;
	} catch {
		return null;
	}
}

async function getLatestKanbanVersion(): Promise<string | null> {
	return getLatestPackageVersion("kanban");
}

function waitForProcessExit(child: ChildProcess): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		child.once("close", (code) => resolve(code ?? 1));
		child.once("error", reject);
	});
}

async function runCliUpdate(
	updateCommand: ManualUpdateCommand,
): Promise<number> {
	const updateProcess = spawn(updateCommand.command, {
		stdio: "inherit",
		shell: true,
		env: updateCommand.env
			? { ...process.env, ...updateCommand.env }
			: process.env,
		windowsHide: true,
	});
	return waitForProcessExit(updateProcess);
}

type KanbanInstallCommand = NonNullable<
	ReturnType<typeof resolveKanbanInstallCommand>
>;

async function runKanbanUpdate(
	installCommand: KanbanInstallCommand,
): Promise<number> {
	const updateProcess = spawnKanbanInstallProcess(installCommand, {
		env: process.env,
		windowsHide: true,
	});
	return waitForProcessExit(updateProcess);
}

function formatUpdateSummaryTargets(targets: string[]): string {
	if (targets.length === 0) {
		return "";
	}
	if (targets.length === 1) {
		return targets[0] ?? "";
	}
	if (targets.length === 2) {
		return `${targets[0]} and ${targets[1]}`;
	}
	const lastTarget = targets[targets.length - 1];
	return `${targets.slice(0, -1).join(", ")}, and ${lastTarget}`;
}

function packageManagerToKanbanInstaller(
	packageManager: PackageManager,
): KanbanInstaller | undefined {
	switch (packageManager) {
		case PackageManager.NPM:
			return "npm";
		case PackageManager.PNPM:
			return "pnpm";
		case PackageManager.BUN:
			return "bun";
		default:
			return undefined;
	}
}

export function getPreferredKanbanInstaller(
	currentVersion = version,
): KanbanInstaller | undefined {
	return packageManagerToKanbanInstaller(
		getInstallationInfo(currentVersion).packageManager,
	);
}

export function resolveCliHubOwnerContext() {
	return resolveClineBuildEnv() === "production"
		? resolveProductionHubOwnerContext()
		: resolveSharedHubOwnerContext();
}

let pendingAutoUpdate: ManualUpdateCommand | undefined;
let pendingAutoUpdateCheck: Promise<void> | undefined;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// How long the exit sequence will wait for a still-in-flight startup version
// check before giving up on it. Long enough for a typical registry response,
// short enough that one-shot commands do not feel it.
const UPDATE_CHECK_EXIT_GRACE_MS = 250;

// Hard cap on the exit-time hub query. The hub client's default connect and
// command timeouts add up to tens of seconds against a wedged hub, and this
// runs while the user is waiting for their shell prompt back.
const CLIENT_COUNT_EXIT_TIMEOUT_MS = 3_000;

/**
 * Non-blocking auto-update check for CLI startup.
 *
 * Deliberately does NOT install right away: replacing the npm package while
 * cline processes are running swaps the binary under them — their respawn
 * paths break on the new build fingerprint — and historically also restarted
 * the hub daemon out from under live sessions. The check only records that an
 * update is available; the CLI entrypoint calls applyDeferredUpdate() from
 * its exit sequence (an explicit process.exit() follows, so a beforeExit hook
 * would never fire), and the install runs only when no other CLI is attached
 * to the hub — at that point nothing is running that the swap could hurt.
 * The next launch picks up the new binary and a fresh hub.
 *
 * Skipped for npx, dev, unknown installs. Disable with CLINE_NO_AUTO_UPDATE=1.
 */
export function autoUpdateOnStartup(): void {
	if (process.env.IS_DEV === "true") return;
	if (process.env.CLINE_NO_AUTO_UPDATE === "1") return;
	if (!isAutoUpdateEnabledGlobally()) return;

	const { packageName, packageManager, updateCommand } =
		getInstallationInfo(version);
	if (!updateCommand) return;

	pendingAutoUpdateCheck = (async () => {
		try {
			const latest = await getLatestVersion(packageName, version);
			if (!latest || compareVersions(version, latest) >= 0) return;
			pendingAutoUpdate = withMinimumReleaseAgeBypass(
				updateCommand,
				packageManager,
			);
		} catch {
			// Best-effort, silently ignore
		}
	})();
}

/**
 * True when a hub is reachable and another cli* client is attached to it.
 * Only cli* clients run the npm-installed binary — desktop sidecars and
 * connectors ship their own — so only they make the swap unsafe. This runs
 * after the entrypoint's disposeAll(), so this process's own registrations
 * are closed and any cli client still listed belongs to another process. Errors count as attached:
 * never install unless the hub positively confirms nothing would be hurt.
 */
async function otherCliClientsAttached(): Promise<boolean> {
	const owner = resolveCliHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath).catch(
		() => undefined,
	);
	if (!discovery?.url) {
		return false;
	}
	const client = new NodeHubClient({
		url: discovery.url,
		authToken: discovery.authToken,
		clientType: "cli-update-check",
		displayName: "cline update check",
	});
	try {
		const reply = await client.command("client.list", {}, undefined, {
			timeoutMs: CLIENT_COUNT_EXIT_TIMEOUT_MS,
		});
		const clients =
			(reply.payload as { clients?: Array<{ clientType?: unknown }> })
				.clients ?? [];
		if (
			clients.some(
				(entry) =>
					typeof entry?.clientType === "string" &&
					entry.clientType.startsWith("cli") &&
					entry.clientType !== "cli-update-check",
			)
		) {
			return true;
		}
		// A TUI's registration can be lost in transport churn while its session
		// connection survives (observed in review), so an empty client list is
		// not proof of safety. Cross-check for sessions somebody is attached to.
		// Participants, not session status: finished sessions can linger idle
		// forever and must not pin updates, and participant-less scheduled runs
		// live in the hub process, which a binary swap does not touch.
		const sessions = await client.command(
			"session.list",
			{ limit: 500 },
			undefined,
			{ timeoutMs: CLIENT_COUNT_EXIT_TIMEOUT_MS },
		);
		const sessionRecords =
			(sessions.payload as { sessions?: Array<{ participants?: unknown }> })
				.sessions ?? [];
		return sessionRecords.some(
			(session) =>
				Array.isArray(session?.participants) && session.participants.length > 0,
		);
	} finally {
		await client.dispose().catch(() => undefined);
	}
}

/**
 * Spawns the recorded update install, detached, if no other CLI would be
 * affected by the package swap. Fire-and-forget: the install outlives this
 * process and its postinstall never blocks an exit.
 */
export async function applyDeferredUpdate(
	pending?: ManualUpdateCommand,
): Promise<"none" | "deferred" | "started"> {
	if (!pending) {
		// Short-lived commands can reach exit before the startup version check
		// resolves; give it a brief grace so one-shot-only usage still updates.
		if (pendingAutoUpdateCheck) {
			await Promise.race([
				pendingAutoUpdateCheck,
				sleep(UPDATE_CHECK_EXIT_GRACE_MS),
			]);
		}
		pending = pendingAutoUpdate;
	}
	if (!pending) {
		return "none";
	}
	// The whole query is bounded: the user is waiting on their prompt, and a
	// wedged hub must not turn a finished command into a hung one. A timeout
	// counts as "attached" — never install unless the hub positively confirms.
	const attached = await Promise.race([
		otherCliClientsAttached(),
		sleep(CLIENT_COUNT_EXIT_TIMEOUT_MS).then(() => true),
	]).catch(() => true);
	if (attached) {
		return "deferred";
	}
	pendingAutoUpdate = undefined;
	const child = spawn(pending.command, {
		shell: true,
		detached: true,
		stdio: "ignore",
		env: pending.env ? { ...process.env, ...pending.env } : process.env,
		// Prevent a console window from flashing on Windows; detached
		// processes otherwise allocate a new visible console.
		windowsHide: true,
	});
	child.unref();
	return "started";
}

export interface CheckForUpdatesOptions {
	verbose?: boolean;
	includeKanban?: boolean;
}

/**
 * Manual update: fetch latest version, print status, run the install command.
 * Returns an exit code.
 */
export async function checkForUpdates(
	options: CheckForUpdatesOptions = {},
): Promise<number> {
	const currentVersion = version;
	const includeKanban = options.includeKanban ?? true;
	writeln(
		`${c.cyan}Checking for updates${includeKanban ? " to Cline CLI and kanban" : ""}…${c.reset}`,
	);

	const { packageName, updateCommand, packageManager } =
		getInstallationInfo(currentVersion);

	try {
		const latestVersion = await getLatestVersion(packageName, currentVersion);
		const kanbanInstallCommand = includeKanban
			? resolveKanbanInstallCommand(
					process.env,
					process.platform,
					packageManagerToKanbanInstaller(packageManager),
				)
			: null;
		const latestKanbanVersion = kanbanInstallCommand
			? await getLatestKanbanVersion()
			: null;
		const installedKanbanVersion = includeKanban
			? getInstalledKanbanVersion()
			: null;
		const shouldUpdateKanban =
			kanbanInstallCommand !== null &&
			latestKanbanVersion !== null &&
			(installedKanbanVersion === null ||
				compareVersions(installedKanbanVersion, latestKanbanVersion) < 0);

		if (options.verbose) {
			writeln(`${c.dim}Current version: ${currentVersion}${c.reset}`);
			writeln(`${c.dim}Package manager: ${packageManager}${c.reset}`);
			writeln(`${c.dim}Package name:    ${packageName}${c.reset}`);
			if (latestVersion) {
				writeln(`${c.dim}Latest version:  ${latestVersion}${c.reset}`);
			}
			if (includeKanban) {
				writeln(
					`${c.dim}Kanban version:  ${installedKanbanVersion ?? "(not installed)"}${c.reset}`,
				);
				if (latestKanbanVersion) {
					writeln(`${c.dim}Latest kanban:   ${latestKanbanVersion}${c.reset}`);
				}
				if (!kanbanInstallCommand) {
					writeln(
						`${c.dim}Kanban installer: unavailable (npm, pnpm, or bun not found)${c.reset}`,
					);
				}
			}
		}

		if (!latestVersion && !shouldUpdateKanban) {
			writeErr("Failed to check for updates: could not fetch latest version");
			return 1;
		}

		const cliUpdateAvailable =
			latestVersion !== null &&
			compareVersions(currentVersion, latestVersion) < 0;
		const cliIsUpToDate =
			latestVersion !== null &&
			compareVersions(currentVersion, latestVersion) >= 0;

		if (!cliUpdateAvailable && !shouldUpdateKanban) {
			if (cliIsUpToDate && installedKanbanVersion && latestKanbanVersion) {
				writeln(
					`${c.green}✓${c.reset} Already on the latest versions ${c.bold}${packageName}@${currentVersion}${c.reset} and ${c.bold}kanban@${installedKanbanVersion}${c.reset}`,
				);
			} else if (cliIsUpToDate) {
				writeln(
					`${c.green}✓${c.reset} Already on the latest version ${c.bold}${currentVersion}${c.reset}`,
				);
			}
			return 0;
		}

		if (cliUpdateAvailable && latestVersion) {
			writeln(
				`${c.yellow}New version available:${c.reset} ${c.bold}${latestVersion}${c.reset} (current: ${currentVersion})`,
			);
		}

		let hadFailure = false;
		const installedUpdates: string[] = [];

		if (cliUpdateAvailable && latestVersion) {
			if (!updateCommand) {
				writeln(
					`${c.dim}Unable to determine Cline update command. Please update manually with your package manager.${c.reset}`,
				);
				hadFailure = true;
			} else {
				const manualUpdateCommand = withMinimumReleaseAgeBypass(
					updateCommand,
					packageManager,
				);
				writeln(
					`${c.cyan}Installing ${packageName}@${latestVersion}…${c.reset}`,
				);
				try {
					const exitCode = await runCliUpdate(manualUpdateCommand);
					if (exitCode === 0) {
						installedUpdates.push(`${packageName}@${latestVersion}`);
						writeln(
							`${c.dim}The update takes effect the next time cline starts.${c.reset}`,
						);
					} else {
						writeErr(
							`Cline update failed (exit code ${exitCode}). Try running: ${manualUpdateCommand.command}`,
						);
						hadFailure = true;
					}
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					writeErr(
						`Failed to run Cline update command ${manualUpdateCommand.command}: ${message}`,
					);
					hadFailure = true;
				}
			}
		}

		if (shouldUpdateKanban && kanbanInstallCommand && latestKanbanVersion) {
			writeln(`${c.cyan}Installing kanban@${latestKanbanVersion}…${c.reset}`);
			try {
				const exitCode = await runKanbanUpdate(kanbanInstallCommand);
				if (exitCode === 0) {
					installedUpdates.push(`kanban@${latestKanbanVersion}`);
				} else {
					writeErr(
						`Kanban update failed (exit code ${exitCode}). Try running: ${kanbanInstallCommand.displayCommand}`,
					);
					hadFailure = true;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				writeErr(
					`Failed to run Kanban update command ${kanbanInstallCommand.displayCommand}: ${message}`,
				);
				hadFailure = true;
			}
		}

		if (installedUpdates.length > 0) {
			const label =
				installedUpdates.length === 1
					? "Installed update for"
					: "Installed updates for";
			writeln(
				`${c.green}✓${c.reset} ${label} ${formatUpdateSummaryTargets(installedUpdates)}`,
			);
		}

		return hadFailure ? 1 : 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeErr(`Error checking for updates: ${message}`);
		return 1;
	}
}
