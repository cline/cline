import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FactoryAppEnvironment, FactoryRunState } from "@cline/shared";
import { killFactoryProcessTree, runFactoryCommand } from "./factory-local";

export const DEFAULT_FACTORY_APP_READY_TIMEOUT_SECONDS = 120;
const SETUP_TIMEOUT_MS = 10 * 60_000;
const CLEANUP_TIMEOUT_MS = 60_000;
const HEALTHCHECK_TIMEOUT_MS = 30_000;
const STOP_WAIT_MS = 5_000;
const TAIL_BYTES = 4096;

export type FactoryAppEnvironmentStage =
	| "setup"
	| "start"
	| "healthcheck"
	| "worktree";

export class FactoryAppEnvironmentError extends Error {
	constructor(
		readonly stage: FactoryAppEnvironmentStage,
		readonly detail: string,
	) {
		super(`Verifier app environment failed (${stage}): ${detail}`);
	}
}

/** What a run records so a crash leftover can be found and stopped later. */
export type FactoryAppEnvironmentRecord = Omit<
	NonNullable<FactoryRunState["verifierEnvironment"]>,
	"key"
>;

export type FactoryAppEnvironmentHandle = {
	port: number;
	url: string;
	logPath: string;
	/** Absent for a setup-only environment. */
	pid?: number;
	/** Kills the app's processes, then runs cleanup. Idempotent; never throws. */
	stop: () => Promise<void>;
};

// Ports handed to environments that are still running in this hub, so
// concurrent runs and replay variants never share one.
const reservedPorts = new Set<number>();

function shell(command: string): { file: string; args: string[] } {
	return process.platform === "win32"
		? { file: "cmd.exe", args: ["/d", "/s", "/c", command] }
		: { file: "/bin/sh", args: ["-c", command] };
}

/** `localhost`, because the app may listen on IPv4 or IPv6 loopback. */
export function factoryAppUrl(port: number): string {
	return `http://localhost:${port}`;
}

function appVariables(
	environment: FactoryAppEnvironment | undefined,
	record: FactoryAppEnvironmentRecord,
): Record<string, string> {
	return {
		FACTORY_APP_PORT: String(record.port),
		FACTORY_APP_URL: factoryAppUrl(record.port),
		...(record.token ? { FACTORY_APP_TOKEN: record.token } : {}),
		[environment?.portEnv ?? "PORT"]: String(record.port),
	};
}

function tail(text: string): string {
	return text.length > TAIL_BYTES ? text.slice(-TAIL_BYTES) : text;
}

async function readLogTail(logPath: string): Promise<string> {
	try {
		const file = await open(logPath, "r");
		try {
			const { size } = await file.stat();
			const length = Math.min(size, TAIL_BYTES);
			const buffer = Buffer.alloc(length);
			await file.read(buffer, 0, length, size - length);
			return buffer.toString("utf8");
		} finally {
			await file.close();
		}
	} catch {
		return "";
	}
}

/** Binds and releases a loopback port; `undefined` when the host has no such address family. */
function bindLoopback(
	host: "127.0.0.1" | "::1",
	port: number,
): Promise<number | undefined> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.once("error", (error: NodeJS.ErrnoException) =>
			host === "::1" &&
			(error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")
				? resolve(undefined)
				: reject(error),
		);
		server.listen(port, host, () => {
			const address = server.address();
			server.close(() =>
				address && typeof address === "object"
					? resolve(address.port)
					: reject(new Error("The OS returned no port")),
			);
		});
	});
}

async function allocatePort(): Promise<number> {
	for (let attempt = 0; attempt < 20; attempt++) {
		const port = await bindLoopback("127.0.0.1", 0);
		if (port === undefined) continue;
		// The app may bind IPv6 loopback, so the port must be free there too.
		const ipv6Free = await bindLoopback("::1", port).then(
			() => true,
			() => false,
		);
		if (ipv6Free && !reservedPorts.has(port)) {
			reservedPorts.add(port);
			return port;
		}
	}
	throw new Error("Could not allocate a free port");
}

function connects(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host, port });
		const done = (connected: boolean) => {
			socket.destroy();
			resolve(connected);
		};
		socket.setTimeout(1000);
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
		socket.once("timeout", () => done(false));
	});
}

/** Whether anything accepts connections on the port over IPv4 or IPv6 loopback. */
export async function factoryAppPortInUse(port: number): Promise<boolean> {
	return (await connects("127.0.0.1", port)) || connects("::1", port);
}

