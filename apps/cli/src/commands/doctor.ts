import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	clearHubDiscovery,
	ensureFileExists,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
	resolveDefaultHubOwnerContext,
	stopLocalHubServerGracefully,
} from "@cline/core";
import { formatUptime } from "@cline/shared";
import { Command } from "commander";
import open from "open";
import { isProcessRunning } from "../connectors/common";
import {
	type ActiveConnectorRecord,
	listActiveConnectors,
} from "../connectors/status";
import { getCliBuildInfo } from "../utils/common";
import { c, writeln } from "../utils/output";
import { stopAllConnectors } from "./connect";

type DoctorIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

export type DoctorCommandDeps = {
	openPath?: (target: string) => Promise<void> | void;
};

type StartupArtifact = {
	path: string;
	pid?: number;
	acquiredAt?: string;
	stale: boolean;
};

type SpawnedProcessRecord = {
	timestamp?: string;
	pid?: number;
	command?: string;
	component?: string;
	detached?: boolean;
};

type DoctorStatus = {
	cwd: string;
	hubUrl?: string;
	hubHealthy: boolean;
	hubPid?: number;
	hubStartedAt?: string;
	hubUptime?: string;
	listeningPids: number[];
	staleHubPids: number[];
	hubStartupLocks: StartupArtifact[];
	staleCliPids: number[];
	staleSidecarPids: number[];
	activeConnectors: ActiveConnectorRecord[];
	recentSpawnedProcesses: SpawnedProcessRecord[];
};

type ProcessRecord = {
	pid: number;
	command: string;
};

function parsePids(raw: string): number[] {
	return raw
		.split(/\r?\n/)
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
}

function listMatchingProcesses(pattern: string): ProcessRecord[] {
	if (process.platform === "win32") {
		return [];
	}
	// "--" stops pgrep's option parsing so patterns that start with dashes
	// (e.g. the "--cline-hub-daemon" marker) are treated as patterns.
	const result = spawnSync("pgrep", ["-fal", "--", pattern], {
		encoding: "utf8",
	});
	if (result.status !== 0 && result.status !== 1) {
		return [];
	}
	const records = new Map<number, ProcessRecord>();
	for (const line of (result.stdout || "").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const match = trimmed.match(/^(\d+)\s+(.*)$/);
		if (!match) {
			continue;
		}
		const pid = Number.parseInt(match[1] || "", 10);
		const command = match[2]?.trim();
		if (
			!Number.isInteger(pid) ||
			pid <= 0 ||
			!command ||
			pid === process.pid ||
			pid === process.ppid
		) {
			continue;
		}
		records.set(pid, { pid, command });
	}
	return [...records.values()].sort((a, b) => a.pid - b.pid);
}

function resolveCliLogPath(): string {
	const { name } = getCliBuildInfo();
	return join(resolveClineDataDir(), "logs", `${name}.log`);
}

async function defaultOpenPath(target: string): Promise<void> {
	await open(target, { wait: false });
}

function listListeningPids(port: number | undefined): number[] {
	if (!port || process.platform === "win32") {
		return [];
	}
	const result = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		return [];
	}
	return parsePids(result.stdout);
}

function listStaleCliPids(): number[] {
	const patterns = [
		"/apps/cli/src/index.ts",
		"/apps/cli/dist/index.js",
		"/dist/cline",
	];
	const records = new Map<number, ProcessRecord>();
	for (const pattern of patterns) {
		for (const record of listMatchingProcesses(pattern)) {
			records.set(record.pid, record);
		}
	}
	return [...records.values()]
		.filter(
			(record) => !/(?:^|\s)(?:hub|rpc|connect)(?:\s|$)/.test(record.command),
		)
		.map((record) => record.pid);
}

function listStaleHubPids(currentHubPids: number[]): number[] {
	const current = new Set(currentHubPids.filter((pid) => pid > 0));
	const patterns = [
		"/sdk/packages/core/src/hub/daemon/entry.ts",
		"/sdk/packages/core/dist/hub/daemon/entry.js",
		"--cline-hub-daemon",
	];
	const records = new Map<number, ProcessRecord>();
	for (const pattern of patterns) {
		for (const record of listMatchingProcesses(pattern)) {
			if (current.has(record.pid) || /\bpgrep\s+-fal\b/.test(record.command)) {
				continue;
			}
			records.set(record.pid, record);
		}
	}
	return [...records.values()].map((record) => record.pid);
}

