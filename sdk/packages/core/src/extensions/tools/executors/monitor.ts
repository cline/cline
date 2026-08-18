/**
 * Monitor Executor
 *
 * Runs persistent background processes and pushes their output to the agent as
 * notifications. Unlike the shell executor, which spawns a process and resolves
 * once with its collected output, a monitor outlives the tool call that started
 * it: the `monitor` tool returns immediately and the process keeps streaming
 * until it exits or is stopped.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { getDefaultShell, getShellInvocation } from "@cline/shared";

/** Lifecycle state of a single monitor. */
export type MonitorStatus = "running" | "exited" | "stopped" | "failed";

/**
 * A batch of output from one monitor, delivered to the host asynchronously.
 *
 * Lines are batched rather than delivered individually so a chatty process
 * (a build log, a `tail -F` on an active file) produces a handful of readable
 * notifications instead of one interruption per line.
 */
export interface MonitorNotification {
	monitorId: string;
	name: string;
	description: string;
	/** Output lines emitted since the previous notification, in order. */
	lines: string[];
	/** How many lines were dropped from this batch by the per-batch cap. */
	droppedLines?: number;
	/** Present only on the final notification, once the process has ended. */
	exit?: {
		status: Exclude<MonitorStatus, "running">;
		code?: number | null;
		signal?: NodeJS.Signals | null;
		/** Populated when the process could not be spawned at all. */
		error?: string;
	};
}

/**
 * Host callback that delivers a notification to the agent.
 *
 * Called long after the originating tool call has settled, so it receives no
 * tool context. Hosts route it to the owning session themselves.
 */
export type MonitorNotifier = (notification: MonitorNotification) => void;

/** Public, serializable view of a monitor. */
export interface MonitorRecord {
	id: string;
	name: string;
	description: string;
	command: string;
	cwd: string;
	startedAt: number;
	status: MonitorStatus;
	exitCode?: number | null;
	signal?: NodeJS.Signals | null;
	error?: string;
	/** Total lines delivered to the notifier since the monitor started. */
	linesEmitted: number;
}

export interface MonitorStartInput {
	name: string;
	command: string;
	description: string;
	cwd?: string;
}

export interface MonitorRegistryOptions {
	/** Delivers batched output. Monitors are inert without one. */
	notifier?: MonitorNotifier;
	/** Working directory for monitor commands. @default process.cwd() */
	cwd?: string;
	/** Shell used to run commands. @default platform default */
	shell?: string;
	/**
	 * How long output is buffered before a notification is delivered. Larger
	 * windows batch more aggressively and interrupt the agent less often.
	 * @default 750
	 */
	flushIntervalMs?: number;
	/** Lines per notification; excess is dropped and reported. @default 40 */
	maxLinesPerNotification?: number;
	/** Characters per line; longer lines are truncated. @default 2000 */
	maxLineChars?: number;
	/** Concurrent running monitors allowed per registry. @default 10 */
	maxMonitors?: number;
	/** Time allowed for graceful shutdown before SIGKILL. @default 2000 */
	terminationGracePeriodMs?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 750;
const DEFAULT_MAX_LINES_PER_NOTIFICATION = 40;
const DEFAULT_MAX_LINE_CHARS = 2_000;
const DEFAULT_MAX_MONITORS = 10;
const DEFAULT_TERMINATION_GRACE_PERIOD_MS = 2_000;
const PROCESS_TREE_DISCOVERY_TIMEOUT_MS = 1_000;
const PROCESS_EXIT_POLL_INTERVAL_MS = 20;
const TRUNCATION_SUFFIX = "… [truncated]";

/** Thrown for conditions the model can correct by calling the tool again. */
export class MonitorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MonitorError";
	}
}

interface MonitorEntry extends MonitorRecord {
	child?: ChildProcess;
	pending: string[];
	droppedInBatch: number;
	flushTimer?: NodeJS.Timeout;
	stdoutDecoder: StringDecoder;
	stderrDecoder: StringDecoder;
	stdoutRemainder: string;
	stderrRemainder: string;
	/** Guards against a double `exit`/`error` settle. */
	settled: boolean;
}

