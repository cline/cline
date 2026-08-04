import { type ChildProcess, spawn } from "node:child_process";
import { openSync } from "node:fs";
import {
	CLINE_CONNECTOR_SUPERVISED_ENV,
	type ConnectorCliLaunchSpec,
	type ConnectorStartRequest,
	type ConnectorStartResult,
	readConnectorCliLaunchSpec,
	type SupervisedConnectorOrigin,
	type SupervisedConnectorRecord,
	type SupervisedConnectorState,
} from "@cline/shared";
import {
	ensureParentDir,
	resolveConnectorLogPath,
} from "@cline/shared/storage";
import { listActiveConnectors } from "./active-connectors";
import {
	disableConnectorAutostart,
	getPersistedConnectorConnection,
} from "./connector-autostart";
import { buildConnectorChildEnv } from "./connector-child-env";

export const RESTART_BASE_DELAY_MS = 1_000;
export const RESTART_MAX_DELAY_MS = 60_000;
/** Consecutive failed restarts before the hub stops trying. */
export const RESTART_GIVE_UP_AFTER = 5;
/**
 * A run that lasts this long is treated as healthy, clearing the restart
 * counter. Without it a connector that stays up for hours and then dies would
 * inherit stale failures and be given up on immediately.
 */
export const RESTART_COUNTER_RESET_MS = 60_000;
/** How often adopted connectors (no child handle) are checked for liveness. */
export const ADOPTED_POLL_INTERVAL_MS = 5_000;
/** How long a stop waits for SIGTERM to land before escalating to SIGKILL. */
export const STOP_SIGTERM_TIMEOUT_MS = 5_000;
/** How long a stop waits for SIGKILL to land before giving up on the wait. */
export const STOP_SIGKILL_TIMEOUT_MS = 2_000;
const EXIT_POLL_INTERVAL_MS = 100;

