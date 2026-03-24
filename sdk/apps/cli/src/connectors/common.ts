import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ensureParentDir } from "@clinebot/core";
import type { RpcSessionClient, RpcSessionRow } from "@clinebot/rpc";
import { logSpawnedProcess } from "../logging/process";

export function parseBooleanFlag(rawArgs: string[], flag: string): boolean {
	return rawArgs.includes(flag);
}

export function parseStringFlag(
	rawArgs: string[],
	shortFlag: string,
	longFlag: string,
): string | undefined {
	for (let index = 0; index < rawArgs.length; index += 1) {
		const value = rawArgs[index];
		if (value !== shortFlag && value !== longFlag) {
			continue;
		}
		const next = rawArgs[index + 1]?.trim();
		return next ? next : undefined;
	}
	return undefined;
}

export function parseIntegerFlag(
	rawArgs: string[],
	shortFlag: string,
	longFlag: string,
): number | undefined {
	const raw = parseStringFlag(rawArgs, shortFlag, longFlag);
	if (!raw) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function isProcessRunning(pid: number): boolean {
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

export async function terminateProcess(pid: number): Promise<boolean> {
	if (!isProcessRunning(pid)) {
		return false;
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return false;
	}
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (!isProcessRunning(pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		return false;
	}
	for (let attempt = 0; attempt < 10; attempt += 1) {
		if (!isProcessRunning(pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return !isProcessRunning(pid);
}

function buildDetachedConnectorArgs(
	commandPrefixArgs: string[],
	rawArgs: string[],
): string[] {
	return [...commandPrefixArgs, ...rawArgs, "-i"];
}

export function spawnDetachedConnector(
	commandPrefixArgs: string[],
	rawArgs: string[],
	childEnvKey: string,
): number {
	const launcher = process.argv[0];
	const entry = process.argv[1];
	const commandArgs = buildDetachedConnectorArgs(commandPrefixArgs, rawArgs);
	const childArgs = entry ? [entry, ...commandArgs] : commandArgs;
	const child = spawn(launcher, childArgs, {
		cwd: process.cwd(),
		detached: true,
		stdio: "ignore",
		env: {
			...process.env,
			[childEnvKey]: "1",
		},
	});
	logSpawnedProcess({
		component: "connectors",
		command: [launcher, ...childArgs],
		childPid: child.pid ?? undefined,
		detached: true,
		cwd: process.cwd(),
		metadata: { childEnvKey, purpose: "connector.detached" },
	});
	child.unref();
	return child.pid ?? 0;
}

export const __test__ = {
	buildDetachedConnectorArgs,
};

export function readJsonFile<T>(path: string, fallback: T): T {
	if (!existsSync(path)) {
		return fallback;
	}
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as T;
		return parsed ?? fallback;
	} catch {
		return fallback;
	}
}

export function writeJsonFile(path: string, value: unknown): void {
	ensureParentDir(path);
	writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

export function removeFile(path: string): void {
	try {
		rmSync(path, { force: true });
	} catch {}
}

export function parseRowMetadata(
	row:
		| RpcSessionRow
		| {
				metadata?: Record<string, unknown>;
				parentSessionId?: string | null;
				sessionId: string;
		  },
): { metadata?: Record<string, unknown>; parentSessionId?: string } {
	const metadata =
		row.metadata && typeof row.metadata === "object" ? row.metadata : undefined;
	return {
		metadata,
		parentSessionId: row.parentSessionId?.trim() || undefined,
	};
}

export function parseLocalRowMetadata(row: {
	metadata_json?: string | null;
}): Record<string, unknown> | undefined {
	if (typeof row.metadata_json !== "string" || !row.metadata_json.trim()) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(row.metadata_json) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {}
	return undefined;
}

export async function readSessionReplyText(
	client: RpcSessionClient,
	sessionId: string,
): Promise<string | undefined> {
	const session = await client.getSession(sessionId);
	const path = session?.messagesPath?.trim();
	if (!path || !existsSync(path)) {
		return undefined;
	}
	try {
		const raw = await readFile(path, "utf8");
		if (!raw.trim()) {
			return undefined;
		}
		const parsed = JSON.parse(raw) as { messages?: unknown[] } | unknown[];
		const messages = Array.isArray(parsed)
			? parsed
			: Array.isArray(parsed.messages)
				? parsed.messages
				: [];
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index] as Record<string, unknown>;
			if (message?.role !== "assistant") {
				continue;
			}
			const content = message.content;
			if (typeof content === "string" && content.trim()) {
				return content.trim();
			}
			if (Array.isArray(content)) {
				const joined = content
					.map((part) => {
						if (typeof part === "string") {
							return part;
						}
						if (!part || typeof part !== "object") {
							return "";
						}
						const record = part as Record<string, unknown>;
						if (typeof record.text === "string") {
							return record.text;
						}
						return "";
					})
					.join("")
					.trim();
				if (joined) {
					return joined;
				}
			}
		}
	} catch {}
	return undefined;
}