function truncateLine(line: string, maxChars: number): string {
	if (line.length <= maxChars) return line;
	return (
		line.slice(0, Math.max(0, maxChars - TRUNCATION_SUFFIX.length)) +
		TRUNCATION_SUFFIX
	);
}

/**
 * Owns every monitor started within one session.
 *
 * Hosts create one registry per session and call {@link stopAll} on teardown;
 * monitors are deliberately not tied to a turn's abort signal, since the point
 * of a monitor is to keep watching across turns.
 */
export class MonitorRegistry {
	private readonly monitors = new Map<string, MonitorEntry>();
	private counter = 0;
	private disposed = false;

	constructor(private readonly options: MonitorRegistryOptions = {}) {}

	private get flushIntervalMs(): number {
		return this.options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
	}

	private get maxLinesPerNotification(): number {
		return (
			this.options.maxLinesPerNotification ?? DEFAULT_MAX_LINES_PER_NOTIFICATION
		);
	}

	private get maxLineChars(): number {
		return this.options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;
	}

	/** Starts a monitor and returns immediately; output arrives via the notifier. */
	start(input: MonitorStartInput): MonitorRecord {
		if (this.disposed) {
			throw new MonitorError("The monitor registry has been disposed.");
		}

		const name = input.name.trim();
		const command = input.command.trim();
		const description = input.description.trim();
		if (!name) throw new MonitorError("A monitor name is required.");
		if (!command) throw new MonitorError("A monitor command is required.");
		if (!description) {
			throw new MonitorError("A monitor description is required.");
		}

		// Names identify a watch across restarts, so a duplicate almost always
		// means the same watch was started twice rather than that two different
		// things are being watched.
		const existing = this.findRunningByName(name);
		if (existing) {
			throw new MonitorError(
				`A monitor named "${name}" is already running (${existing.id}). ` +
					`Stop it first, or use a different name.`,
			);
		}

		const running = this.listRunning();
		const maxMonitors = this.options.maxMonitors ?? DEFAULT_MAX_MONITORS;
		if (running.length >= maxMonitors) {
			throw new MonitorError(
				`The monitor limit of ${maxMonitors} is already in use. ` +
					`Stop one before starting another.`,
			);
		}

		const cwd = input.cwd ?? this.options.cwd ?? process.cwd();
		const shell = this.options.shell ?? getDefaultShell(process.platform);
		const invocation = getShellInvocation(shell, command);
		const isWindows = process.platform === "win32";

		this.counter += 1;
		const entry: MonitorEntry = {
			id: `mon_${this.counter}`,
			name,
			description,
			command,
			cwd,
			startedAt: Date.now(),
			status: "running",
			linesEmitted: 0,
			pending: [],
			droppedInBatch: 0,
			stdoutDecoder: new StringDecoder("utf8"),
			stderrDecoder: new StringDecoder("utf8"),
			stdoutRemainder: "",
			stderrRemainder: "",
			settled: false,
		};
		this.monitors.set(entry.id, entry);

		let child: ChildProcess;
		try {
			child = spawn(shell, invocation.args, {
				cwd,
				env: process.env,
				stdio: ["pipe", "pipe", "pipe"],
				// A process group lets us kill the whole tree on stop; monitors are
				// typically pipelines (`tail -F x | grep y`) whose children would
				// otherwise survive.
				detached: !isWindows,
				windowsHide: true,
			});
		} catch (error) {
			entry.status = "failed";
			entry.error = error instanceof Error ? error.message : String(error);
			throw new MonitorError(
				`Failed to start monitor "${name}": ${entry.error}`,
			);
		}

		entry.child = child;

		child.stdout?.on("data", (chunk: Buffer) => {
			this.ingest(entry, chunk, "stdout");
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			this.ingest(entry, chunk, "stderr");
		});
		child.on("error", (error) => {
			this.settle(entry, {
				status: "failed",
				error: error.message,
			});
		});
		child.on("close", (code, signal) => {
			// A monitor stopped on request has already been settled; `close` here
			// is just the kill landing.
			this.settle(entry, {
				status: entry.status === "stopped" ? "stopped" : "exited",
				code,
				signal,
			});
		});

		// Monitors read no input. Closing stdin also delivers the command for
		// shells that take it that way (PowerShell).
		child.stdin?.on("error", () => {});
		child.stdin?.end(invocation.input ?? "", "utf8");

		return snapshot(entry);
	}