export interface ConnectorSupervisorDeps {
	launchSpec?: () => ConnectorCliLaunchSpec | undefined;
	spawnProcess?: typeof spawn;
	isProcessRunning?: (pid: number) => boolean;
	killProcess?: (pid: number, signal: NodeJS.Signals) => void;
	listActive?: typeof listActiveConnectors;
	/**
	 * Reap a dead instance's leftovers: state file, thread bindings and hub
	 * sessions. Delegated because all of that is connector-specific and owned by
	 * the CLI; the supervisor only knows a process died.
	 */
	cleanupInstance?: (channel: string, instanceId: string) => Promise<void>;
	isAutostartEnabled?: (channel: string, instanceId: string) => boolean;
	log?: (message: string) => void;
	now?: () => number;
	setTimer?: (callback: () => void, delayMs: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

interface SupervisedEntry {
	channel: string;
	instanceId: string;
	args: string[];
	/**
	 * Whether `args` is this instance's real argv. An adopted process's argv is
	 * not ours to reconstruct, and an empty argv is legitimate for a connector
	 * configured entirely through the connector store — so emptiness cannot
	 * stand in for "unknown".
	 */
	argsKnown: boolean;
	origin: SupervisedConnectorOrigin;
	state: SupervisedConnectorState;
	pid?: number;
	child?: ChildProcess;
	startedAt?: number;
	restarts: number;
	nextRestartAt?: number;
	restartTimer?: unknown;
	lastExitCode?: number;
	lastExitSignal?: string;
	lastError?: string;
}

function instanceKey(channel: string, instanceId: string): string {
	return `${channel}\u0000${instanceId}`;
}

function defaultIsProcessRunning(pid: number): boolean {
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

function toIsoString(value: number | undefined): string | undefined {
	return value === undefined ? undefined : new Date(value).toISOString();
}

/**
 * Owns the lifecycle of connector processes on behalf of the hub.
 *
 * Three responsibilities, in order of why this exists:
 *
 * 1. **Single instance per (channel, instanceId).** The in-memory map is the
 *    authority, so two connectors can never hold the same bot token because two
 *    processes raced on a state file.
 * 2. **Reaping.** When a connector dies its state file, thread bindings and hub
 *    sessions would otherwise linger until the next manual start, leaving
 *    Slack threads bound to sessions that no longer exist.
 * 3. **Restart with backoff.** Replaces external watchdogs, and refuses to
 *    spin forever on a connector that cannot start (a revoked token).
 *
 * Connectors are spawned detached so a hub restart does not take them down; a
 * later hub adopts the survivors by pid from their state files. That is why exit
 * detection has two paths: child events for processes this hub spawned, pid
 * polling for adopted ones.
 */
export class ConnectorSupervisor {
	private readonly entries = new Map<string, SupervisedEntry>();
	/**
	 * Tail of the in-flight start/stop chain per instance key. `start` suspends
	 * on `stop` (which shells into the CLI for cleanup, taking seconds), and two
	 * unserialised starts interleaving across that suspension each spawn their
	 * own process — the map ends up tracking one while the other survives as an
	 * untracked ghost holding the connector's credentials and ports.
	 */
	private readonly instanceLocks = new Map<string, Promise<unknown>>();
	private pollTimer: unknown;
	private disposed = false;

	private readonly launchSpec: () => ConnectorCliLaunchSpec | undefined;
	private readonly spawnProcess: typeof spawn;
	private readonly isProcessRunning: (pid: number) => boolean;
	private readonly killProcess: (pid: number, signal: NodeJS.Signals) => void;
	private readonly listActive: typeof listActiveConnectors;
	private readonly cleanupInstance?: (
		channel: string,
		instanceId: string,
	) => Promise<void>;
	private readonly isAutostartEnabled: (
		channel: string,
		instanceId: string,
	) => boolean;
	private readonly log: (message: string) => void;
	private readonly now: () => number;
	private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;

	constructor(deps: ConnectorSupervisorDeps = {}) {
		this.launchSpec = deps.launchSpec ?? readConnectorCliLaunchSpec;
		this.spawnProcess = deps.spawnProcess ?? spawn;
		this.isProcessRunning = deps.isProcessRunning ?? defaultIsProcessRunning;
		this.killProcess =
			deps.killProcess ?? ((pid, signal) => process.kill(pid, signal));
		this.listActive = deps.listActive ?? listActiveConnectors;
		this.cleanupInstance = deps.cleanupInstance;
		this.isAutostartEnabled =
			deps.isAutostartEnabled ??
			((channel, instanceId) =>
				getPersistedConnectorConnection(channel, instanceId)?.enabled === true);
		this.log =
			deps.log ??
			((message) => process.stderr.write(`[hub-daemon] ${message}\n`));
		this.now = deps.now ?? (() => Date.now());
		this.setTimer =
			deps.setTimer ??
			((callback, delayMs) => {
				const timer = setTimeout(callback, delayMs);
				// Never let a pending restart hold the process open.
				timer.unref?.();
				return timer;
			});
		this.clearTimer =
			deps.clearTimer ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
	}

	/**
	 * Take over connectors that are already running, so a replacement hub reaps
	 * and restarts the processes it inherited instead of ignoring them.
	 */
	adoptRunningConnectors(): SupervisedConnectorRecord[] {
		const adopted: SupervisedConnectorRecord[] = [];
		for (const record of this.listActive()) {
			const key = instanceKey(record.type, record.instanceId);
			if (this.entries.has(key)) {
				continue;
			}
			const entry: SupervisedEntry = {
				channel: record.type,
				instanceId: record.instanceId,
				// Reconstructed from the autostart record on the first restart.
				args: [],
				argsKnown: false,
				origin: "adopted",
				state: "running",
				pid: record.pid,
				startedAt: record.startedAt ? Date.parse(record.startedAt) : this.now(),
				restarts: 0,
			};
			this.entries.set(key, entry);
			adopted.push(this.toRecord(entry));
			this.log(
				`[connect] adopted running ${record.type} connector ${record.instanceId} pid=${record.pid}`,
			);
		}
		if (adopted.length > 0) {
			this.ensurePolling();
		}
		return adopted;
	}

	/**
	 * Serialise start/stop work per instance key. Both operations suspend
	 * mid-flight — a stop waits for the process to die and for the CLI cleanup,
	 * a start may embed a stop — and interleaving two of them across those
	 * suspensions is how the map ends up tracking one process while another
	 * lives on untracked. One instance, one queue.
	 */
	private withInstanceLock<T>(key: string, task: () => Promise<T>): Promise<T> {
		const previous = this.instanceLocks.get(key) ?? Promise.resolve();
		const run = previous.then(task, task);
		const tail = run.then(
			() => undefined,
			() => undefined,
		);
		this.instanceLocks.set(key, tail);
		void tail.then(() => {
			if (this.instanceLocks.get(key) === tail) {
				this.instanceLocks.delete(key);
			}
		});
		return run;
	}

	async start(request: ConnectorStartRequest): Promise<ConnectorStartResult> {
		return this.withInstanceLock(
			instanceKey(request.channel, request.instanceId),
			() => this.startLocked(request),
		);
	}

	private async startLocked(
		request: ConnectorStartRequest,
	): Promise<ConnectorStartResult> {
		const { channel, instanceId } = request;
		const key = instanceKey(channel, instanceId);
		const existing = this.entries.get(key);
		if (existing && this.isEntryAlive(existing)) {
			if (!request.restart) {
				return {
					started: false,
					reason: "already_running",
					record: this.toRecord(existing),
				};
			}
			await this.stopLocked({ channel, instanceId, disableAutostart: false });
		} else if (existing) {
			// A dead entry can still act: a pending backoff timer would spawn a
			// second process for this instance once it fires — untracked, so
			// unstoppable — and an exit-cleanup chain still in flight would
			// schedule that timer after this replacement is made. Retire the old
			// entry explicitly; both paths check for "stopped" and stand down.
			this.cancelRestart(existing);
			existing.state = "stopped";
			existing.child?.removeAllListeners("exit");
		}
		const entry: SupervisedEntry = {
			channel,
			instanceId,
			args: [...request.args],
			argsKnown: true,
			origin: "spawned",
			state: "running",
			restarts: existing?.restarts ?? 0,
		};
		this.entries.set(key, entry);
		this.spawnEntry(entry);
		if (entry.state !== "running") {
			return { started: false, record: this.toRecord(entry) };
		}
		return { started: true, record: this.toRecord(entry) };
	}

	async stop(request: {
		channel: string;
		instanceId: string;
		disableAutostart?: boolean;
	}): Promise<boolean> {
		return this.withInstanceLock(
			instanceKey(request.channel, request.instanceId),
			() => this.stopLocked(request),
		);
	}

	private async stopLocked(request: {
		channel: string;
		instanceId: string;
		disableAutostart?: boolean;
	}): Promise<boolean> {
		const key = instanceKey(request.channel, request.instanceId);
		const entry = this.entries.get(key);
		if (request.disableAutostart !== false) {
			disableConnectorAutostart(request.channel, request.instanceId);
		}
		if (!entry) {
			return false;
		}
		this.cancelRestart(entry);
		// Mark before signalling so the exit handler does not restart it.
		entry.state = "stopped";
		const pid = entry.child?.pid ?? entry.pid;
		if (pid && this.isProcessRunning(pid)) {
			this.signal(pid, "SIGTERM");
			// Wait for the process to actually die. A replacement spawned while
			// the old process still holds the connector's listen port or socket
			// fails on it — observed as an EADDRINUSE crash loop when a webhook
			// connector was restarted for a new hub session.
			if (!(await this.waitForProcessExit(pid, STOP_SIGTERM_TIMEOUT_MS))) {
				this.signal(pid, "SIGKILL");
				await this.waitForProcessExit(pid, STOP_SIGKILL_TIMEOUT_MS);
			}
		}
		await this.runCleanup(entry);
		this.entries.delete(key);
		return true;
	}

	private signal(pid: number, signal: NodeJS.Signals): void {
		try {
			this.killProcess(pid, signal);
		} catch {
			// Already gone, or not ours to signal.
		}
	}

	private async waitForProcessExit(
		pid: number,
		timeoutMs: number,
	): Promise<boolean> {
		const deadline = this.now() + timeoutMs;
		while (this.isProcessRunning(pid)) {
			if (this.now() >= deadline) {
				return false;
			}
			await new Promise<void>((resolve) => {
				this.setTimer(resolve, EXIT_POLL_INTERVAL_MS);
			});
		}
		return true;
	}

	list(): SupervisedConnectorRecord[] {
		return [...this.entries.values()]
			.map((entry) => this.toRecord(entry))
			.sort(
				(left, right) =>
					left.channel.localeCompare(right.channel) ||
					left.instanceId.localeCompare(right.instanceId),
			);
	}

	/**
	 * Stop supervising without touching the processes: they are detached and
	 * outlive this hub on purpose, and the next hub adopts them.
	 */
	dispose(): void {
		this.disposed = true;
		for (const entry of this.entries.values()) {
			this.cancelRestart(entry);
			entry.child?.removeAllListeners("exit");
		}
		if (this.pollTimer !== undefined) {
			this.clearTimer(this.pollTimer);
			this.pollTimer = undefined;
		}
		this.entries.clear();
		this.instanceLocks.clear();
	}

	private spawnEntry(entry: SupervisedEntry): void {
		const spec = this.launchSpec();
		if (!spec) {
			entry.state = "failed";
			entry.lastError = "connector CLI launch information is unavailable";
			this.log(
				`[connect] cannot start ${entry.channel} connector ${entry.instanceId}: ${entry.lastError}`,
			);
			return;
		}
		const logPath = resolveConnectorLogPath(entry.channel, entry.instanceId);
		let stdio: ["ignore", "ignore" | number, "ignore" | number] = [
			"ignore",
			"ignore",
			"ignore",
		];
		try {
			ensureParentDir(logPath);
			const fd = openSync(logPath, "a");
			stdio = ["ignore", fd, fd];
		} catch {
			// Without a log the connector still runs; only diagnostics are lost.
		}
		try {
			const child = this.spawnProcess(
				spec.launcher,
				[...spec.connectArgsPrefix, entry.channel, ...entry.args],
				{
					cwd: spec.cwd,
					env: {
						...buildConnectorChildEnv(),
						// Tells the connector to run in this process rather than asking
						// the hub to start it (which would loop back here) or spawning
						// its own detached child and exiting (which would leave us
						// holding a handle to a process that is already gone).
						[CLINE_CONNECTOR_SUPERVISED_ENV]: "1",
					},
					// Detached so it survives this hub, but not unref'd from our
					// listener: we still want the exit event while we are alive.
					detached: true,
					stdio,
					windowsHide: true,
				},
			);
			entry.child = child;
			entry.pid = child.pid ?? undefined;
			entry.startedAt = this.now();
			entry.state = "running";
			entry.lastError = undefined;
			child.unref?.();
			child.once("error", (error: unknown) => {
				entry.lastError =
					error instanceof Error ? error.message : String(error);
				this.handleExit(entry, undefined, undefined);
			});
			child.once("exit", (code: number | null, signal: string | null) => {
				this.handleExit(entry, code ?? undefined, signal ?? undefined);
			});
			this.log(
				`[connect] started ${entry.channel} connector ${entry.instanceId} pid=${entry.pid}`,
			);
		} catch (error) {
			entry.state = "backoff";
			entry.lastError = error instanceof Error ? error.message : String(error);
			this.log(
				`[connect] failed to spawn ${entry.channel} connector ${entry.instanceId}: ${entry.lastError}`,
			);
			this.scheduleRestart(entry);
		}
	}

	private handleExit(
		entry: SupervisedEntry,
		code: number | undefined,
		signal: string | undefined,
	): void {
		if (this.disposed || entry.state === "stopped") {
			return;
		}
		entry.child = undefined;
		entry.pid = undefined;
		entry.lastExitCode = code;
		entry.lastExitSignal = signal;
		const ranLongEnough =
			entry.startedAt !== undefined &&
			this.now() - entry.startedAt >= RESTART_COUNTER_RESET_MS;
		if (ranLongEnough) {
			entry.restarts = 0;
		}
		this.log(
			`[connect] ${entry.channel} connector ${entry.instanceId} exited` +
				`${code === undefined ? "" : ` code=${code}`}` +
				`${signal ? ` signal=${signal}` : ""}`,
		);
		void this.runCleanup(entry).then(() => {
			const key = instanceKey(entry.channel, entry.instanceId);
			if (
				this.disposed ||
				entry.state === "stopped" ||
				// A concurrent start may have replaced this entry while cleanup was
				// running; the retired generation must not restart or delete the
				// replacement's map entry.
				this.entries.get(key) !== entry
			) {
				return;
			}
			if (!this.isAutostartEnabled(entry.channel, entry.instanceId)) {
				this.log(
					`[connect] not restarting ${entry.channel} connector ${entry.instanceId}: autostart is disabled`,
				);
				this.entries.delete(key);
				return;
			}
			this.scheduleRestart(entry);
		});
	}

	private scheduleRestart(entry: SupervisedEntry): void {
		if (entry.restarts >= RESTART_GIVE_UP_AFTER) {
			entry.state = "failed";
			entry.nextRestartAt = undefined;
			this.log(
				`[connect] giving up on ${entry.channel} connector ${entry.instanceId} after ${entry.restarts} failed restarts` +
					`${entry.lastError ? `: ${entry.lastError}` : ""}`,
			);
			return;
		}
		const delayMs = Math.min(
			RESTART_BASE_DELAY_MS * 2 ** entry.restarts,
			RESTART_MAX_DELAY_MS,
		);
		entry.restarts += 1;
		entry.state = "backoff";
		entry.nextRestartAt = this.now() + delayMs;
		this.log(
			`[connect] restarting ${entry.channel} connector ${entry.instanceId} in ${delayMs}ms (attempt ${entry.restarts})`,
		);
		const key = instanceKey(entry.channel, entry.instanceId);
		entry.restartTimer = this.setTimer(() => {
			entry.restartTimer = undefined;
			entry.nextRestartAt = undefined;
			// Under the instance lock: a restart spawn must not interleave with a
			// start or stop in flight for the same instance.
			void this.withInstanceLock(key, async () => {
				if (
					this.disposed ||
					entry.state === "stopped" ||
					this.entries.get(key) !== entry
				) {
					return;
				}
				const args = this.resolveRestartArgs(entry);
				if (!args) {
					entry.state = "failed";
					this.log(
						`[connect] cannot restart ${entry.channel} connector ${entry.instanceId}: no stored launch arguments`,
					);
					return;
				}
				entry.args = args;
				entry.argsKnown = true;
				entry.origin = "spawned";
				this.spawnEntry(entry);
			});
		}, delayMs);
	}

	/**
	 * An adopted connector has no argv of its own here, so its restart arguments
	 * come from the persisted autostart record.
	 */
	private resolveRestartArgs(entry: SupervisedEntry): string[] | undefined {
		if (entry.argsKnown) {
			return entry.args;
		}
		const persisted = getPersistedConnectorConnection(
			entry.channel,
			entry.instanceId,
		);
		return persisted?.connectArgs?.length ? persisted.connectArgs : undefined;
	}

	private cancelRestart(entry: SupervisedEntry): void {
		if (entry.restartTimer !== undefined) {
			this.clearTimer(entry.restartTimer);
			entry.restartTimer = undefined;
		}
		entry.nextRestartAt = undefined;
	}

	private async runCleanup(entry: SupervisedEntry): Promise<void> {
		if (!this.cleanupInstance) {
			return;
		}
		try {
			await this.cleanupInstance(entry.channel, entry.instanceId);
		} catch (error) {
			this.log(
				`[connect] cleanup failed for ${entry.channel} connector ${entry.instanceId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	private isEntryAlive(entry: SupervisedEntry): boolean {
		if (entry.state === "backoff" || entry.state === "failed") {
			return false;
		}
		const pid = entry.child?.pid ?? entry.pid;
		return pid !== undefined && this.isProcessRunning(pid);
	}

	/**
	 * Adopted connectors have no child handle, so their death is only visible by
	 * polling. Processes this hub spawned report their own exit and are skipped.
	 */
	private ensurePolling(): void {
		if (this.pollTimer !== undefined || this.disposed) {
			return;
		}
		const tick = () => {
			this.pollTimer = undefined;
			if (this.disposed) {
				return;
			}
			for (const entry of [...this.entries.values()]) {
				if (
					entry.origin !== "adopted" ||
					entry.state !== "running" ||
					entry.child
				) {
					continue;
				}
				if (entry.pid === undefined || !this.isProcessRunning(entry.pid)) {
					this.handleExit(entry, undefined, undefined);
				}
			}
			if (this.hasAdoptedRunning()) {
				this.pollTimer = this.setTimer(tick, ADOPTED_POLL_INTERVAL_MS);
			}
		};
		this.pollTimer = this.setTimer(tick, ADOPTED_POLL_INTERVAL_MS);
	}

	private hasAdoptedRunning(): boolean {
		for (const entry of this.entries.values()) {
			if (entry.origin === "adopted" && entry.state === "running") {
				return true;
			}
		}
		return false;
	}

	private toRecord(entry: SupervisedEntry): SupervisedConnectorRecord {
		return {
			channel: entry.channel,
			instanceId: entry.instanceId,
			state: entry.state,
			origin: entry.origin,
			restarts: entry.restarts,
			...(entry.pid === undefined ? {} : { pid: entry.pid }),
			...(entry.startedAt === undefined
				? {}
				: { startedAt: toIsoString(entry.startedAt) }),
			...(entry.nextRestartAt === undefined
				? {}
				: { nextRestartAt: toIsoString(entry.nextRestartAt) }),
			...(entry.lastExitCode === undefined
				? {}
				: { lastExitCode: entry.lastExitCode }),
			...(entry.lastExitSignal === undefined
				? {}
				: { lastExitSignal: entry.lastExitSignal }),
			...(entry.lastError === undefined ? {} : { lastError: entry.lastError }),
		};
	}
}

let activeSupervisor: ConnectorSupervisor | undefined;

/**
 * The hub daemon's supervisor. Hub command handlers reach it through here
 * because they are invoked per-request and have no other shared state.
 */
export function setActiveConnectorSupervisor(
	supervisor: ConnectorSupervisor | undefined,
): void {
	activeSupervisor = supervisor;
}

export function getActiveConnectorSupervisor():
	| ConnectorSupervisor
	| undefined {
	return activeSupervisor;
}
