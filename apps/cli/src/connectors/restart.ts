import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveClineDataDir } from "@cline/core";
import {
	isProcessRunning,
	readJsonFile,
	removeFile,
	terminateProcess,
	writeJsonFile,
} from "./common";
import { getConnector } from "./registry";
import type {
	ConnectCommandDefinition,
	ConnectIo,
	ConnectorRestartSpec,
} from "./types";

type ConnectorStateForRestart = {
	statePath: string;
	pid: number;
	hubUrl: string;
	restart?: ConnectorRestartSpec;
};

type QueuedConnectorRestart = ConnectorRestartSpec & {
	hubUrl: string;
	targetHubUrl: string;
	statePath: string;
	pid: number;
	stoppedAt: string;
	attempts?: number;
};

const MAX_RESTART_ATTEMPTS = 3;

export type StopConnectorsForHubsOptions = {
	targetHubUrl?: string;
};

export type StopConnectorsForHubsResult = {
	stoppedProcesses: number;
	queuedRestarts: number;
};

export type RestartQueuedConnectorsResult = {
	restarted: number;
	remaining: number;
};

function restartQueuePath(): string {
	return join(resolveClineDataDir(), "connectors", "restart-queue.json");
}

function normalizeHubUrl(url: string): string {
	try {
		const parsed = new URL(url.includes("://") ? url : `ws://${url}`);
		if (parsed.protocol === "http:") {
			parsed.protocol = "ws:";
		} else if (parsed.protocol === "https:") {
			parsed.protocol = "wss:";
		}
		parsed.search = "";
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return url.trim();
	}
}

function readQueue(): QueuedConnectorRestart[] {
	const parsed = readJsonFile<unknown>(restartQueuePath(), []);
	if (!Array.isArray(parsed)) {
		return [];
	}
	return parsed.filter((entry): entry is QueuedConnectorRestart => {
		if (!entry || typeof entry !== "object") {
			return false;
		}
		const record = entry as Partial<QueuedConnectorRestart>;
		return (
			typeof record.connector === "string" &&
			Array.isArray(record.args) &&
			record.args.every((arg) => typeof arg === "string") &&
			typeof record.hubUrl === "string" &&
			typeof record.targetHubUrl === "string" &&
			typeof record.statePath === "string" &&
			typeof record.pid === "number" &&
			typeof record.stoppedAt === "string" &&
			(record.cwd === undefined || typeof record.cwd === "string") &&
			(record.attempts === undefined || typeof record.attempts === "number")
		);
	});
}

function writeQueue(queue: QueuedConnectorRestart[]): void {
	if (queue.length === 0) {
		removeFile(restartQueuePath());
		return;
	}
	writeJsonFile(restartQueuePath(), queue);
}

function listConnectorStatePaths(): string[] {
	const root = join(resolveClineDataDir(), "connectors");
	if (!existsSync(root)) {
		return [];
	}
	const paths: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const dir = join(root, entry.name);
		try {
			for (const name of readdirSync(dir)) {
				if (name.endsWith(".json") && !name.endsWith(".threads.json")) {
					paths.push(join(dir, name));
				}
			}
		} catch {
			// Ignore connector directories that disappear while scanning.
		}
	}
	return paths;
}

function readConnectorStateForRestart(
	statePath: string,
): ConnectorStateForRestart | undefined {
	const parsed = readJsonFile<Record<string, unknown> | undefined>(
		statePath,
		undefined,
	);
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
	const restart =
		parsed.restart &&
		typeof parsed.restart === "object" &&
		!Array.isArray(parsed.restart)
			? (parsed.restart as Partial<ConnectorRestartSpec>)
			: undefined;
	return {
		statePath,
		pid,
		hubUrl,
		restart:
			typeof restart?.connector === "string" &&
			Array.isArray(restart.args) &&
			restart.args.every((arg) => typeof arg === "string")
				? {
						connector: restart.connector,
						args: restart.args,
						cwd:
							typeof restart.cwd === "string" && restart.cwd.trim()
								? restart.cwd
								: undefined,
					}
				: undefined,
	};
}

function queueConnectorRestart(
	state: ConnectorStateForRestart,
	targetHubUrl: string,
): boolean {
	if (!state.restart) {
		return false;
	}
	const queue = readQueue().filter(
		(entry) =>
			entry.statePath !== state.statePath &&
			!(
				entry.connector === state.restart?.connector && entry.pid === state.pid
			),
	);
	queue.push({
		...state.restart,
		hubUrl: state.hubUrl,
		targetHubUrl,
		statePath: state.statePath,
		pid: state.pid,
		stoppedAt: new Date().toISOString(),
	});
	writeQueue(queue);
	return true;
}