	list(): MonitorRecord[] {
		return [...this.monitors.values()].map(snapshot);
	}

	listRunning(): MonitorRecord[] {
		return this.list().filter((record) => record.status === "running");
	}

	/**
	 * Stops one monitor by id or name. Returns the final record, or undefined
	 * when nothing matched.
	 */
	async stop(idOrName: string): Promise<MonitorRecord | undefined> {
		const key = idOrName.trim();
		const entry =
			this.monitors.get(key) ??
			this.findRunningEntryByName(key) ??
			[...this.monitors.values()].find((candidate) => candidate.name === key);
		if (!entry) return undefined;
		if (entry.status !== "running") return snapshot(entry);

		// Report anything already buffered rather than discarding it, then close
		// the monitor out. The later `close` event finds it settled and is a
		// no-op.
		this.settle(entry, { status: "stopped" });
		await this.terminateEntry(entry);
		return snapshot(entry);
	}

	/** Stops every live monitor process and waits until each has exited. */
	async stopAll(): Promise<void> {
		const live = [...this.monitors.values()].filter(
			(entry) =>
				entry.child &&
				entry.child.exitCode === null &&
				entry.child.signalCode === null,
		);
		await Promise.all(live.map((entry) => this.terminateEntry(entry)));
	}

	/** Stops everything and refuses further starts. */
	async dispose(): Promise<void> {
		this.disposed = true;
		await this.stopAll();
		this.monitors.clear();
	}

	private async terminateEntry(entry: MonitorEntry): Promise<void> {
		entry.status = "stopped";
		this.clearFlushTimer(entry);
		entry.settled = true;

		const child = entry.child;
		if (!child || child.exitCode !== null || child.signalCode !== null) return;
		const pid = child.pid;
		if (!pid) {
			child.kill();
			await this.waitForExit(child);
			return;
		}

		// A child can call setsid(2) and leave the process group created for the
		// monitor. Snapshot the ancestry before signaling the shell, while those
		// escaped descendants can still be traced back to it.
		const processTree = await this.captureProcessTree(pid);
		const exited = this.waitForProcessTreeExit(child, processTree);
		this.killEntry(entry, "SIGTERM", processTree);
		const gracePeriod =
			this.options.terminationGracePeriodMs ??
			DEFAULT_TERMINATION_GRACE_PERIOD_MS;
		if (await this.waitUntil(exited, gracePeriod)) return;

		this.killEntry(entry, "SIGKILL", processTree);
		// SIGKILL cannot be trapped on POSIX. Keep the handle until process exit
		// is observed so teardown never loses ownership of a live process tree.
		await exited;
	}

