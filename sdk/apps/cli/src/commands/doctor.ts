import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	clearHubDiscovery,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
	resolveSharedHubOwnerContext,
	stopLocalHubServerGracefully,
} from "@clinebot/core";
import { Command } from "commander";
import { isProcessRunning } from "../connectors/common";
import { getCliBuildInfo } from "../utils/common";
import { c, writeln } from "../utils/output";

type DoctorIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type StartupArtifact = {
	path: string;
	pid?: number;
	acquiredAt?: string;
	stale: boolean;
};

type ActiveConnectorRecord = {
	type: string;
	pid: number;
	hubUrl: string;
	startedAt?: string;
	applicationId?: string;
	botUsername?: string;
	userName?: string;
	phoneNumberId?: string;
	port?: number;
	baseUrl?: string;
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
	listeningPids: number[];
	hubStartupLocks: StartupArtifact[];
	staleCliPids: number[];
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
	const result = spawnSync("pgrep", ["-fal", pattern], { encoding: "utf8" });
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
		"/dist/clite",
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
	const owner = resolveSharedHubOwnerContext();
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
	const owner = resolveSharedHubOwnerContext();
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

function listConnectorStatePaths(
	type: ActiveConnectorRecord["type"],
): string[] {
	const dir = join(resolveClineDataDir(), "connectors", type);
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".threads.json"))
		.map((name) => join(dir, name));
}

function readJsonRecord(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Ignore malformed connector state.
	}
	return undefined;
}

type ConnectorFieldKey = keyof Omit<
	ActiveConnectorRecord,
	"type" | "pid" | "hubUrl"
>;

const connectorFieldExtractors: Record<
	ConnectorFieldKey,
	(p: Record<string, unknown>) => string | number | undefined
> = {
	startedAt: (p) => (typeof p.startedAt === "string" ? p.startedAt : undefined),
	port: (p) => (typeof p.port === "number" ? p.port : undefined),
	baseUrl: (p) => (typeof p.baseUrl === "string" ? p.baseUrl : undefined),
	userName: (p) => (typeof p.userName === "string" ? p.userName : undefined),
	botUsername: (p) =>
		typeof p.botUsername === "string" ? p.botUsername : undefined,
	applicationId: (p) =>
		typeof p.applicationId === "string" ? p.applicationId : undefined,
	phoneNumberId: (p) =>
		typeof p.phoneNumberId === "string" ? p.phoneNumberId : undefined,
};

const connectorConfigs: Record<
	string,
	{ required: ConnectorFieldKey[]; optional: ConnectorFieldKey[] }
> = {
	discord: {
		required: ["userName", "applicationId"],
		optional: ["startedAt", "port", "baseUrl"],
	},
	telegram: { required: ["botUsername"], optional: ["startedAt"] },
	gchat: { required: ["userName"], optional: ["startedAt", "port", "baseUrl"] },
	linear: {
		required: ["userName"],
		optional: ["startedAt", "port", "baseUrl"],
	},
	whatsapp: {
		required: ["userName"],
		optional: ["startedAt", "phoneNumberId", "port", "baseUrl"],
	},
};

function readActiveConnectorRecord(
	type: ActiveConnectorRecord["type"],
	statePath: string,
): ActiveConnectorRecord | undefined {
	const parsed = readJsonRecord(statePath);
	if (!parsed) {
		return undefined;
	}
	const pid = typeof parsed.pid === "number" ? parsed.pid : undefined;
	const hubUrl =
		typeof parsed.hubUrl === "string"
			? parsed.hubUrl
			: typeof parsed.rpcAddress === "string"
				? parsed.rpcAddress
				: undefined;
	if (!pid || !hubUrl || !isProcessRunning(pid)) {
		return undefined;
	}
	const config = connectorConfigs[type];
	if (!config) {
		return undefined;
	}
	const fields: Partial<
		Omit<ActiveConnectorRecord, "type" | "pid" | "hubUrl">
	> = {};
	for (const key of config.required) {
		const value = connectorFieldExtractors[key](parsed);
		if (!value || (typeof value === "string" && !value.trim())) {
			return undefined;
		}
		(fields as Record<string, unknown>)[key] = value;
	}
	for (const key of config.optional) {
		const value = connectorFieldExtractors[key](parsed);
		if (value !== undefined) {
			(fields as Record<string, unknown>)[key] = value;
		}
	}
	return { type, pid, hubUrl, ...fields } as ActiveConnectorRecord;
}

