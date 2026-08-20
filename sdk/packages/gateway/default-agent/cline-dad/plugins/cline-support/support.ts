import {
	closeSync,
	existsSync,
	fstatSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function gatewayDataRoot(): string {
	return resolve(
		process.env.CLINE_GATEWAY_DATA_ROOT?.trim() ||
			join(homedir(), ".cline", "gateway"),
	);
}

export function gatewayNamespace(): string {
	return process.env.CLINE_GATEWAY_NAMESPACE?.trim() || "default";
}

export function gatewayDataDir(): string {
	return join(gatewayDataRoot(), gatewayNamespace());
}

export function fileInfo(path: string): { exists: boolean; bytes?: number } {
	try {
		return { exists: true, bytes: statSync(path).size };
	} catch {
		return { exists: false };
	}
}

export function dirEntries(path: string): string[] {
	try {
		return readdirSync(path).filter((name) => !name.startsWith("."));
	} catch {
		return [];
	}
}

export function redact(text: string): string {
	return text
		.replace(/x(?:app|oxb|oxp|oxa|oxr)-[A-Za-z0-9-]{10,}/g, "[redacted:slack]")
		.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted:key]")
		.replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted:github]")
		.replace(/("?auth"?\s*:\s*")[^"]+/gi, "$1[redacted]")
		.replace(/(authorization['":\s]+bearer\s+)[^\s"']+/gi, "$1[redacted]")
		.replace(
			/(--?(?:api-?key|token|app-token|bot-token|apikey|key)[= ])\S+/gi,
			"$1[redacted]",
		);
}

export function readDiscovery(): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(
			readFileSync(join(gatewayDataDir(), "gateway.json"), "utf8"),
		) as Record<string, unknown>;
		delete parsed.auth;
		return parsed;
	} catch {
		return undefined;
	}
}

export function providerSummary(): {
	path?: string;
	exists: boolean;
	lastUsedProvider?: string;
	providers?: string[];
} {
	const candidates = [
		process.env.CLINE_PROVIDER_SETTINGS_PATH?.trim(),
		join(homedir(), ".cline", "data", "settings", "providers.json"),
		join(homedir(), ".cline", "settings", "providers.json"),
	].filter((path): path is string => Boolean(path));
	const path = candidates.find(existsSync);
	if (!path) return { exists: false };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			lastUsedProvider?: string;
			providers?: Record<string, unknown>;
		};
		return {
			path,
			exists: true,
			lastUsedProvider: parsed.lastUsedProvider,
			providers: Object.keys(parsed.providers ?? {}),
		};
	} catch {
		return { path, exists: true, providers: ["<unparseable>"] };
	}
}

async function gatewayDatabase(): Promise<InstanceType<typeof import("bun:sqlite").Database> | undefined> {
	const path = join(gatewayDataDir(), "gateway.db");
	if (!existsSync(path)) return undefined;
	const { Database } = await import("bun:sqlite");
	return new Database(path, { readonly: true });
}

export async function databaseCounts(): Promise<Record<string, number> | undefined> {
	const db = await gatewayDatabase();
	if (!db) return undefined;
	try {
		const counts: Record<string, number> = {};
		for (const table of ["bots", "sessions", "runs", "run_attempts", "schedules", "connectors"]) {
			try {
				const row = db.query(`SELECT COUNT(*) AS count FROM ${table}`).all()[0] as { count: number };
				counts[table] = row.count;
			} catch {
				// Older Gateway schema: report the tables that exist.
			}
		}
		return counts;
	} finally {
		db.close();
	}
}

export async function listGatewaySessions(limit: number): Promise<unknown[]> {
	const db = await gatewayDatabase();
	if (!db) return [];
	try {
		return db
			.query(`SELECT s.session_id, s.bot_id, s.workspace_root, s.state, s.created_at,
				(SELECT r.run_id FROM runs r WHERE r.session_id = s.session_id ORDER BY r.accepted_seq DESC LIMIT 1) AS latest_run_id,
				(SELECT r.state FROM runs r WHERE r.session_id = s.session_id ORDER BY r.accepted_seq DESC LIMIT 1) AS latest_run_state,
				(SELECT r.error_message FROM runs r WHERE r.session_id = s.session_id ORDER BY r.accepted_seq DESC LIMIT 1) AS latest_error
			 FROM sessions s ORDER BY s.created_at DESC LIMIT ?`)
			.all(Math.max(1, Math.min(50, limit)));
	} finally {
		db.close();
	}
}

export async function scheduleReport(): Promise<{ schedules: unknown[]; recentJobs: unknown[] }> {
	const db = await gatewayDatabase();
	if (!db) return { schedules: [], recentJobs: [] };
	try {
		return {
			schedules: db.query(`SELECT schedule_id, bot_id, name, interval_ms, at, next_due_at, enabled, max_attempts FROM schedules ORDER BY created_at DESC LIMIT 50`).all(),
			recentJobs: db.query(`SELECT job_id, schedule_id, due_at, state, attempts, run_id, last_error, settled_at FROM schedule_jobs ORDER BY created_at DESC LIMIT 20`).all(),
		};
	} finally {
		db.close();
	}
}

const TAIL_BYTES = 256 * 1024;

export function tailGatewayLog(name: string, lines: number): string | undefined {
	const allowed: Record<string, string[]> = {
		gateway: ["gateway.log", "logs/gateway.log"],
		desktop: ["gateway-desktop.log", "logs/gateway-desktop.log"],
	};
	const relative = allowed[name]?.find((candidate) =>
		existsSync(join(gatewayDataDir(), candidate)),
	);
	if (!relative) return undefined;
	const path = join(gatewayDataDir(), relative);
	const fd = openSync(path, "r");
	try {
		const size = fstatSync(fd).size;
		const start = Math.max(0, size - TAIL_BYTES);
		const buffer = Buffer.alloc(size - start);
		readSync(fd, buffer, 0, buffer.length, start);
		return redact(buffer.toString("utf8").split("\n").slice(-Math.max(1, Math.min(500, lines))).join("\n")).slice(-8000);
	} finally {
		closeSync(fd);
	}
}
