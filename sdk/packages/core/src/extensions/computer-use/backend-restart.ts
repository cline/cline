import { type ChildProcess, spawn } from "node:child_process";
import { ComputerUseClient } from "./client";

/**
 * Brings the computer-use backend back when its process is gone.
 *
 * The backend (qwanban's qbt) is a separate process the agent host does not
 * own: it may be started by a human, a service, or this module. The single
 * rule that keeps ownership unambiguous: this module only ever terminates a
 * backend it spawned itself. `ensureRunning` therefore probes first and
 * returns `already_running` when the backend answers, spawns the configured
 * launch command only when it does not, and kills its own spawn if it never
 * becomes ready.
 *
 * Readiness is the same query tool construction uses (`get_display_info`):
 * the port accepting is not enough — the backend must actually answer.
 */

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const DEFAULT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export interface ComputerBackendRestartOptions {
	/** Backend host, defaults to loopback. */
	host?: string;
	/** Backend TCP port, the same target the tools dial. */
	port: number;
	/**
	 * Shell command that starts the backend, e.g.
	 * `cargo run -- serve 1234 5678`. Runs via the platform shell, so a cd
	 * prefix or env vars are allowed; the backend must end up answering on
	 * `host`:`port`.
	 */
	command: string;
	/** Per-probe budget. Default 3 s. */
	probeTimeoutMs?: number;
	/** Overall wait for the spawned backend to answer. Default 120 s. */
	readyTimeoutMs?: number;
	/** Delay between readiness probes while waiting. Default 1 s. */
	pollIntervalMs?: number;
}

export type ComputerBackendEnsureResult =
	| { status: "already_running" }
	| { status: "started" }
	| { status: "failed_to_start"; error: string };

export class ComputerBackendRestart {
	private readonly options: ComputerBackendRestartOptions;
	private readonly probeTimeoutMs: number;
	private readonly readyTimeoutMs: number;
	private readonly pollIntervalMs: number;
	private ensurePromise: Promise<ComputerBackendEnsureResult> | undefined;
	private child: ChildProcess | undefined;

	constructor(options: ComputerBackendRestartOptions) {
		this.options = options;
		this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
		this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
		this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	}

	/** Overall wait budget for a spawned backend to answer; hosts use it to size tool timeouts. */
	get budgetMs(): number {
		return this.readyTimeoutMs;
	}

	/**
	 * Probes the backend; spawns the launch command only when it is down.
	 * Concurrent calls share one run, so the backend is never spawned twice.
	 */
	async ensureRunning(): Promise<ComputerBackendEnsureResult> {
		this.ensurePromise ??= this.ensureRunningUncached().finally(() => {
			this.ensurePromise = undefined;
		});
		return this.ensurePromise;
	}

	/**
	 * Terminates a backend this module spawned. Never touches a backend it
	 * did not spawn: a human- or service-owned backend outlives this process.
	 */
	async dispose(): Promise<void> {
		this.killSpawned();
	}

	private async ensureRunningUncached(): Promise<ComputerBackendEnsureResult> {
		if (await this.probe()) {
			return { status: "already_running" };
		}
		const child = spawn(this.options.command, {
			shell: true,
			detached: true,
			stdio: "ignore",
		});
		child.unref();
		this.child = child;
		const deadline = Date.now() + this.readyTimeoutMs;
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
			// Probe before checking the launcher's exit: commands that
			// daemonize (spawn the backend and exit) must not be misreported
			// as failures while the backend they started is coming up.
			if (await this.probe()) {
				return { status: "started" };
			}
			if (child.exitCode !== null) {
				return {
					status: "failed_to_start",
					error: `launch command exited with code ${child.exitCode} before the backend answered`,
				};
			}
		}
		// We own the spawn and it never became ready; do not leave it behind.
		this.killSpawned();
		return {
			status: "failed_to_start",
			error: `backend did not answer within ${this.readyTimeoutMs}ms`,
		};
	}

	private async probe(): Promise<boolean> {
		const client = new ComputerUseClient({
			host: this.options.host,
			port: this.options.port,
			connectTimeoutMs: this.probeTimeoutMs,
			requestTimeoutMs: this.probeTimeoutMs,
		});
		try {
			await client.getDisplayInfo();
			return true;
		} catch {
			return false;
		} finally {
			client.close();
		}
	}

	private killSpawned(): void {
		const child = this.child;
		this.child = undefined;
		if (!child || child.exitCode !== null) {
			return;
		}
		if (process.platform === "win32" && child.pid) {
			// shell:true spawns cmd.exe wrapping the real backend: kill the
			// whole tree, not just the wrapper.
			spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
				stdio: "ignore",
			});
			return;
		}
		child.kill("SIGTERM");
	}
}
