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
import {
	getLiveOwnedProcesses,
	observeOwnedProcessTree,
	type ProcessInfo,
	type ProcessTable,
	readProcessTable,
} from "./process-tree";

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
const PROCESS_TREE_TRACK_INTERVAL_MS = 250;
const PROCESS_EXIT_POLL_INTERVAL_MS = 50;
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
	/** PID generations observed while they were descendants of this monitor. */
	ownedProcesses: Map<number, string>;
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
	private processTracker?: NodeJS.Timeout;
	private processTracking?: Promise<void>;
	private processTrackingAvailable = process.platform !== "win32";

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
			ownedProcesses: new Map(),
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
		this.scheduleProcessTracking();

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

		if (entry.status === "running") {
			// Report anything already buffered rather than discarding it, then close
			// the monitor out. The later `close` event finds it settled and is a
			// no-op.
			this.settle(entry, { status: "stopped" });
		}
		await this.terminateEntry(entry);
		return snapshot(entry);
	}

	/** Stops every monitor-owned process, including tracked detached children. */
	async stopAll(): Promise<void> {
		this.stopProcessTracking();
		await this.processTracking;
		this.stopProcessTracking();
		await this.refreshProcessOwnership();
		await Promise.all(
			[...this.monitors.values()].map((entry) => this.terminateEntry(entry)),
		);
	}

	/** Stops everything and refuses further starts. */
	async dispose(): Promise<void> {
		this.disposed = true;
		await this.stopAll();
		this.monitors.clear();
	}

	private async terminateEntry(entry: MonitorEntry): Promise<void> {
		if (entry.status === "running") entry.status = "stopped";
		this.clearFlushTimer(entry);
		entry.settled = true;

		const child = entry.child;
		if (!child) return;
		if (process.platform === "win32") {
			if (this.isChildRunning(child)) {
				const exited = this.waitForExit(child);
				this.killWindowsTree(child);
				await exited;
			}
			return;
		}

		const initialTable = await this.refreshProcessOwnership([entry]);
		const initialProcesses = initialTable
			? getLiveOwnedProcesses(entry.ownedProcesses, initialTable)
			: [];
		if (!this.isChildRunning(child) && initialProcesses.length === 0) return;

		const exited = this.waitForOwnedProcessesExit(entry);
		this.signalOwnedProcesses(entry, initialProcesses, "SIGTERM");
		const gracePeriod =
			this.options.terminationGracePeriodMs ??
			DEFAULT_TERMINATION_GRACE_PERIOD_MS;
		if (await this.waitUntil(exited, gracePeriod)) return;

		// Re-read the table before escalation. A numeric PID is signaled only when
		// its start time still matches the monitor-owned generation captured while
		// it was a descendant, so PID reuse cannot target unrelated work.
		const finalTable = await this.refreshProcessOwnership([entry]);
		const finalProcesses = finalTable
			? getLiveOwnedProcesses(entry.ownedProcesses, finalTable)
			: [];
		this.signalOwnedProcesses(entry, finalProcesses, "SIGKILL");
		// SIGKILL cannot be trapped. Wait until both the direct child and every
		// still-matching tracked descendant have disappeared.
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

	private scheduleProcessTracking(): void {
		if (
			!this.processTrackingAvailable ||
			this.disposed ||
			this.processTracker ||
			this.processTracking ||
			!this.hasLiveDirectChildren()
		) {
			return;
		}

		this.processTracking = this.refreshProcessOwnership()
			.then((table) => {
				if (!table) this.processTrackingAvailable = false;
			})
			.finally(() => {
				this.processTracking = undefined;
				if (
					this.processTrackingAvailable &&
					!this.disposed &&
					this.hasLiveDirectChildren()
				) {
					this.processTracker = setTimeout(() => {
						this.processTracker = undefined;
						this.scheduleProcessTracking();
					}, PROCESS_TREE_TRACK_INTERVAL_MS);
					this.processTracker.unref?.();
				}
			});
	}

	private stopProcessTracking(): void {
		if (!this.processTracker) return;
		clearTimeout(this.processTracker);
		this.processTracker = undefined;
	}

	private hasLiveDirectChildren(): boolean {
		return [...this.monitors.values()].some(
			(entry) => entry.child && this.isChildRunning(entry.child),
		);
	}

	private isChildRunning(child: ChildProcess): boolean {
		return child.exitCode === null && child.signalCode === null;
	}

	private async refreshProcessOwnership(
		entries: readonly MonitorEntry[] = [...this.monitors.values()],
	): Promise<ProcessTable | undefined> {
		if (process.platform === "win32") return undefined;
		const table = await readProcessTable();
		if (!table) return undefined;

		for (const entry of entries) {
			const child = entry.child;
			const rootPids =
				child?.pid && this.isChildRunning(child) ? [child.pid] : [];
			observeOwnedProcessTree(entry.ownedProcesses, rootPids, table);
		}
		return table;
	}

	private async waitForOwnedProcessesExit(entry: MonitorEntry): Promise<void> {
		const child = entry.child;
		if (child && this.isChildRunning(child)) await this.waitForExit(child);

		while (true) {
			const table = await this.refreshProcessOwnership([entry]);
			if (
				!table ||
				getLiveOwnedProcesses(entry.ownedProcesses, table).length === 0
			)
				return;
			await new Promise((resolve) =>
				setTimeout(resolve, PROCESS_EXIT_POLL_INTERVAL_MS),
			);
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

	private killWindowsTree(child: ChildProcess): void {
		const pid = child.pid;
		if (!pid) {
			child.kill();
			return;
		}
		try {
			spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
			});
		} catch {
			child.kill();
		}
	}

	private signalOwnedProcesses(
		entry: MonitorEntry,
		ownedProcesses: readonly ProcessInfo[],
		signal: NodeJS.Signals,
	): void {
		const groups = new Set(
			ownedProcesses
				.map((owned) => owned.processGroupId)
				.filter((processGroupId) => processGroupId > 0),
		);
		const child = entry.child;
		if (child?.pid && this.isChildRunning(child)) groups.add(child.pid);

		for (const processGroupId of groups) {
			try {
				process.kill(-processGroupId, signal);
			} catch {
				// The group may already have exited after the validated table read.
			}
		}
		for (const owned of ownedProcesses) {
			try {
				process.kill(owned.pid, signal);
			} catch {
				// The process may already have exited after the validated table read.
			}
		}
		if (ownedProcesses.length === 0 && child && this.isChildRunning(child)) {
			child.kill(signal);
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