function listStaleSidecarPids(): number[] {
	const patterns = [
		"/apps/examples/desktop-app/sidecar/index.ts",
		"/apps/examples/desktop-app/dist/sidecar/index.js",
		// Keep the pre-example-reorg paths so `doctor --fix` can still clean up
		// stale sidecars that were launched from older checkouts.
		"/apps/code/sidecar/index.ts",
		"/apps/code/dist/sidecar/index.js",
		"/src-tauri/bin/code-sidecar",
		"/Resources/code-sidecar",
		" code-sidecar",
	];
	const records = new Map<number, ProcessRecord>();
	for (const pattern of patterns) {
		for (const record of listMatchingProcesses(pattern)) {
			records.set(record.pid, record);
		}
	}
	return [...records.values()].map((record) => record.pid);
}

function readRecentSpawnedProcesses(limit = 20): SpawnedProcessRecord[] {
	const logPath = resolveCliLogPath();
	if (!existsSync(logPath)) {
		return [];
	}
	try {
		const raw = readFileSync(logPath, "utf8");
		const lines = raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		const records: SpawnedProcessRecord[] = [];
		for (let index = lines.length - 1; index >= 0; index -= 1) {
			try {
				const parsed = JSON.parse(lines[index]) as Record<string, unknown>;
				if (parsed.msg !== "Process spawned") {
					continue;
				}
				records.push({
					timestamp: typeof parsed.time === "string" ? parsed.time : undefined,
					pid:
						typeof parsed.childPid === "number" ? parsed.childPid : undefined,
					command:
						typeof parsed.command === "string" ? parsed.command : undefined,
					component:
						typeof parsed.component === "string" ? parsed.component : undefined,
					detached:
						typeof parsed.detached === "boolean" ? parsed.detached : undefined,
				});
			} catch {
				// Ignore malformed lines.
			}
			if (records.length >= limit) {
				break;
			}
		}
		return records.reverse();
	} catch {
		return [];
	}
}

function readStartupArtifact(path: string): StartupArtifact | undefined {
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		const pid = typeof raw.pid === "number" ? raw.pid : undefined;
		const acquiredAt =
			typeof raw.acquiredAt === "string" ? raw.acquiredAt : undefined;
		return {
			path,
			pid,
			acquiredAt,
			stale: !isProcessRunning(pid ?? -1),
		};
	} catch {
		return {
			path,
			stale: true,
		};
	}
}

function listHubStartupLocks(_cwd: string): StartupArtifact[] {
	const owner = resolveCliHubOwnerContext();
	const ownerPath = join(`${owner.discoveryPath}.lock`, "owner.json");
	if (!existsSync(ownerPath)) {
		return [];
	}
	return [readStartupArtifact(ownerPath) ?? { path: ownerPath, stale: true }];
}

function clearPathIfExists(path: string): boolean {
	if (!existsSync(path)) {
		return false;
	}
	try {
		rmSync(path, { recursive: true, force: true });
		return true;
	} catch {
		return false;
	}
}

async function clearHubStartupArtifacts(
	_cwd: string,
	options?: { clearDiscovery?: boolean },
): Promise<{ startupLocks: number; discovery: number }> {
	const owner = resolveCliHubOwnerContext();
	const startupLocks = listHubStartupLocks(_cwd);
	let clearedStartupLocks = 0;
	for (const artifact of startupLocks) {
		if (artifact.stale && clearPathIfExists(dirname(artifact.path))) {
			clearedStartupLocks += 1;
		}
	}
	let clearedDiscovery = 0;
	if (options?.clearDiscovery && existsSync(owner.discoveryPath)) {
		await clearHubDiscovery(owner.discoveryPath);
		clearedDiscovery = 1;
	}
	return {
		startupLocks: clearedStartupLocks,
		discovery: clearedDiscovery,
	};
}

function formatHubUptimeFromStartedAt(
	startedAt: string | undefined,
): string | undefined {
	if (!startedAt) {
		return undefined;
	}
	const timestamp = Date.parse(startedAt);
	if (Number.isNaN(timestamp)) {
		return undefined;
	}
	return formatUptime(Date.now() - timestamp);
}

function resolveCliHubOwnerContext() {
	return resolveDefaultHubOwnerContext();
}

async function collectDoctorStatus(cwd: string): Promise<DoctorStatus> {
	const owner = resolveCliHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath);
	const health = discovery?.url
		? await probeHubServer(discovery.url, { authToken: discovery.authToken })
		: undefined;
	const current = health ?? discovery;
	const hubUptime = formatHubUptimeFromStartedAt(health?.startedAt);
	const listeningPids = listListeningPids(current?.port);
	const currentHubPids = [
		...(current?.pid ? [current.pid] : []),
		...listeningPids,
	];
	return {
		cwd,
		hubUrl: current?.url,
		hubHealthy: !!health?.url,
		hubPid: current?.pid,
		hubStartedAt: health?.startedAt,
		hubUptime,
		listeningPids,
		staleHubPids: listStaleHubPids(currentHubPids),
		hubStartupLocks: listHubStartupLocks(cwd),
		staleCliPids: listStaleCliPids(),
		staleSidecarPids: listStaleSidecarPids(),
		activeConnectors: listActiveConnectors(),
		recentSpawnedProcesses: readRecentSpawnedProcesses(),
	};
}

