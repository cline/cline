import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	type AgentPlugin,
	type AgentToolContext,
	createTool,
} from "@clinebot/core";

/**
 * Background Terminal Plugin Example
 *
 * Starts shell commands in detached background processes, stores stdout/stderr
 * under Cline's data directory, and optionally steers a completion summary back
 * into the current session when the command exits.
 *
 * CLI usage:
 *   mkdir -p .cline/plugins
 *   cp apps/examples/plugin-examples/cline-plugin/background-terminal.ts .cline/plugins/background-terminal.ts
 *   cline -i "Start the dev server in the background and keep working"
 */

type JobStatus = "running" | "completed" | "failed";

type JobRecord = {
	jobId: string;
	command: string;
	cwd: string;
	shell: string;
	startedAt: string;
	completedAt?: string;
	status: JobStatus;
	exitCode?: number | null;
	signal?: string | null;
	notifyParent: boolean;
	sessionId?: string;
	pid?: number;
	stdoutPath: string;
	stderrPath: string;
	metaPath: string;
};

interface ClinePluginHost {
	emitEvent?: (name: string, payload?: unknown) => void;
}

declare global {
	var __clinePluginHost: ClinePluginHost | undefined;
}

const DEFAULT_SHELL = process.env.SHELL || "/bin/zsh";
const CLINE_DATA_DIR =
	process.env.CLINE_DATA_DIR || join(homedir(), ".cline", "data");
const JOBS_DIR = join(CLINE_DATA_DIR, "plugins", "background-shell", "jobs");
let sessionDefaultCwd = process.cwd();
let setupSessionId: string | undefined;

function ensureJobsDir() {
	mkdirSync(JOBS_DIR, { recursive: true });
}

function asObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function requireString(value: unknown, field: string) {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value;
}

function optionalString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown) {
	return typeof value === "boolean" ? value : undefined;
}

function optionalInt(value: unknown) {
	return typeof value === "number" && Number.isInteger(value)
		? value
		: undefined;
}

function resolveToolSessionId(context: AgentToolContext): string | undefined {
	return context.sessionId?.trim() || setupSessionId;
}

function jobDir(jobId: string) {
	return join(JOBS_DIR, jobId);
}

function metaPath(jobId: string) {
	return join(jobDir(jobId), "job.json");
}

function stdoutPath(jobId: string) {
	return join(jobDir(jobId), "stdout.log");
}

function stderrPath(jobId: string) {
	return join(jobDir(jobId), "stderr.log");
}