/**
 * Processes carrying the environment's FACTORY_APP_TOKEN. Every environment
 * command and its descendants inherit it, so this identifies Factory's own
 * processes even after a pid was reused. Empty where the environment of
 * other processes cannot be read (Windows).
 */
export async function findFactoryAppProcesses(
	token: string,
): Promise<number[]> {
	const marker = `FACTORY_APP_TOKEN=${token}`;
	if (process.platform === "win32") return [];
	if (process.platform === "linux") {
		const entries = await readdir("/proc").catch(() => [] as string[]);
		const found = await Promise.all(
			entries
				.filter((entry) => /^\d+$/.test(entry))
				.map(async (entry) =>
					(await readFile(`/proc/${entry}/environ`, "utf8").catch(() => ""))
						.split("\0")
						.includes(marker)
						? Number(entry)
						: undefined,
				),
		);
		return found.filter(
			(pid): pid is number => pid !== undefined && pid !== process.pid,
		);
	}
	const listed = await runFactoryCommand({
		cwd: tmpdir(),
		file: "ps",
		args: ["-A", "-ww", "-E", "-o", "pid=,command="],
		maxBytes: 16 * 1024 * 1024,
		timeoutMs: 10_000,
		captureStdout: true,
	}).catch(() => undefined);
	return (listed?.stdout ?? "")
		.split("\n")
		.flatMap((line) => {
			const match = /^\s*(\d+)\s(.*)$/.exec(line);
			return match?.[2]?.split(/\s+/).includes(marker)
				? [Number(match[1])]
				: [];
		})
		.filter((pid) => pid !== process.pid);
}

/**
 * Kills only processes proven to belong to the environment by its token. A
 * recorded pid whose process carries the token also has its process group
 * killed; an unverified pid is never signalled.
 */
async function killFactoryAppProcesses(
	token: string,
	recordedPids: Array<number | undefined>,
): Promise<void> {
	const verified = new Set(await findFactoryAppProcesses(token));
	const signal = (pid: number) => {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	};
	for (const pid of recordedPids) if (pid && verified.has(pid)) signal(-pid);
	for (const pid of verified) signal(pid);
}

/**
 * Pids owning a TCP socket listening on `port` in `netstat -ano` output.
 * Listening rows are recognised by a foreign port of 0 rather than the
 * localized state column.
 */
export function parseNetstatListeningPids(
	output: string,
	port: number,
): number[] {
	const owners = new Set<number>();
	for (const line of output.split(/\r?\n/)) {
		const columns = line.trim().split(/\s+/);
		if (columns[0]?.toUpperCase() !== "TCP" || columns.length < 4) continue;
		const local = /:(\d+)$/.exec(columns[1] ?? "");
		const foreign = /:(\d+)$/.exec(columns[2] ?? "");
		const pid = Number(columns[columns.length - 1]);
		if (
			Number(local?.[1]) === port &&
			Number(foreign?.[1]) === 0 &&
			Number.isInteger(pid) &&
			pid > 0
		)
			owners.add(pid);
	}
	return [...owners];
}

/** Owners of the listening port on Windows; `undefined` when netstat fails. */
async function windowsListeningPids(
	port: number,
): Promise<number[] | undefined> {
	// Without a protocol filter, -a lists TCP over both IPv4 and IPv6.
	const listed = await runFactoryCommand({
		cwd: tmpdir(),
		file: "netstat",
		args: ["-ano"],
		maxBytes: 16 * 1024 * 1024,
		timeoutMs: 10_000,
		captureStdout: true,
	}).catch(() => undefined);
	if (
		!listed ||
		listed.exitCode !== 0 ||
		listed.timedOut ||
		listed.truncated ||
		listed.stdout === undefined
	)
		return undefined;
	return parseNetstatListeningPids(listed.stdout, port);
}

export type FactoryWindowsLeftoverKillPlan = {
	kill: number[];
	skipped: Array<{ pid: number; reason: string }>;
};

/**
 * Decides which recorded pids of a Windows leftover may be tree-killed.
 * Windows cannot read other processes' environments, so the token cannot
 * prove ownership and a recorded pid may since have been reused. A pid is
 * killed only when it owns the socket listening on the recorded port; any
 * other recorded pid (including one whose descendant owns the port) is
 * skipped with the reason, leaving only cleanup to run. When nothing
 * listens on the port the app is gone and the plan is empty.
 */
