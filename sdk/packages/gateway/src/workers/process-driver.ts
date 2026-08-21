/**
 * Sandboxed child-process worker driver (Gateway RFC, Phase 4).
 *
 * V0 production isolation: a macOS Seatbelt-sandboxed child process,
 * wrapped through `@anthropic-ai/sandbox-runtime` (SRT). The wrapped
 * child gets:
 *
 * - filesystem writes confined to the bot's fixed workspaces root (the
 *   mount policy never names individual child workspaces);
 * - a scoped network capability (allowed domains only);
 * - masked credential env vars: the child sees per-session sentinels and
 *   the SRT host proxy substitutes real values on egress to the
 *   configured inject hosts — the worker uses credentials it never holds;
 * - no secret files mounted, ever.
 *
 * Required isolation fails closed: on a platform without Seatbelt the
 * driver refuses to spawn instead of degrading. The explicit
 * development-only unsandboxed mode is a separate, deliberate
 * constructor flag and is reported through `isolation` so it is always
 * visible in health/telemetry.
 *
 * Transport: newline-delimited JSON over the child's stdin/stdout (the
 * worker entry never writes anything else to stdout; logs go to stderr).
 */

import { type ChildProcess, spawn } from "node:child_process";
import type {
	WorkerConnection,
	WorkerDriver,
	WorkerDriverAvailability,
	WorkerExitInfo,
	WorkerSpawnSpec,
} from "./driver";
import { WorkerIsolationUnavailableError } from "./driver";
import type {
	SupervisorToWorkerMessage,
	WorkerToSupervisorMessage,
} from "./protocol";
import { WorkerToSupervisorMessageSchema } from "./protocol";

/** Environment variables safe to pass through to a worker by default. */
const DEFAULT_ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"TMPDIR",
	"LANG",
	"LC_ALL",
	"TERM",
	"NODE_OPTIONS",
] as const;

export interface WorkerEntrySpec {
	readonly command: string;
	readonly args: readonly string[];
}

export interface SandboxProcessDriverOptions {
	/** The worker entry executable (e.g. `node bin/clinegate-worker.mjs`). */
	entry: WorkerEntrySpec;
	/**
	 * EXPLICIT development-only escape hatch: spawn the worker without a
	 * sandbox. Never inferred; always reported via `isolation`.
	 */
	unsandboxedDevelopmentMode?: boolean;
	envAllowlist?: readonly string[];
	/** Injected for tests; defaults to `process.platform`. */
	platform?: NodeJS.Platform;
	env?: Record<string, string | undefined>;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

class ProcessWorkerConnection implements WorkerConnection {
	readonly pid?: number;
	private readonly child: ChildProcess;
	private readonly listeners = new Set<
		(message: WorkerToSupervisorMessage) => void
	>();
	private readonly exitListeners = new Set<(info: WorkerExitInfo) => void>();
	private buffer = "";
	private killed = false;

	constructor(child: ChildProcess) {
		this.child = child;
		this.pid = child.pid;
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			this.buffer += chunk;
			for (;;) {
				const newline = this.buffer.indexOf("\n");
				if (newline === -1) {
					return;
				}
				const line = this.buffer.slice(0, newline).trim();
				this.buffer = this.buffer.slice(newline + 1);
				if (!line) {
					continue;
				}
				let value: unknown;
				try {
					value = JSON.parse(line);
				} catch {
					continue;
				}
				const parsed = WorkerToSupervisorMessageSchema.safeParse(value);
				if (!parsed.success) {
					continue;
				}
				for (const listener of this.listeners) {
					listener(parsed.data);
				}
			}
		});
		child.on("exit", (code, signal) => {
			const info: WorkerExitInfo = {
				code,
				signal,
				crashed: !this.killed && (code !== 0 || signal !== null),
			};
			for (const listener of this.exitListeners) {
				listener(info);
			}
		});
	}

	send(message: SupervisorToWorkerMessage): void {
		this.child.stdin?.write(`${JSON.stringify(message)}\n`);
	}

	onMessage(
		listener: (message: WorkerToSupervisorMessage) => void,
	): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	onExit(listener: (info: WorkerExitInfo) => void): () => void {
		this.exitListeners.add(listener);
		return () => {
			this.exitListeners.delete(listener);
		};
	}

	kill(): void {
		this.killed = true;
		this.child.kill("SIGKILL");
	}
}

export class SandboxProcessWorkerDriver implements WorkerDriver {
	readonly id: string;
	readonly isolation: "sandbox-seatbelt" | "unsandboxed-development";
	private readonly options: SandboxProcessDriverOptions;
	private readonly platform: NodeJS.Platform;
	private readonly hostEnv: Record<string, string | undefined>;
	private sandboxInitialized = false;

