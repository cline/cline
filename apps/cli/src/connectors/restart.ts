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
import type { ConnectIo, ConnectorRestartSpec } from "./types";

type ConnectorStateForRestart = {
	statePath: string;
	pid: number;
	hubUrl: string;
	restart?: ConnectorRestartSpec;
};

type QueuedConnectorRestart = ConnectorRestartSpec & {
	hubUrl: string;
	statePath: string;
	pid: number;
	stoppedAt: string;
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
			typeof record.statePath === "string" &&
			typeof record.pid === "number" &&
			typeof record.stoppedAt === "string"
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
	for (const type of readdirSync(root)) {
		const dir = join(root, type);
		if (!existsSync(dir)) {
			continue;
		}
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
				? { connector: restart.connector, args: restart.args }
				: undefined,
	};
}

function queueConnectorRestart(state: ConnectorStateForRestart): boolean {
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
): Promise<StopConnectorsForHubsResult> {
	const targetHubUrls = new Set(hubUrls.map(normalizeHubUrl));
	if (targetHubUrls.size === 0) {
		return { stoppedProcesses: 0, queuedRestarts: 0 };
	}
	let stoppedProcesses = 0;
	let queuedRestarts = 0;
	for (const statePath of listConnectorStatePaths()) {
		const state = readConnectorStateForRestart(statePath);
		if (!state || !targetHubUrls.has(normalizeHubUrl(state.hubUrl))) {
			continue;
		}
		if (queueConnectorRestart(state)) {
			queuedRestarts += 1;
		}
		if (await terminateProcess(state.pid)) {
			stoppedProcesses += 1;
			io.writeln(
				`[connect] stopped connector pid=${state.pid} hub=${state.hubUrl}`,
			);
		}
		removeFile(statePath);
	}
	return { stoppedProcesses, queuedRestarts };
}

function withHubRpcAddress(args: string[], hubUrl: string): string[] {
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

export async function restartQueuedConnectorsForHub(
	hubUrl: string,
	io: ConnectIo,
): Promise<RestartQueuedConnectorsResult> {
	const queue = readQueue();
	if (queue.length === 0) {
		return { restarted: 0, remaining: 0 };
	}
	let restarted = 0;
	const remaining: QueuedConnectorRestart[] = [];
	for (const entry of queue) {
		const connector = await getConnector(entry.connector);
		if (!connector) {
			remaining.push(entry);
			continue;
		}
		const exitCode = await connector.run(
			withHubRpcAddress(entry.args, hubUrl),
			io,
		);
		if (exitCode === 0) {
			restarted += 1;
		} else {
			remaining.push(entry);
		}
	}
	writeQueue(remaining);
	return { restarted, remaining: remaining.length };
}