function listActiveConnectors(): ActiveConnectorRecord[] {
	const connectorTypes: ActiveConnectorRecord["type"][] = [
		"telegram",
		"gchat",
		"linear",
		"whatsapp",
	];
	const records: ActiveConnectorRecord[] = [];
	for (const type of connectorTypes) {
		for (const statePath of listConnectorStatePaths(type)) {
			const record = readActiveConnectorRecord(type, statePath);
			if (record) {
				records.push(record);
			}
		}
	}
	return records.sort((left, right) => {
		if (left.type !== right.type) {
			return left.type.localeCompare(right.type);
		}
		const leftName = left.botUsername ?? left.userName ?? "";
		const rightName = right.botUsername ?? right.userName ?? "";
		return leftName.localeCompare(rightName);
	});
}

async function collectDoctorStatus(cwd: string): Promise<DoctorStatus> {
	const owner = resolveSharedHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath);
	const health = discovery?.url
		? await probeHubServer(discovery.url)
		: undefined;
	const current = health ?? discovery;
	return {
		cwd,
		hubUrl: current?.url,
		hubHealthy: !!health?.url,
		hubPid: current?.pid,
		listeningPids: listListeningPids(current?.port),
		hubStartupLocks: listHubStartupLocks(cwd),
		staleCliPids: listStaleCliPids(),
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
		writeln(formatPidList("hub listeners", before.listeningPids));
		writeln(
			formatPidList(
				"hub startup locks",
				before.hubStartupLocks.map((a) => a.pid ?? -1).filter((pid) => pid > 0),
			),
		);
		writeln(formatPidList("cli processes", before.staleCliPids));
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
		if (before.listeningPids.length > 0 || before.staleCliPids.length > 0) {
			io.writeln(
				"\nRun `cline doctor --fix` to kill all stale local processes.",
			);
		}
		return 0;
	}

	const gracefullyStoppedHub = before.hubHealthy
		? await stopLocalHubServerGracefully().catch(() => false)
		: false;
	const refreshedAfterGracefulStop = gracefullyStoppedHub
		? await collectDoctorStatus(opts.cwd)
		: before;
	const killedHub = gracefullyStoppedHub
		? 0
		: killPids(refreshedAfterGracefulStop.listeningPids);
	const staleCliTargets = before.staleCliPids.filter(
		(pid) => !refreshedAfterGracefulStop.listeningPids.includes(pid),
	);
	const killedCli = killPids(staleCliTargets);
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
					cliProcesses: killedCli,
					hubStartupLocks: clearedArtifacts.startupLocks,
					hubDiscovery: clearedArtifacts.discovery,
				},
			}),
		);
		return 0;
	}
	writeln(`killed hub listeners ${c.dim}${killedHub}${c.reset}`);
	writeln(`killed cli processes ${c.dim}${killedCli}${c.reset}`);
	writeln(
		`cleared hub startup locks ${c.dim}${clearedArtifacts.startupLocks}${c.reset}`,
	);
	writeln(
		`cleared hub discovery records ${c.dim}${clearedArtifacts.discovery}${c.reset}`,
	);
	writeln(`hub healthy after fix: ${after.hubHealthy ? "yes" : "no"}`);
	writeln(formatPidList("remaining hub listeners", after.listeningPids));
	writeln(
		formatPidList(
			"remaining hub startup locks",
			after.hubStartupLocks.map((a) => a.pid ?? -1).filter((pid) => pid > 0),
		),
	);
	writeln(formatPidList("remaining cli processes", after.staleCliPids));
	return 0;
}

export function createDoctorCommand(
	io: DoctorIo,
	setExitCode: (code: number) => void,
): Command {
	const doctor = new Command("doctor")
		.description("Diagnose and fix local process issues")
		.exitOverride()
		.option("--cwd <path>", "Workspace root", process.cwd())
		.option("--json", "Output as JSON")
		.option("--fix", "Kill stale local processes")
		.option("-v, --verbose", "Show additional diagnostic details")
		.action(async function (this: Command) {
			const opts = this.opts<{
				cwd: string;
				json?: boolean;
				fix?: boolean;
				verbose?: boolean;
			}>();
			setExitCode(await runDoctorCommand(opts, io));
		});
	return doctor;
}
