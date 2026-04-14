import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveSessionDataDir } from "@clinebot/shared/storage";

const DEFAULT_LEASE_TTL_MS = 5_000;

interface RpcSpawnLeaseRecord {
	address: string;
	pid: number;
	createdAt: number;
}

export interface RpcSpawnLease {
	path: string;
	release: () => void;
}

const ACTIVE_LEASE_RELEASES = new Set<() => void>();
const ACTIVE_LEASE_PATHS = new Set<string>();
let EXIT_CLEANUP_REGISTERED = false;

function encodeAddress(address: string): string {
	return Buffer.from(address).toString("base64url");
}

function getLeasePath(address: string): string {
	return resolve(
		resolveSessionDataDir(),
		"rpc",
		"spawn-leases",
		`${encodeAddress(address)}.lock`,
	);
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function shouldClearLease(path: string, ttlMs: number): boolean {
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as Partial<RpcSpawnLeaseRecord>;
		const pid = Number(parsed.pid ?? 0);
		const createdAt = Number(parsed.createdAt ?? 0);
		if (pid === process.pid && !ACTIVE_LEASE_PATHS.has(path)) {
			return true;
		}
		if (!Number.isFinite(createdAt) || createdAt <= 0) {
			return true;
		}
		if (Date.now() - createdAt > ttlMs) {
			return true;
		}
		return !isProcessAlive(pid);
	} catch {
		return true;
	}
}

function cleanupActiveLeases(): void {
	for (const release of [...ACTIVE_LEASE_RELEASES]) {
		try {
			release();
		} catch {
			// Best effort.
		}
	}
}

function registerExitCleanupOnce(): void {
	if (EXIT_CLEANUP_REGISTERED) {
		return;
	}
	EXIT_CLEANUP_REGISTERED = true;
	process.once("exit", cleanupActiveLeases);
	process.once("SIGINT", cleanupActiveLeases);
	process.once("SIGTERM", cleanupActiveLeases);
}

export function tryAcquireRpcSpawnLease(
	address: string,
	options?: { ttlMs?: number },
): RpcSpawnLease | undefined {
	const ttlMs = Math.max(1_000, options?.ttlMs ?? DEFAULT_LEASE_TTL_MS);
	const path = getLeasePath(address);
	mkdirSync(dirname(path), { recursive: true });

	if (existsSync(path) && shouldClearLease(path, ttlMs)) {
		rmSync(path, { force: true });
	}

	let fd: number | undefined;
	try {
		fd = openSync(path, "wx");
		const record: RpcSpawnLeaseRecord = {
			address,
			pid: process.pid,
			createdAt: Date.now(),
		};
		writeFileSync(fd, JSON.stringify(record), "utf8");
	} catch {
		if (typeof fd === "number") {
			try {
				closeSync(fd);
			} catch {
				// Best effort.
			}
		}
		return undefined;
	}

	let released = false;
	const release = () => {
		if (released) {
			return;
		}
		released = true;
		ACTIVE_LEASE_RELEASES.delete(release);
		ACTIVE_LEASE_PATHS.delete(path);
		try {
			if (typeof fd === "number") {
				closeSync(fd);
			}
		} catch {
			// Best effort.
		}
		try {
			rmSync(path, { force: true });
		} catch {
			// Best effort.
		}
	};
	registerExitCleanupOnce();
	ACTIVE_LEASE_RELEASES.add(release);
	ACTIVE_LEASE_PATHS.add(path);
	return {
		path,
		release,
	};
}