	private waitForExit(child: ChildProcess): Promise<void> {
		if (child.exitCode !== null || child.signalCode !== null) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			// `close` also waits for stdio streams. An escaped descendant can keep
			// an inherited pipe open indefinitely even after this child is dead;
			// `exit` tracks the owned process itself and cannot be held by that pipe.
			const onExit = () => resolve();
			child.once("exit", onExit);
			// Cover an exit between the state check above and listener registration.
			if (child.exitCode !== null || child.signalCode !== null) {
				child.off("exit", onExit);
				resolve();
			}
		});
	}

	private async captureProcessTree(rootPid: number): Promise<number[]> {
		if (process.platform === "win32") return [rootPid];

		const processTable = await this.readProcessTable();
		if (!processTable) return [rootPid];

		const childrenByParent = new Map<number, number[]>();
		for (const line of processTable.split(/\r?\n/)) {
			const [pidText, parentPidText] = line.trim().split(/\s+/, 2);
			const pid = Number.parseInt(pidText ?? "", 10);
			const parentPid = Number.parseInt(parentPidText ?? "", 10);
			if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue;
			const children = childrenByParent.get(parentPid) ?? [];
			children.push(pid);
			childrenByParent.set(parentPid, children);
		}

		const processTree = [rootPid];
		const seen = new Set(processTree);
		for (let index = 0; index < processTree.length; index += 1) {
			const parentPid = processTree[index];
			if (parentPid === undefined) continue;
			for (const childPid of childrenByParent.get(parentPid) ?? []) {
				if (seen.has(childPid)) continue;
				seen.add(childPid);
				processTree.push(childPid);
			}
		}
		return processTree;
	}

	private readProcessTable(): Promise<string | undefined> {
		return new Promise((resolve) => {
			let output = "";
			let finished = false;
			let watchdog: NodeJS.Timeout | undefined;
			const finish = (result?: string) => {
				if (finished) return;
				finished = true;
				if (watchdog) clearTimeout(watchdog);
				resolve(result);
			};
			let ps: ChildProcess;
			try {
				ps = spawn("ps", ["-A", "-o", "pid=,ppid="], {
					stdio: ["ignore", "pipe", "ignore"],
					windowsHide: true,
				});
			} catch {
				finish();
				return;
			}
			watchdog = setTimeout(() => {
				ps.kill();
				finish();
			}, PROCESS_TREE_DISCOVERY_TIMEOUT_MS);
			ps.stdout?.setEncoding("utf8");
			ps.stdout?.on("data", (chunk: string) => {
				output += chunk;
			});
			ps.once("error", () => finish());
			ps.once("close", (code) => finish(code === 0 ? output : undefined));
		});
	}

	private async waitForProcessTreeExit(
		child: ChildProcess,
		processTree: readonly number[],
	): Promise<void> {
		await this.waitForExit(child);
		if (process.platform === "win32") return;
		while (processTree.some((pid) => this.isProcessAlive(pid))) {
			await new Promise((resolve) =>
				setTimeout(resolve, PROCESS_EXIT_POLL_INTERVAL_MS),
			);
		}
	}

	private isProcessAlive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code !== "ESRCH";
		}
	}

	private async waitUntil(
		promise: Promise<void>,
		timeoutMs: number,
	): Promise<boolean> {
		let timer: NodeJS.Timeout | undefined;
		const timedOut = await Promise.race([
			promise.then(() => false),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(true), timeoutMs);
			}),
		]);
		if (timer) clearTimeout(timer);
		return !timedOut;
	}

	private findRunningByName(name: string): MonitorRecord | undefined {
		const entry = this.findRunningEntryByName(name);
		return entry ? snapshot(entry) : undefined;
	}

	private findRunningEntryByName(name: string): MonitorEntry | undefined {
		for (const entry of this.monitors.values()) {
			if (entry.name === name && entry.status === "running") return entry;
		}
		return undefined;
	}

	private killEntry(
		entry: MonitorEntry,
		signal: NodeJS.Signals = "SIGTERM",
		processTree: readonly number[] = [],
	): void {
		const child = entry.child;
		const pid = child?.pid;
		if (!child || !pid) return;
		if (process.platform === "win32") {
			try {
				spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
					stdio: "ignore",
					windowsHide: true,
				});
			} catch {
				child.kill();
			}
			return;
		}
		for (const ownedPid of new Set([pid, ...processTree])) {
			try {
				// Negative pid targets any process group led by this descendant. This
				// covers both the original detached group and descendants that called
				// setsid(2) or setpgid(2) after launch.
				process.kill(-ownedPid, signal);
			} catch {
				// Most descendants are not group leaders.
			}
			try {
				process.kill(ownedPid, signal);
			} catch {
				// The process may already have exited after the tree snapshot.
			}
		}
	}

	private ingest(
		entry: MonitorEntry,
		chunk: Buffer,
		stream: "stdout" | "stderr",
	): void {
		if (entry.settled) return;
		const decoder =
			stream === "stdout" ? entry.stdoutDecoder : entry.stderrDecoder;
		const remainder =
			stream === "stdout" ? entry.stdoutRemainder : entry.stderrRemainder;
		const text = remainder + decoder.write(chunk);
		const parts = text.split(/\r?\n/);
		// The trailing element is an unterminated line; hold it until more
		// arrives so a line split across chunks is never reported twice.
		const tail = parts.pop() ?? "";
		if (stream === "stdout") {
			entry.stdoutRemainder = tail;
		} else {
			entry.stderrRemainder = tail;
		}

		for (const part of parts) {
			this.queueLine(entry, stream === "stderr" ? `[stderr] ${part}` : part);
		}
		if (entry.pending.length > 0) this.scheduleFlush(entry);
	}

	private queueLine(entry: MonitorEntry, line: string): void {
		if (entry.pending.length >= this.maxLinesPerNotification) {
			entry.droppedInBatch += 1;
			return;
		}
		entry.pending.push(truncateLine(line, this.maxLineChars));
	}

	private scheduleFlush(entry: MonitorEntry): void {
		if (entry.flushTimer) return;
		entry.flushTimer = setTimeout(() => {
			entry.flushTimer = undefined;
			this.flush(entry);
		}, this.flushIntervalMs);
		// A pending flush must not hold the process open on its own.
		entry.flushTimer.unref?.();
	}

	private clearFlushTimer(entry: MonitorEntry): void {
		if (!entry.flushTimer) return;
		clearTimeout(entry.flushTimer);
		entry.flushTimer = undefined;
	}

	private flush(entry: MonitorEntry, exit?: MonitorNotification["exit"]): void {
		const notifier = this.options.notifier;
		const lines = entry.pending;
		const dropped = entry.droppedInBatch;
		entry.pending = [];
		entry.droppedInBatch = 0;

		if (lines.length === 0 && !exit) return;
		entry.linesEmitted += lines.length;
		if (!notifier) return;

		const notification: MonitorNotification = {
			monitorId: entry.id,
			name: entry.name,
			description: entry.description,
			lines,
		};
		if (dropped > 0) notification.droppedLines = dropped;
		if (exit) notification.exit = exit;

		try {
			notifier(notification);
		} catch {
			// A failing host notifier must not take the monitor down with it.
		}
	}

	private settle(
		entry: MonitorEntry,
		outcome: {
			status: Exclude<MonitorStatus, "running">;
			code?: number | null;
			signal?: NodeJS.Signals | null;
			error?: string;
		},
	): void {
		if (entry.settled) return;
		entry.settled = true;
		this.clearFlushTimer(entry);

		entry.status = outcome.status;
		entry.exitCode = outcome.code ?? undefined;
		entry.signal = outcome.signal ?? undefined;
		if (outcome.error) entry.error = outcome.error;

		// Drain whatever the process wrote without a trailing newline before it
		// ended; otherwise the last line of output is silently lost.
		const trailing = [entry.stdoutRemainder, entry.stderrRemainder];
		entry.stdoutRemainder = "";
		entry.stderrRemainder = "";
		for (const [index, text] of trailing.entries()) {
			if (!text) continue;
			this.queueLine(entry, index === 1 ? `[stderr] ${text}` : text);
		}

		this.flush(entry, {
			status: outcome.status,
			code: outcome.code,
			signal: outcome.signal,
			error: outcome.error,
		});
	}
}