export async function planWindowsFactoryAppKill(
	record: FactoryAppEnvironmentRecord,
	listeningPids: (port: number) => Promise<number[] | undefined>,
): Promise<FactoryWindowsLeftoverKillPlan> {
	const recordedPids = [
		...new Set(
			[record.pid, record.setupPid].filter(
				(pid): pid is number => typeof pid === "number" && pid > 0,
			),
		),
	];
	const plan: FactoryWindowsLeftoverKillPlan = { kill: [], skipped: [] };
	if (recordedPids.length === 0) return plan;
	if (!record.token) {
		for (const pid of recordedPids)
			plan.skipped.push({
				pid,
				reason: "record has no token (predates identity checks)",
			});
		return plan;
	}
	const owners = await listeningPids(record.port).catch(() => undefined);
	// Nothing listening: the app is gone, so there is nothing to kill or report.
	if (owners?.length === 0) return plan;
	for (const pid of recordedPids) {
		if (owners === undefined)
			plan.skipped.push({
				pid,
				reason: `could not determine the owner of port ${record.port}`,
			});
		else if (owners.includes(pid)) plan.kill.push(pid);
		else
			plan.skipped.push({
				pid,
				reason: `port ${record.port} is owned by pid ${owners.join(", ")}, not this pid`,
			});
	}
	return plan;
}

/**
 * Stops an app that a run recorded but no live handle owns (a crash or
 * restart leftover): kills the processes carrying its token, then runs
 * `cleanup` best-effort. A record without a token predates identity
 * checks, so nothing is killed. On Windows, where other processes'
 * environments cannot be read, a recorded pid's tree is killed only while
 * that pid owns the socket listening on the recorded port (see
 * {@link planWindowsFactoryAppKill}); otherwise only cleanup runs. Never throws.
 */
export async function stopFactoryAppEnvironment(input: {
	environment?: FactoryAppEnvironment;
	cwd: string;
	record: FactoryAppEnvironmentRecord;
}): Promise<void> {
	const { record, environment } = input;
	if (process.platform === "win32") {
		const plan = await planWindowsFactoryAppKill(
			record,
			windowsListeningPids,
		).catch(() => undefined);
		for (const pid of plan?.kill ?? []) killFactoryProcessTree(pid);
		for (const { pid, reason } of plan?.skipped ?? [])
			console.warn(
				`[factory] not killing leftover verifier app pid ${pid}: ${reason}; running cleanup only`,
			);
	} else if (record.token)
		await killFactoryAppProcesses(record.token, [
			record.pid,
			record.setupPid,
		]).catch(() => undefined);
	if (!environment?.cleanup) return;
	await runFactoryCommand({
		cwd: input.cwd,
		...shell(environment.cleanup),
		env: appVariables(environment, record),
		timeoutMs: CLEANUP_TIMEOUT_MS,
	}).catch(() => undefined);
}

/**
 * Prepares and starts the verifier's app in a task worktree on a free port:
 * runs `setup`, spawns `start` detached with output in a log outside the
 * worktree, and waits for `healthcheck` (or a loopback connection) to
 * succeed. Every command gets a random FACTORY_APP_TOKEN so its processes
 * can be identified later. Any failure stops whatever was started, runs
 * cleanup, and throws a {@link FactoryAppEnvironmentError} naming the stage.
 */