	constructor(options: SandboxProcessDriverOptions) {
		this.options = options;
		this.platform = options.platform ?? process.platform;
		this.hostEnv = options.env ?? process.env;
		if (options.unsandboxedDevelopmentMode) {
			this.id = "process-unsandboxed-development";
			this.isolation = "unsandboxed-development";
		} else {
			this.id = "sandbox-process";
			this.isolation = "sandbox-seatbelt";
		}
	}

	availability(): WorkerDriverAvailability {
		if (this.options.unsandboxedDevelopmentMode) {
			return { available: true };
		}
		if (this.platform !== "darwin") {
			return {
				available: false,
				reason: `Seatbelt sandboxing requires macOS; platform is "${this.platform}". Required isolation fails closed.`,
			};
		}
		return { available: true };
	}

	async spawn(spec: WorkerSpawnSpec): Promise<WorkerConnection> {
		const availability = this.availability();
		if (!availability.available) {
			throw new WorkerIsolationUnavailableError(
				this.id,
				availability.reason ?? "unavailable",
			);
		}
		const baseEnv = this.buildEnv(spec);
		if (this.options.unsandboxedDevelopmentMode) {
			const child = spawn(
				this.options.entry.command,
				[...this.options.entry.args],
				{ stdio: ["pipe", "pipe", "inherit"], env: baseEnv },
			);
			return new ProcessWorkerConnection(child);
		}
		return this.spawnSeatbelt(spec, baseEnv);
	}

	private buildEnv(spec: WorkerSpawnSpec): Record<string, string> {
		const allowlist = this.options.envAllowlist ?? DEFAULT_ENV_ALLOWLIST;
		const env: Record<string, string> = {};
		for (const name of allowlist) {
			const value = this.hostEnv[name];
			if (value !== undefined) {
				env[name] = value;
			}
		}
		// The credential env vars are handled exclusively through SRT
		// masking; a spec.env entry with the same name would smuggle a raw
		// secret into the worker, so it is rejected loudly.
		const credentialVars = new Set(
			(spec.credentials ?? []).map((capability) => capability.envVar),
		);
		for (const [name, value] of Object.entries(spec.env ?? {})) {
			if (credentialVars.has(name)) {
				throw new Error(
					`Worker env must not carry credential variable "${name}" directly; ` +
						"credentials are injected as masked capabilities only",
				);
			}
			env[name] = value;
		}
		return env;
	}

	private async spawnSeatbelt(
		spec: WorkerSpawnSpec,
		baseEnv: Record<string, string>,
	): Promise<WorkerConnection> {
		let srt: typeof import("@anthropic-ai/sandbox-runtime");
		try {
			srt = await import("@anthropic-ai/sandbox-runtime");
		} catch (error) {
			throw new WorkerIsolationUnavailableError(
				this.id,
				`@anthropic-ai/sandbox-runtime is not installed: ${String(error)}`,
			);
		}
		const { SandboxManager } = srt;
		if (!SandboxManager.isSupportedPlatform()) {
			throw new WorkerIsolationUnavailableError(
				this.id,
				"SandboxManager reports this platform unsupported",
			);
		}
		const customConfig = {
			network: {
				allowedDomains: [...spec.network.allowedDomains],
				deniedDomains: [],
			},
			filesystem: {
				denyRead: [],
				allowWrite: [...spec.mounts.writeRoots],
				denyWrite: [],
				...(spec.mounts.readRoots.length > 0
					? { allowRead: [...spec.mounts.readRoots] }
					: {}),
			},
			...(spec.credentials && spec.credentials.length > 0
				? {
						credentials: {
							envVars: spec.credentials.map((capability) => ({
								name: capability.envVar,
								mode: "mask" as const,
								injectHosts: [...capability.injectHosts],
							})),
						},
					}
				: {}),
		};
		try {
			if (!this.sandboxInitialized) {
				await SandboxManager.initialize(
					customConfig as Parameters<typeof SandboxManager.initialize>[0],
				);
				this.sandboxInitialized = true;
			}
			const commandLine = [
				this.options.entry.command,
				...this.options.entry.args,
			]
				.map(shellQuote)
				.join(" ");
			const { argv, env } = await SandboxManager.wrapWithSandboxArgv(
				commandLine,
				undefined,
				customConfig as Parameters<
					typeof SandboxManager.wrapWithSandboxArgv
				>[2],
				undefined,
				undefined,
				{ commandId: spec.workerId },
			);
			const child = spawn(argv[0], argv.slice(1), {
				stdio: ["pipe", "pipe", "inherit"],
				env: { ...baseEnv, ...env },
			});
			return new ProcessWorkerConnection(child);
		} catch (error) {
			if (error instanceof WorkerIsolationUnavailableError) {
				throw error;
			}
			// Fail closed: a sandbox setup failure never degrades to an
			// unsandboxed spawn.
			throw new WorkerIsolationUnavailableError(
				this.id,
				`Sandbox setup failed: ${String(error)}`,
			);
		}
	}
}