function readTextIfExists(path: string) {
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function tail(text: string, lineCount: number) {
	const lines = text.split(/\r?\n/);
	return lines
		.slice(Math.max(0, lines.length - lineCount))
		.join("\n")
		.trim();
}

function writeJob(record: JobRecord) {
	ensureJobsDir();
	mkdirSync(jobDir(record.jobId), { recursive: true });
	writeFileSync(
		record.metaPath,
		`${JSON.stringify(record, null, 2)}\n`,
		"utf8",
	);
}

/** @returns {JobRecord} */
function readJob(jobId: string) {
	const path = metaPath(jobId);
	if (!existsSync(path)) {
		throw new Error(`Unknown background command job: ${jobId}`);
	}
	return /** @type {JobRecord} */ (JSON.parse(readFileSync(path, "utf8")));
}

function formatCompletionMessage(record: JobRecord) {
	const stdout = tail(readTextIfExists(record.stdoutPath), 80);
	const stderr = tail(readTextIfExists(record.stderrPath), 80);
	const statusLine =
		record.status === "completed"
			? `Background command completed successfully (exit ${record.exitCode ?? 0}).`
			: `Background command failed (exit ${record.exitCode ?? "unknown"}${record.signal ? `, signal ${record.signal}` : ""}).`;

	return [
		"Background shell job finished.",
		`Job ID: ${record.jobId}`,
		`Command: ${record.command}`,
		`CWD: ${record.cwd}`,
		statusLine,
		stdout ? `STDOUT:\n${stdout}` : "STDOUT: <empty>",
		stderr ? `STDERR:\n${stderr}` : "STDERR: <empty>",
	].join("\n\n");
}

function emitSteer(sessionId: string | undefined, prompt: string) {
	if (!sessionId || !prompt.trim()) {
		return;
	}
	globalThis.__clinePluginHost?.emitEvent?.("steer_message", {
		sessionId,
		prompt,
	});
}

function startCommand(
	command: string,
	cwd: string,
	shell: string,
	notifyParent: boolean,
	sessionId: string | undefined,
) {
	ensureJobsDir();
	const jobId = randomUUID();
	mkdirSync(jobDir(jobId), { recursive: true });

	const outPath = stdoutPath(jobId);
	const errPath = stderrPath(jobId);

	const child = spawn(shell, ["-lc", command], {
		cwd,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});

	const record: JobRecord = {
		jobId,
		command,
		cwd,
		shell,
		startedAt: new Date().toISOString(),
		status: "running",
		notifyParent,
		sessionId,
		pid: child.pid,
		stdoutPath: outPath,
		stderrPath: errPath,
		metaPath: metaPath(jobId),
	};
	writeJob(record);

	child.stdout?.on("data", (chunk) => {
		appendFileSync(outPath, chunk);
	});
	child.stderr?.on("data", (chunk) => {
		appendFileSync(errPath, chunk);
	});
	child.on("error", (error) => {
		const current = readJob(jobId);
		const updated = {
			...current,
			status: /** @type {JobStatus} */ ("failed"),
			completedAt: new Date().toISOString(),
			exitCode: null,
			signal: null,
		};
		appendFileSync(errPath, `${error.message}\n`);
		writeJob(updated);
		if (updated.notifyParent) {
			emitSteer(updated.sessionId, formatCompletionMessage(updated));
		}
	});
	child.on("close", (code, signal) => {
		const current = readJob(jobId);
		const updated = {
			...current,
			status: /** @type {JobStatus} */ (code === 0 ? "completed" : "failed"),
			completedAt: new Date().toISOString(),
			exitCode: code,
			signal,
		};
		writeJob(updated);
		if (updated.notifyParent) {
			emitSteer(updated.sessionId, formatCompletionMessage(updated));
		}
	});
	child.unref();

	return record;
}

const plugin: AgentPlugin = {
	name: "background-terminal",
	manifest: {
		capabilities: ["tools"],
	},

	setup(api, ctx) {
		const workspaceContext = ctx.workspaceInfo as
			| { rootPath?: string; cwd?: string }
			| undefined;
		sessionDefaultCwd =
			workspaceContext?.cwd?.trim() ||
			workspaceContext?.rootPath?.trim() ||
			sessionDefaultCwd;
		setupSessionId = ctx.session?.sessionId?.trim() || undefined;

		api.registerTool(
			createTool<unknown, Record<string, unknown>>({
				name: "start_background_command",
				description:
					"Start a shell command in the background, return a job ID immediately, persist stdout/stderr, and optionally push a completion summary back into the current session when it exits.",
				inputSchema: {
					type: "object",
					properties: {
						command: {
							type: "string",
							description: "Shell command to execute.",
						},
						cwd: {
							type: "string",
							description: `Working directory for the command. Defaults to ${sessionDefaultCwd}.`,
						},
						shell: {
							type: "string",
							description: `Shell binary to use. Defaults to ${DEFAULT_SHELL}.`,
						},
						notifyParent: {
							type: "boolean",
							description:
								"When true or omitted, send the final command result back into the session as a steer message.",
						},
					},
					required: ["command"],
					additionalProperties: false,
				},
				timeoutMs: 5000,
				retryable: false,
				async execute(input, context) {
					const args = asObject(input);
					const command = requireString(args.command, "command").trim();
					const cwd = resolve(optionalString(args.cwd) || sessionDefaultCwd);
					const shell = optionalString(args.shell) || DEFAULT_SHELL;
					const notifyParent = optionalBoolean(args.notifyParent) !== false;
					const record = startCommand(
						command,
						cwd,
						shell,
						notifyParent,
						resolveToolSessionId(context),
					);

					return {
						jobId: record.jobId,
						status: record.status,
						command: record.command,
						cwd: record.cwd,
						shell: record.shell,
						pid: record.pid,
						startedAt: record.startedAt,
						notifyParent: record.notifyParent,
						stdoutPath: record.stdoutPath,
						stderrPath: record.stderrPath,
						note: "This tool returns immediately. Use get_background_command to poll, or rely on the automatic completion message when the command exits.",
					};
				},
			}),
		);

		api.registerTool(
			createTool<unknown, Record<string, unknown>>({
				name: "get_background_command",
				description:
					"Read the current state and recent logs for a background shell job.",
				inputSchema: {
					type: "object",
					properties: {
						jobId: {
							type: "string",
							description: "Job ID returned by start_background_command.",
						},
						tailLines: {
							type: "integer",
							description:
								"How many lines of stdout/stderr to include. Defaults to 40.",
						},
					},
					required: ["jobId"],
					additionalProperties: false,
				},
				timeoutMs: 5000,
				retryable: false,
				async execute(input) {
					const args = asObject(input);
					const jobId = requireString(args.jobId, "jobId").trim();
					const tailLines = Math.min(
						200,
						Math.max(1, optionalInt(args.tailLines) || 40),
					);
					const record = readJob(jobId);

					return {
						jobId: record.jobId,
						status: record.status,
						command: record.command,
						cwd: record.cwd,
						shell: record.shell,
						pid: record.pid,
						startedAt: record.startedAt,
						completedAt: record.completedAt,
						exitCode: record.exitCode,
						signal: record.signal,
						stdoutPath: record.stdoutPath,
						stderrPath: record.stderrPath,
						stdoutTail: tail(readTextIfExists(record.stdoutPath), tailLines),
						stderrTail: tail(readTextIfExists(record.stderrPath), tailLines),
					};
				},
			}),
		);

		api.registerTool(
			createTool<unknown, Record<string, unknown>>({
				name: "delete_background_command",
				description:
					"Delete saved metadata for a background shell job. Optionally remove its stdout/stderr log files too.",
				inputSchema: {
					type: "object",
					properties: {
						jobId: {
							type: "string",
							description: "Job ID to delete from local job storage.",
						},
						deleteLogs: {
							type: "boolean",
							description:
								"When true, also delete the captured stdout/stderr files.",
						},
					},
					required: ["jobId"],
					additionalProperties: false,
				},
				timeoutMs: 5000,
				retryable: false,
				async execute(input) {
					const args = asObject(input);
					const jobId = requireString(args.jobId, "jobId").trim();
					const deleteLogs = optionalBoolean(args.deleteLogs) === true;
					const record = readJob(jobId);

					if (deleteLogs && existsSync(jobDir(jobId))) {
						rmSync(jobDir(jobId), { recursive: true, force: true });
					} else if (existsSync(record.metaPath)) {
						rmSync(record.metaPath, { force: true });
					}

					return {
						deleted: true,
						jobId,
						deleteLogs,
					};
				},
			}),
		);
	},
};

export default plugin;
export { plugin };