function formatPidList(label: string, pids: number[]): string {
	if (pids.length === 0) {
		return `${label} ${c.dim}0${c.reset}`;
	}
	return `${label} ${c.dim}${pids.join(", ")}${c.reset}`;
}

function formatRecentSpawnedProcess(record: SpawnedProcessRecord): string {
	const pieces = [
		record.timestamp ?? "unknown-time",
		record.component ?? "unknown-component",
		record.pid ? `pid=${record.pid}` : undefined,
		record.detached === undefined
			? undefined
			: `detached=${record.detached ? "yes" : "no"}`,
		record.command,
	].filter(Boolean);
	return pieces.join(" | ");
}

function formatActiveConnector(record: ActiveConnectorRecord): string {
	const identity =
		record.type === "telegram"
			? `bot=@${record.botUsername ?? "unknown"}`
			: record.type === "discord"
				? `user=${record.userName ?? "unknown"} app=${record.applicationId ?? "unknown"}`
				: `user=${record.userName ?? "unknown"}`;
	const pieces = [
		record.type,
		identity,
		`pid=${record.pid}`,
		`hub=${record.hubUrl}`,
		record.phoneNumberId ? `phone=${record.phoneNumberId}` : undefined,
		record.port ? `port=${record.port}` : undefined,
		record.baseUrl ? `url=${record.baseUrl}` : undefined,
		record.startedAt ? `started=${record.startedAt}` : undefined,
	].filter(Boolean);
	return pieces.join(" | ");
}

function killPids(pids: number[]): number {
	let killed = 0;
	for (const pid of pids) {
		try {
			process.kill(pid, "SIGKILL");
			killed += 1;
		} catch {
			// Best-effort cleanup.
		}
	}
	return killed;
}