export async function startFactoryAppEnvironment(input: {
	environment: FactoryAppEnvironment;
	cwd: string;
	storageDir: string;
	runId: string;
	signal: AbortSignal;
	/** Called whenever the recorded identity grows: port and token, then setup pid, then app pid. */
	record?: (entry: FactoryAppEnvironmentRecord) => void;
	pollMs?: number;
}): Promise<FactoryAppEnvironmentHandle> {
	const { environment, signal, cwd } = input;
	signal.throwIfAborted();
	let port: number;
	try {
		port = await allocatePort();
	} catch (error) {
		throw new FactoryAppEnvironmentError(
			"start",
			error instanceof Error ? error.message : String(error),
		);
	}
	let recorded: FactoryAppEnvironmentRecord = { port, token: randomUUID() };
	const remember = (patch: Partial<FactoryAppEnvironmentRecord>) => {
		recorded = { ...recorded, ...patch };
		input.record?.(recorded);
	};
	const url = factoryAppUrl(port);
	const env = appVariables(environment, recorded);
	const logPath = path.join(
		input.storageDir,
		"factory-app-logs",
		`${createHash("sha256").update(input.runId).digest("hex").slice(0, 24)}.log`,
	);
	let child: ChildProcess | undefined;
	let exitCode: number | null | undefined;
	let exitDescription: string | undefined;
	let exited: Promise<void> = Promise.resolve();
	let stopping: Promise<void> | undefined;
	const stop = () => {
		stopping ??= (async () => {
			// While unreaped, the child's pid cannot be reused, so its group is ours.
			if (child?.pid && exitDescription === undefined) {
				killFactoryProcessTree(child.pid);
				await Promise.race([
					exited,
					new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref()),
				]);
			}
			// Daemons and escaped descendants still carry the token.
			await stopFactoryAppEnvironment({ environment, cwd, record: recorded });
			reservedPorts.delete(port);
		})();
		return stopping;
	};
	try {
		remember({});
		await mkdir(path.dirname(logPath), { recursive: true });
		await writeFile(logPath, "");
		if (environment.setup) {
			const result = await runFactoryCommand({
				cwd,
				...shell(environment.setup),
				env,
				signal,
				timeoutMs: SETUP_TIMEOUT_MS,
				onSpawn: (setupPid) => remember({ setupPid }),
			});
			await writeFile(logPath, `$ setup\n${result.output}\n`);
			if (result.exitCode !== 0 || result.timedOut)
				throw new FactoryAppEnvironmentError(
					"setup",
					`${result.timedOut ? "timed out after 10 minutes" : `exited with code ${result.exitCode}`}.\n${tail(result.output)}`,
				);
		}
		if (!environment.start) return { port, url, logPath, stop };
		signal.throwIfAborted();
		// The port was free when allocated; something may have taken it since.
		if (await factoryAppPortInUse(port))
			throw new FactoryAppEnvironmentError(
				"start",
				`port ${port} already accepted connections before the app started.`,
			);
		const log = await open(logPath, "a");
		try {
			const command = shell(environment.start);
			const spawned = spawn(command.file, command.args, {
				cwd,
				env: { ...process.env, ...env },
				stdio: ["ignore", log.fd, log.fd],
				detached: process.platform !== "win32",
				windowsHide: true,
			});
			child = spawned;
			exited = new Promise<void>((resolve) => {
				spawned.once("exit", (code, killedBy) => {
					exitCode = code;
					exitDescription ??= killedBy
						? `was killed by ${killedBy}`
						: `exited with code ${code}`;
					resolve();
				});
				spawned.once("error", (error) => {
					exitDescription ??= `could not run: ${error.message}`;
					resolve();
				});
			});
			spawned.unref();
		} finally {
			await log.close();
		}
		if (child.pid) remember({ pid: child.pid });
		const timeoutSeconds =
			environment.readyTimeoutSeconds ??
			DEFAULT_FACTORY_APP_READY_TIMEOUT_SECONDS;
		const deadline = Date.now() + timeoutSeconds * 1000;
		let lastHealthcheck = "";
		const ready = async () => {
			if (!environment.healthcheck) return factoryAppPortInUse(port);
			const result = await runFactoryCommand({
				cwd,
				...shell(environment.healthcheck),
				env,
				signal,
				timeoutMs: Math.max(
					1000,
					Math.min(HEALTHCHECK_TIMEOUT_MS, deadline - Date.now()),
				),
			});
			lastHealthcheck = result.output;
			return result.exitCode === 0 && !result.timedOut;
		};
		// A start command may daemonize: exiting with 0 is accepted only when a
		// configured healthcheck then passes. Otherwise it must keep running.
		const daemonized = () => exitCode === 0 && Boolean(environment.healthcheck);
		for (;;) {
			signal.throwIfAborted();
			const passed = await ready();
			signal.throwIfAborted();
			if (passed && (exitDescription === undefined || daemonized())) break;
			if (exitDescription !== undefined && !daemonized())
				throw new FactoryAppEnvironmentError(
					"start",
					`start command ${exitDescription} before the app was ready${exitCode === 0 ? "; without a healthcheck it must keep running" : ""}.\n${await readLogTail(logPath)}`,
				);
			if (Date.now() >= deadline)
				throw new FactoryAppEnvironmentError(
					"healthcheck",
					`${environment.healthcheck ? "healthcheck did not pass" : `nothing accepted connections on port ${port}`} within ${timeoutSeconds} seconds.${lastHealthcheck ? `\nLast healthcheck output:\n${tail(lastHealthcheck)}` : ""}\nApp log:\n${await readLogTail(logPath)}`,
				);
			await new Promise<void>((resolve) => {
				const timer = setTimeout(
					done,
					Math.max(0, Math.min(input.pollMs ?? 2000, deadline - Date.now())),
				);
				function done() {
					clearTimeout(timer);
					signal.removeEventListener("abort", done);
					resolve();
				}
				signal.addEventListener("abort", done, { once: true });
				// Wake early when the app exits; once exited, keep the poll interval.
				if (exitDescription === undefined) void exited.then(done);
			});
		}
		return { port, url, logPath, pid: child.pid, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}
