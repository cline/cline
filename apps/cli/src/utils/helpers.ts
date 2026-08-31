import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type HookEventPayload, parseHookEventPayload } from "@cline/shared";
import { ensureHookLogDir } from "@cline/shared/storage";
import { nanoid } from "nanoid";
import { commanderToParsedArgs, createProgram } from "../commands/program";
import type { ParsedArgs } from "./types";

export function sanitizeSessionToken(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function makeSubSessionId(
	rootSessionId: string,
	agentId: string,
): string {
	const root = sanitizeSessionToken(rootSessionId);
	const agent = sanitizeSessionToken(agentId);
	const joined = `${root}__${agent}`;
	return joined.length > 180 ? joined.slice(0, 180) : joined;
}

export function makeTeamTaskSubSessionId(
	rootSessionId: string,
	agentId: string,
): string {
	const root = sanitizeSessionToken(rootSessionId);
	const agent = sanitizeSessionToken(agentId);
	const nonce = Math.random().toString(36).slice(2, 8);
	return `${root}__teamtask__${agent}__${Date.now()}_${nonce}`;
}

export function nowIso(): string {
	return new Date().toISOString();
}

export function randomSessionId(): string {
	return `${Date.now()}_${nanoid(5)}_cli`;
}

export function resolveWorkspaceRoot(cwd: string): string {
	const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	});
	if (result.status === 0) {
		const value = result.stdout.trim();
		if (value) {
			return value;
		}
	}
	return cwd;
}

export function unlinkIfExists(filePath: string | null | undefined): void {
	if (!filePath) {
		return;
	}
	if (!existsSync(filePath)) {
		return;
	}
	try {
		unlinkSync(filePath);
	} catch {
		// Best-effort cleanup.
	}
}

export function readStdinUtf8(): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		process.stdin.on("data", (chunk: Buffer) =>
			chunks.push(Buffer.from(chunk)),
		);
		process.stdin.on("end", () =>
			resolve(Buffer.concat(chunks).toString("utf-8")),
		);
		process.stdin.on("error", reject);
	});
}

export function writeHookJson(value: unknown): void {
	try {
		process.stdout.write(JSON.stringify(value));
	} catch (error) {
		if (
			!(
				error &&
				typeof error === "object" &&
				"code" in error &&
				typeof (error as { code?: unknown }).code === "string" &&
				(error as { code: string }).code === "EPIPE"
			)
		) {
			throw error;
		}
	}
}

export async function appendHookAudit(event: HookEventPayload): Promise<void> {
	const line = `${JSON.stringify({
		ts: new Date().toISOString(),
		...event,
	})}\n`;
	const envPath = process.env.CLINE_HOOKS_LOG_PATH?.trim() || undefined;
	const logPath = envPath ?? join(ensureHookLogDir(), "hooks.jsonl");
	ensureHookLogDir(logPath);
	appendFileSync(logPath, line, "utf-8");
}

export async function isCliHookPayload(value: unknown): Promise<boolean> {
	return parseHookEventPayload(value) !== undefined;
}

export async function parseCliHookPayload(
	value: unknown,
): Promise<HookEventPayload | undefined> {
	return parseHookEventPayload(value);
}

function isBooleanLikeAutoApproveValue(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "true" || normalized === "false";
}

export function normalizeCliArgs(args: string[]): string[] {
	const normalized: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];
		if (token === "--autoapprove" || token === "--auto-approve") {
			const nextToken = args[index + 1];
			if (isBooleanLikeAutoApproveValue(nextToken)) {
				normalized.push("--auto-approve", nextToken);
				index += 1;
				continue;
			}
			normalized.push("--auto-approve", "true");
			continue;
		}
		if (token.startsWith("--autoapprove=")) {
			normalized.push(token.replace(/^--autoapprove=/, "--auto-approve="));
			continue;
		}
		if (token === "--thinking") {
			const nextToken = args[index + 1];
			if (nextToken !== undefined && !nextToken.startsWith("-")) {
				normalized.push("--thinking", nextToken);
				index += 1;
				continue;
			}
			normalized.push("--thinking", "medium");
			continue;
		}
		if (token === "--reasoning-effort") {
			const nextToken = args[index + 1];
			// Legacy spelling is normalized to --thinking and intentionally relies
			// on commanderToParsedArgs for level validation, so invalid values behave
			// the same as `--thinking <value>` and `--thinking=<value>`.
			if (nextToken !== undefined && !nextToken.startsWith("-")) {
				normalized.push("--thinking", nextToken);
				index += 1;
				continue;
			}
			normalized.push("--thinking", "medium");
			continue;
		}
		if (token.startsWith("--reasoning-effort=")) {
			normalized.push(token.replace(/^--reasoning-effort=/, "--thinking="));
			continue;
		}
		normalized.push(token);
	}
	return normalized;
}

export const normalizeAutoApproveArgs = normalizeCliArgs;

export function parseArgs(args: string[]): ParsedArgs {
	const program = createProgram();
	try {
		program.parse(normalizeCliArgs(args), { from: "user" });
	} catch (_: unknown) {
		// exitOverride throws CommanderError on --help / --version; commander
		// handles output directly, and we treat the thrown error as a signal
		// to exit gracefully in the caller.
	}
	return commanderToParsedArgs(program);
}

export function resolveSandboxDataDir(
	cwd: string,
	explicitDir?: string,
): string {
	const envDir = process.env.CLINE_SANDBOX_DATA_DIR?.trim();
	const baseDir =
		explicitDir?.trim() || envDir || join(tmpdir(), "cline-sandbox");
	return resolve(cwd, baseDir);
}

export function configureSandboxEnvironment(options: {
	enabled: boolean;
	cwd: string;
	explicitDir?: string;
}): string | undefined {
	if (!options.enabled) {
		return undefined;
	}
	const dataDir = resolveSandboxDataDir(options.cwd, options.explicitDir);
	process.env.CLINE_SANDBOX = "1";
	process.env.CLINE_SANDBOX_DATA_DIR = dataDir;
	process.env.CLINE_DATA_DIR = dataDir;
	process.env.CLINE_DB_DATA_DIR = join(dataDir, "db");
	process.env.CLINE_SESSION_DATA_DIR = join(dataDir, "sessions");
	process.env.CLINE_TEAM_DATA_DIR = join(dataDir, "teams");
	process.env.CLINE_PROVIDER_SETTINGS_PATH = join(
		dataDir,
		"settings",
		"providers.json",
	);
	process.env.CLINE_HOOKS_LOG_PATH = join(dataDir, "logs", "hooks.jsonl");
	return dataDir;
}