export async function runDoctorCommand(
	opts: { cwd: string; json?: boolean; fix?: boolean; verbose?: boolean },
	io: DoctorIo,
): Promise<number> {
	const jsonOutput = opts.json === true;
	const fix = opts.fix === true;
	const verbose = opts.verbose === true;
	const before = await collectDoctorStatus(opts.cwd);

	if (!fix) {
		if (jsonOutput) {
			io.writeln(JSON.stringify(before));
			return 0;
		}
		writeln(`hub url ${c.dim}${before.hubUrl ?? "none"}${c.reset}`);
		writeln(
			`hub healthy ${c.dim}${before.hubHealthy ? "yes" : "no"}${before.hubPid ? ` (pid=${before.hubPid})` : ""}${c.reset}`,
		);
		writeln(`hub uptime ${c.dim}${before.hubUptime ?? "n/a"}${c.reset}`);
		writeln(formatPidList("hub listeners", before.listeningPids));
		writeln(formatPidList("stale hub daemons", before.staleHubPids));
		writeln(
			formatPidList(
				"hub startup locks",
				before.hubStartupLocks.map((a) => a.pid ?? -1).filter((pid) => pid > 0),
			),
		);
		writeln(formatPidList("cli processes", before.staleCliPids));
		writeln(formatPidList("sidecar processes", before.staleSidecarPids));
		if (before.activeConnectors.length === 0) {
			writeln(`active connectors ${c.dim}0${c.reset}`);
		} else {
			writeln("active connectors:");
			for (const record of before.activeConnectors) {
				writeln(`- ${c.dim}${formatActiveConnector(record)}${c.reset}`);
			}
		}
		if (verbose && before.recentSpawnedProcesses.length > 0) {
			writeln("recent spawned processes:");
			for (const record of before.recentSpawnedProcesses) {
				writeln(`- ${c.dim}${formatRecentSpawnedProcess(record)}${c.reset}`);
			}
		}
		if (
			before.listeningPids.length > 0 ||
			before.staleHubPids.length > 0 ||
			before.staleCliPids.length > 0 ||
			before.staleSidecarPids.length > 0
		) {
			io.writeln(
				"\nRun `cline doctor fix` to kill all stale local processes, including stale sidecars.",
			);
		}
		return 0;
	}

	const gracefullyStoppedHub = before.hubHealthy
		? await stopLocalHubServerGracefully(resolveCliHubOwnerContext()).catch(
				() => false,
			)
		: false;
	const refreshedAfterGracefulStop = gracefullyStoppedHub
		? await collectDoctorStatus(opts.cwd)
		: before;
	const killedHub = gracefullyStoppedHub
		? 0
		: killPids(refreshedAfterGracefulStop.listeningPids);
	const staleHubTargets = before.staleHubPids.filter(
		(pid) => !refreshedAfterGracefulStop.listeningPids.includes(pid),
	);
	const killedStaleHubs = killPids(staleHubTargets);
	const staleCliTargets = before.staleCliPids.filter(
		(pid) =>
			!refreshedAfterGracefulStop.listeningPids.includes(pid) &&
			!staleHubTargets.includes(pid),
	);
	const killedCli = killPids(staleCliTargets);
	const staleSidecarTargets = before.staleSidecarPids.filter(
		(pid) =>
			!refreshedAfterGracefulStop.listeningPids.includes(pid) &&
			!staleHubTargets.includes(pid) &&
			!staleCliTargets.includes(pid),
	);
	const killedSidecars = killPids(staleSidecarTargets);
	const stoppedConnectors = await stopAllConnectors({
		writeln: () => {},
		writeErr: () => {},
	});
	const postKillStatus = await collectDoctorStatus(opts.cwd);
	const clearedArtifacts = await clearHubStartupArtifacts(opts.cwd, {
		clearDiscovery:
			!postKillStatus.hubHealthy && postKillStatus.listeningPids.length === 0,
	});
	const after = await collectDoctorStatus(opts.cwd);

	if (jsonOutput) {
		io.writeln(
			JSON.stringify({
				before,
				after,
				killed: {
					hubListeners: killedHub,
					staleHubDaemons: killedStaleHubs,
					cliProcesses: killedCli,
					sidecarProcesses: killedSidecars,
					connectorProcesses: stoppedConnectors.stoppedProcesses,
					connectorSessions: stoppedConnectors.stoppedSessions,
					hubStartupLocks: clearedArtifacts.startupLocks,
					hubDiscovery: clearedArtifacts.discovery,
				},
			}),
		);
		return 0;
	}
	writeln(`killed hub listeners ${c.dim}${killedHub}${c.reset}`);
	writeln(`killed stale hub daemons ${c.dim}${killedStaleHubs}${c.reset}`);
	writeln(`killed cli processes ${c.dim}${killedCli}${c.reset}`);
	writeln(`killed sidecar processes ${c.dim}${killedSidecars}${c.reset}`);
	writeln(
		`stopped connector processes ${c.dim}${stoppedConnectors.stoppedProcesses}${c.reset}`,
	);
	writeln(
		`stopped connector sessions ${c.dim}${stoppedConnectors.stoppedSessions}${c.reset}`,
	);
	writeln(
		`cleared hub startup locks ${c.dim}${clearedArtifacts.startupLocks}${c.reset}`,
	);
	writeln(
		`cleared hub discovery records ${c.dim}${clearedArtifacts.discovery}${c.reset}`,
	);
	writeln(`hub healthy after fix: ${after.hubHealthy ? "yes" : "no"}`);
	writeln(formatPidList("remaining hub listeners", after.listeningPids));
	writeln(formatPidList("remaining stale hub daemons", after.staleHubPids));
	writeln(
		formatPidList(
			"remaining hub startup locks",
			after.hubStartupLocks.map((a) => a.pid ?? -1).filter((pid) => pid > 0),
		),
	);
	writeln(formatPidList("remaining cli processes", after.staleCliPids));
	writeln(formatPidList("remaining sidecar processes", after.staleSidecarPids));
	return 0;
}

export function createDoctorCommand(
	io: DoctorIo,
	setExitCode: (code: number) => void,
	deps: DoctorCommandDeps = {},
): Command {
	const doctor = new Command("doctor")
		.description("Diagnose and fix local process issues")
		.exitOverride()
		.option("--cwd <path>", "Workspace root", process.cwd())
		.option("--json", "Output as JSON")
		.option("-v, --verbose", "Show additional diagnostic details")
		.action(async function (this: Command) {
			const opts = this.opts<{
				cwd: string;
				json?: boolean;
				verbose?: boolean;
			}>();
			setExitCode(await runDoctorCommand(opts, io));
		});

	doctor
		.command("fix")
		.description("Kill all running processes")
		.option("--cwd <path>", "Workspace root", process.cwd())
		.option("--json", "Output as JSON")
		.option("-v, --verbose", "Show additional diagnostic details")
		.action(async function (this: Command) {
			const opts = this.opts<{
				cwd: string;
				json?: boolean;
				verbose?: boolean;
			}>();
			setExitCode(await runDoctorCommand({ ...opts, fix: true }, io));
		});

	doctor
		.command("log")
		.description("Open the CLI log file")
		.action(async () => {
			const logPath = resolveCliLogPath();
			const openPath = deps.openPath ?? defaultOpenPath;
			try {
				ensureFileExists(logPath);
				await openPath(logPath);
				io.writeln(`Opening logs stored at ${logPath}`);
				setExitCode(0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				io.writeErr(`failed to open log file "${logPath}": ${message}`);
				setExitCode(1);
			}
		});

	return doctor;
}
