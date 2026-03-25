import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveClineDataDir } from "@clinebot/core";
import { getRpcServerDefaultAddress, getRpcServerHealth } from "@clinebot/rpc";
import { Command } from "commander";
import { isProcessRunning } from "../connectors/common";
import { getCliBuildInfo } from "../utils/common";
import { c, writeln } from "../utils/output";

type DoctorIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type DoctorStatus = {
	rpcAddress: string;
	rpcHealthy: boolean;
	rpcServerId?: string;
	listeningPids: number[];
	staleCliPids: number[];
	hookWorkerPids: number[];
	activeConnectors: ActiveConnectorRecord[];
	recentSpawnedProcesses: SpawnedProcessRecord[];
};

type ActiveConnectorRecord = {
	type: "telegram" | "gchat" | "whatsapp" | "linear";
	pid: number;
	rpcAddress: string;
	startedAt?: string;
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

function parseRpcPort(address: string): number | undefined {
	const idx = address.lastIndexOf(":");
	if (idx <= 0 || idx >= address.length - 1) {
		return undefined;
	}
	const port = Number.parseInt(address.slice(idx + 1), 10);
	return Number.isInteger(port) && port > 0 ? port : undefined;
}

function listListeningPids(address: string): number[] {
	const port = parseRpcPort(address);
	if (!port) {
		return [];
	}
	if (process.platform === "win32") {
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
			(record) =>
				!/(?:^|\s)(?:rpc|hook-worker|connect)(?:\s|$)/.test(record.command),
		)
		.map((record) => record.pid);
}

function listHookWorkerPids(): number[] {
	if (process.platform === "win32") {
		return [];
	}
	const patterns = ["hook-worker", " hook-worker "];
	const pids = new Set<number>();
	for (const pattern of patterns) {
		const result = spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" });
		if (result.status !== 0 && result.status !== 1) {
			continue;
		}
		for (const pid of parsePids(result.stdout)) {
			if (pid !== process.pid && pid !== process.ppid) {
				pids.add(pid);
			}
		}
	}
	return [...pids].sort((a, b) => a - b);
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

function readActiveConnectorRecord(
	type: ActiveConnectorRecord["type"],
	statePath: string,
): ActiveConnectorRecord | undefined {
	const parsed = readJsonRecord(statePath);
	if (!parsed) {
		return undefined;
	}
	const pid = typeof parsed.pid === "number" ? parsed.pid : undefined;
	const rpcAddress =
		typeof parsed.rpcAddress === "string" ? parsed.rpcAddress : undefined;
	if (!pid || !rpcAddress || !isProcessRunning(pid)) {
		return undefined;
	}
	if (
		type === "telegram" &&
		typeof parsed.botUsername === "string" &&
		parsed.botUsername.trim()
	) {
		return {
			type,
			pid,
			rpcAddress,
			startedAt:
				typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
			botUsername: parsed.botUsername,
		};
	}
	if (
		type === "gchat" &&
		typeof parsed.userName === "string" &&
		parsed.userName.trim()
	) {
		return {
			type,
			pid,
			rpcAddress,
			startedAt:
				typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
			userName: parsed.userName,
			port: typeof parsed.port === "number" ? parsed.port : undefined,
			baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
		};
	}
	if (
		type === "linear" &&
		typeof parsed.userName === "string" &&
		parsed.userName.trim()
	) {
		return {
			type,
			pid,
			rpcAddress,
			startedAt:
				typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
			userName: parsed.userName,
			port: typeof parsed.port === "number" ? parsed.port : undefined,
			baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
		};
	}
	if (
		type === "whatsapp" &&
		typeof parsed.userName === "string" &&
		parsed.userName.trim()
	) {
		return {
			type,
			pid,
			rpcAddress,
			startedAt:
				typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
			userName: parsed.userName,
			phoneNumberId:
				typeof parsed.phoneNumberId === "string"
					? parsed.phoneNumberId
					: undefined,
			port: typeof parsed.port === "number" ? parsed.port : undefined,
			baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
		};
	}
	return undefined;
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

async function collectDoctorStatus(address: string): Promise<DoctorStatus> {
	const health = await getRpcServerHealth(address);
	return {
		rpcAddress: address,
		rpcHealthy: health?.running === true,
		rpcServerId: health?.serverId,
		listeningPids: listListeningPids(address),
		staleCliPids: listStaleCliPids(),
		hookWorkerPids: listHookWorkerPids(),
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
			: `user=${record.userName ?? "unknown"}`;
	const pieces = [
		record.type,
		identity,
		`pid=${record.pid}`,
		`rpc=${record.rpcAddress}`,
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
	opts: { address: string; json?: boolean; fix?: boolean; verbose?: boolean },
	io: DoctorIo,
): Promise<number> {
	const jsonOutput = opts.json === true;
	const fix = opts.fix === true;
	const verbose = opts.verbose === true;
	const address = opts.address;
	const before = await collectDoctorStatus(address);

	if (!fix) {
		if (jsonOutput) {
			io.writeln(JSON.stringify(before));
			return 0;
		}
		writeln(`rpc address ${c.dim}${before.rpcAddress}${c.reset}`);
		writeln(
			`rpc healthy ${c.dim}${before.rpcHealthy ? "yes" : "no"}${before.rpcServerId ? ` (${before.rpcServerId})` : ""}${c.reset}`,
		);
		writeln(formatPidList("rpc listeners", before.listeningPids));
		writeln(formatPidList("cli processes", before.staleCliPids));
		writeln(formatPidList("hook workers", before.hookWorkerPids));
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
			before.staleCliPids.length > 0 ||
			before.hookWorkerPids.length > 0
		) {
			io.writeln(
				"\nRun `clite doctor --fix` to kill all stale local processes.",
			);
		}
		return 0;
	}

	const killedRpc = killPids(before.listeningPids);
	const staleCliTargets = before.staleCliPids.filter(
		(pid) => !before.listeningPids.includes(pid),
	);
	const killedCli = killPids(staleCliTargets);
	const hookWorkerTargets = before.hookWorkerPids.filter(
		(pid) =>
			!before.listeningPids.includes(pid) && !staleCliTargets.includes(pid),
	);
	const killedHookWorkers = killPids(hookWorkerTargets);
	const after = await collectDoctorStatus(address);

	if (jsonOutput) {
		io.writeln(
			JSON.stringify({
				before,
				after,
				killed: {
					rpcListeners: killedRpc,
					cliProcesses: killedCli,
					hookWorkers: killedHookWorkers,
				},
			}),
		);
		return 0;
	}
	writeln(`killed rpc listeners ${c.dim}${killedRpc}${c.reset}`);
	writeln(`killed cli processes ${c.dim}${killedCli}${c.reset}`);
	writeln(`killed hook workers ${c.dim}${killedHookWorkers}${c.reset}`);
	writeln(`rpc healthy after fix: ${after.rpcHealthy ? "yes" : "no"}`);
	writeln(formatPidList("remaining rpc listeners", after.listeningPids));
	writeln(formatPidList("remaining cli processes", after.staleCliPids));
	writeln(formatPidList("remaining hook workers", after.hookWorkerPids));
	return 0;
}

export function createDoctorCommand(
	io: DoctorIo,
	setExitCode: (code: number) => void,
): Command {
	const doctor = new Command("doctor")
		.description("Diagnose and fix local process issues")
		.exitOverride()
		.option(
			"--address <host:port>",
			"RPC server address",
			process.env.CLINE_RPC_ADDRESS || getRpcServerDefaultAddress(),
		)
		.option("--json", "Output as JSON")
		.option("--fix", "Kill stale local processes")
		.option("-v, --verbose", "Show additional diagnostic details")
		.action(async function (this: Command) {
			const opts = this.opts<{
				address: string;
				json?: boolean;
				fix?: boolean;
				verbose?: boolean;
			}>();
			setExitCode(await runDoctorCommand(opts, io));
		});
	return doctor;
}