function snapshot(entry: MonitorEntry): MonitorRecord {
	return {
		id: entry.id,
		name: entry.name,
		description: entry.description,
		command: entry.command,
		cwd: entry.cwd,
		startedAt: entry.startedAt,
		status: entry.status,
		exitCode: entry.exitCode,
		signal: entry.signal,
		error: entry.error,
		linesEmitted: entry.linesEmitted,
	};
}

/** Formats a notification as the text injected into the agent's transcript. */
export function formatMonitorNotification(
	notification: MonitorNotification,
): string {
	const header = `[monitor: ${notification.name}] ${notification.description}`;
	const body = notification.lines.join("\n");
	const parts = [header];
	if (body) parts.push(body);
	if (notification.droppedLines) {
		parts.push(
			`[${notification.droppedLines} more line(s) dropped to keep this update small]`,
		);
	}
	if (notification.exit) {
		parts.push(formatExit(notification));
	}
	return parts.join("\n");
}

function formatExit(notification: MonitorNotification): string {
	const exit = notification.exit;
	if (!exit) return "";
	const id = notification.monitorId;
	switch (exit.status) {
		case "stopped":
			return `[monitor ${id} stopped]`;
		case "failed":
			return `[monitor ${id} failed to run: ${exit.error ?? "unknown error"}]`;
		default: {
			if (exit.signal) {
				return `[monitor ${id} ended on signal ${exit.signal}]`;
			}
			return `[monitor ${id} ended with exit code ${exit.code ?? 0}]`;
		}
	}
}