export async function stopConnectorsForHubs(
	hubUrls: string[],
	io: ConnectIo,
	options: StopConnectorsForHubsOptions = {},
): Promise<StopConnectorsForHubsResult> {
	const targetHubUrls = new Set(hubUrls.map(normalizeHubUrl));
	if (targetHubUrls.size === 0) {
		return { stoppedProcesses: 0, queuedRestarts: 0 };
	}
	const restartTargetHubUrl = options.targetHubUrl
		? normalizeHubUrl(options.targetHubUrl)
		: undefined;
	let stoppedProcesses = 0;
	let queuedRestarts = 0;
	for (const statePath of listConnectorStatePaths()) {
		const state = readConnectorStateForRestart(statePath);
		if (!state || !targetHubUrls.has(normalizeHubUrl(state.hubUrl))) {
			continue;
		}
		if (!(await terminateProcess(state.pid))) {
			io.writeErr(
				`[connect] failed to stop connector pid=${state.pid} hub=${state.hubUrl}`,
			);
			continue;
		}
		stoppedProcesses += 1;
		io.writeln(
			`[connect] stopped connector pid=${state.pid} hub=${state.hubUrl}`,
		);
		if (
			queueConnectorRestart(
				state,
				restartTargetHubUrl ?? normalizeHubUrl(state.hubUrl),
			)
		) {
			queuedRestarts += 1;
		}
		removeFile(statePath);
	}
	return { stoppedProcesses, queuedRestarts };
}

function hasCwdArg(args: string[]): boolean {
	return args.some((arg) => arg === "--cwd" || arg.startsWith("--cwd="));
}

function withHubRpcAddress(args: string[], hubUrl: string): string[] {
	// Drains run from background contexts (hub start, doctor, update), so an
	// interactive flag in the saved args would block the drain waiting on a
	// terminal that does not exist. Relaunch in detached mode unconditionally;
	// the spec normally never carries these flags since interactive runs do
	// not persist a restart spec.
	const next = args.filter((arg) => arg !== "-i" && arg !== "--interactive");
	for (let index = 0; index < next.length; index += 1) {
		if (next[index]?.startsWith("--rpc-address=")) {
			next[index] = `--rpc-address=${hubUrl}`;
			return next;
		}
		if (next[index] === "--rpc-address" && next[index + 1]) {
			next[index + 1] = hubUrl;
			return next;
		}
	}
	return [...next, "--rpc-address", hubUrl];
}

function withRestartLaunchArgs(entry: QueuedConnectorRestart, hubUrl: string) {
	const args = withHubRpcAddress(entry.args, hubUrl);
	return entry.cwd && !hasCwdArg(args) ? [...args, "--cwd", entry.cwd] : args;
}

function recordFailedRestartAttempt(
	entry: QueuedConnectorRestart,
	failed: QueuedConnectorRestart[],
	io: ConnectIo,
): void {
	const attempts = (entry.attempts ?? 0) + 1;
	if (attempts >= MAX_RESTART_ATTEMPTS) {
		io.writeErr(
			`[connect] dropping queued restart for connector "${entry.connector}" after ${attempts} failed attempts`,
		);
		return;
	}
	failed.push({ ...entry, attempts });
}

// Restarting a connector re-runs its connect command, which ensures the hub
// and drains this queue again. The guard turns those nested drains into
// no-ops so a queue entry is never picked up twice within one process.
let drainInProgress = false;

export async function restartQueuedConnectorsForHub(
	hubUrl: string,
	io: ConnectIo,
): Promise<RestartQueuedConnectorsResult> {
	if (drainInProgress) {
		return { restarted: 0, remaining: readQueue().length };
	}
	const queue = readQueue();
	if (queue.length === 0) {
		return { restarted: 0, remaining: 0 };
	}
	const targetHubUrl = normalizeHubUrl(hubUrl);
	const matched: QueuedConnectorRestart[] = [];
	const remaining: QueuedConnectorRestart[] = [];
	for (const entry of queue) {
		if (normalizeHubUrl(entry.targetHubUrl) === targetHubUrl) {
			matched.push(entry);
		} else {
			remaining.push(entry);
		}
	}
	if (matched.length === 0) {
		return { restarted: 0, remaining: remaining.length };
	}
	// Claim matched entries before running them so a crash mid-restart (or a
	// concurrent drain in another process) cannot replay entries that already
	// launched a connector.
	writeQueue(remaining);
	let restarted = 0;
	const failed: QueuedConnectorRestart[] = [];
	drainInProgress = true;
	try {
		for (const entry of matched) {
			let connector: ConnectCommandDefinition | undefined;
			try {
				connector = await getConnector(entry.connector);
			} catch {
				recordFailedRestartAttempt(entry, failed, io);
				continue;
			}
			if (!connector) {
				io.writeErr(
					`[connect] dropping queued restart for unknown connector "${entry.connector}"`,
				);
				continue;
			}
			const exitCode = await connector
				.run(withRestartLaunchArgs(entry, hubUrl), io)
				.catch(() => 1);
			if (exitCode === 0) {
				restarted += 1;
				continue;
			}
			recordFailedRestartAttempt(entry, failed, io);
		}
	} finally {
		drainInProgress = false;
	}
	if (failed.length > 0) {
		// Re-read before appending so entries queued while restarting survive.
		writeQueue([...readQueue(), ...failed]);
	}
	return { restarted, remaining: readQueue().length };
}
