import { type ChildProcess, spawn } from "node:child_process";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	augmentNodeCommandForDebug,
	withResolvedClineBuildEnv,
} from "@cline/shared";
import {
	MAX_NODE_TIMER_DELAY_MS,
	normalizeIdleTimeoutMs,
} from "./subprocess-sandbox-lifecycle";

interface SandboxCallMessage {
	type: "call";
	id: string;
	method: string;
	args: unknown;
}

interface SandboxResponseMessage {
	type: "response";
	id: string;
	ok: boolean;
	result?: unknown;
	error?: { message: string; stack?: string };
}

interface SandboxEventMessage {
	type: "event";
	name: string;
	payload?: unknown;
}

export interface SubprocessSandboxOptions {
	/** Inline script to execute via `node -e`. Mutually exclusive with {@link bootstrapFile}. */
	bootstrapScript?: string;
	/** Path to a JavaScript file to execute via `node <file>`. Mutually exclusive with {@link bootstrapScript}. */
	bootstrapFile?: string;
	/** Runtime executable for internal JavaScript helpers. Defaults to node/bun instead of packaged CLI binaries. */
	runtimeExecutable?: string;
	/**
	 * Shut down the child after this many milliseconds with no calls in flight.
	 * The next call starts a fresh child transparently. Disabled when omitted.
	 */
	idleTimeoutMs?: number;
	name?: string;
	onEvent?: (event: { name: string; payload?: unknown }) => void;
}

export interface SandboxCallOptions {
	timeoutMs?: number;
}

type PendingRequest = {
	child: ChildProcess;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout?: NodeJS.Timeout;
};

const SANDBOX_SHUTDOWN_GRACE_MS = 300;

function asError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}
	return new Error(String(value));
}

function isChildRunning(child: ChildProcess): boolean {
	return child.exitCode === null && child.signalCode === null;
}

function isChildAvailable(child: ChildProcess): boolean {
	return isChildRunning(child) && child.connected;
}

export const CLINE_JS_RUNTIME_PATH_ENV = "CLINE_JS_RUNTIME_PATH";

/**
 * Marker a self-hosting compiled binary is launched with as the sandbox
 * runtime: `<binary> --cline-sandbox <bootstrapFile>`. A `bun build --compile`
 * binary always boots its embedded entrypoint, so the host checks for this
 * marker there and runs the bootstrap instead of starting normally, the same
 * trick the Hub daemon uses with `--cline-hub-daemon`.
 */
export const COMPILED_BUN_SANDBOX_ARG = "--cline-sandbox";

export interface CompiledSandboxHostOptions {
	/**
	 * Directory holding an on-disk `node_modules` tree with `@cline/core` (whose
	 * dist ships the plugin sandbox bootstrap), `jiti`, and the SDK packages
	 * plugins import at runtime. Plays the role the npm install plays for the
	 * CLI, where `CLINE_WRAPPER_PATH` locates the same layout.
	 */
	pluginHostDir?: string;
}

let compiledSandboxHost: CompiledSandboxHostOptions | undefined;

/**
 * Declare that this compiled Bun binary is the runtime for its own sandboxes.
 *
 * A compiled binary is not recognized as a JavaScript runtime by name, so
 * without this the sandbox falls back to whatever `node` is on PATH and hands
 * it a bootstrap path inside the binary's virtual filesystem. A host that
 * calls this re-executes itself with {@link COMPILED_BUN_SANDBOX_ARG} and must
 * route that marker to {@link runCompiledSandboxEntry} from its entrypoint.
 */
export function hostSandboxesInCompiledBinary(
	options: CompiledSandboxHostOptions = {},
): void {
	compiledSandboxHost = options;
}

export function getCompiledSandboxHost():
	| CompiledSandboxHostOptions
	| undefined {
	return compiledSandboxHost;
}

/**
 * Run the sandbox bootstrap when this process was launched with
 * {@link COMPILED_BUN_SANDBOX_ARG}. Returns whether it did, so an entrypoint
 * can return early instead of starting its normal personality.
 */
export async function runCompiledSandboxEntry(
	argv: string[] = process.argv,
): Promise<boolean> {
	const index = argv.indexOf(COMPILED_BUN_SANDBOX_ARG);
	if (index === -1) {
		return false;
	}
	const bootstrapFile = argv[index + 1];
	if (!bootstrapFile || bootstrapFile.startsWith("-")) {
		throw new Error(
			`${COMPILED_BUN_SANDBOX_ARG} requires an on-disk bootstrap file; a compiled host cannot run an inline sandbox script`,
		);
	}
	await import(pathToFileURL(resolve(bootstrapFile)).href);
	return true;
}

function isRuntimeExecutable(value: string | undefined): boolean {
	const trimmed = value?.trim();
	if (!trimmed) {
		return false;
	}
	const name = basename(trimmed).toLowerCase();
	return (
		name === "node" ||
		name === "node.exe" ||
		name === "bun" ||
		name === "bun.exe"
	);
}

export function resolveSubprocessRuntimeExecutable(
	options: {
		env?: NodeJS.ProcessEnv;
		execPath?: string;
		runtimeExecutable?: string;
		/** Defaults to whether {@link hostSandboxesInCompiledBinary} was called. */
		selfHosted?: boolean;
	} = {},
): string {
	const env = options.env ?? process.env;
	const explicit =
		options.runtimeExecutable?.trim() || env[CLINE_JS_RUNTIME_PATH_ENV]?.trim();
	if (explicit) {
		return explicit;
	}

	const execPath = options.execPath?.trim() || process.execPath;
	const selfHosted = options.selfHosted ?? compiledSandboxHost !== undefined;
	if (selfHosted || isRuntimeExecutable(execPath)) {
		return execPath;
	}

	for (const candidate of [
		env.BUN_EXEC_PATH,
		env.npm_node_execpath,
		env.NODE,
	]) {
		const trimmed = candidate?.trim();
		if (trimmed && isRuntimeExecutable(trimmed)) {
			return trimmed;
		}
	}

	return "node";
}

export function buildSubprocessSandboxCommand(
	args: string[],
	options: {
		env?: NodeJS.ProcessEnv;
		execArgv?: string[];
		name?: string;
		execPath?: string;
		runtimeExecutable?: string;
		selfHosted?: boolean;
	} = {},
): string[] {
	const runtimeExecutable = resolveSubprocessRuntimeExecutable(options);
	// Re-executing a compiled host binary only works when it can tell it is
	// meant to be the sandbox, so mark the launch. Any other runtime (node,
	// bun, an explicit override) runs the bootstrap directly.
	const execPath = options.execPath?.trim() || process.execPath;
	const selfHosted = options.selfHosted ?? compiledSandboxHost !== undefined;
	const marker =
		selfHosted &&
		runtimeExecutable === execPath &&
		!isRuntimeExecutable(execPath)
			? [COMPILED_BUN_SANDBOX_ARG]
			: [];
	return augmentNodeCommandForDebug([runtimeExecutable, ...marker, ...args], {
		env: options.env,
		execArgv: options.execArgv,
		debugRole: options.name === "plugin-sandbox" ? "plugin-sandbox" : "sandbox",
	});
}

export class SubprocessSandbox {
	private readonly options: SubprocessSandboxOptions;
	private readonly idleTimeoutMs: number | undefined;
	private process: ChildProcess | null = null;
	private requestCounter = 0;
	private readonly pending = new Map<string, PendingRequest>();
	private idleTimer: NodeJS.Timeout | undefined;
	private readonly shutdowns = new Map<ChildProcess, Promise<void>>();

	constructor(options: SubprocessSandboxOptions) {
		this.options = options;
		this.idleTimeoutMs = normalizeIdleTimeoutMs(options.idleTimeoutMs);
		if (
			options.idleTimeoutMs !== undefined &&
			this.idleTimeoutMs === undefined
		) {
			throw new RangeError(
				`idleTimeoutMs must be an integer between 1 and ${MAX_NODE_TIMER_DELAY_MS}`,
			);
		}
	}

	private get processLabel(): string {
		return this.options.name ?? "sandbox";
	}

	private clearPendingRequest(id: string): PendingRequest | undefined {
		const pending = this.pending.get(id);
		if (!pending) {
			return undefined;
		}
		this.pending.delete(id);
		if (pending.timeout) {
			clearTimeout(pending.timeout);
		}
		this.armIdleTimer(pending.child);
		return pending;
	}

	private clearIdleTimer(): void {
		if (!this.idleTimer) {
			return;
		}
		clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
	}

	private hasPendingRequests(child: ChildProcess): boolean {
		for (const pending of this.pending.values()) {
			if (pending.child === child) {
				return true;
			}
		}
		return false;
	}

	/**
	 * The parent is the sole idle-lifecycle authority. A matching child-side
	 * deadline can fire just before this timer and drop a newly dispatched RPC.
	 * Children should independently handle only parent IPC disconnection.
	 */
	private armIdleTimer(child: ChildProcess): void {
		if (this.process !== child) {
			return;
		}
		this.clearIdleTimer();
		if (
			this.idleTimeoutMs === undefined ||
			!isChildAvailable(child) ||
			this.hasPendingRequests(child)
		) {
			return;
		}

		const timer = setTimeout(() => {
			if (this.idleTimer === timer) {
				this.idleTimer = undefined;
			}
			if (
				this.process !== child ||
				!isChildAvailable(child) ||
				this.hasPendingRequests(child)
			) {
				return;
			}
			this.shutdownProcess(child).catch(() => {
				// Best-effort idle cleanup. Process exit still rejects any request
				// that raced with shutdown, though the pending guard above prevents
				// normal calls from being interrupted.
			});
		}, this.idleTimeoutMs);
		timer.unref();
		this.idleTimer = timer;
	}

	start(): void {
		if (this.process && isChildAvailable(this.process)) {
			return;
		}
		const unavailableChild = this.process;
		this.process = null;
		this.clearIdleTimer();
		if (unavailableChild && isChildRunning(unavailableChild)) {
			this.shutdownProcess(unavailableChild).catch(() => {
				// Best-effort cleanup of a child whose IPC channel closed before
				// its process-exit event reached the parent.
			});
		}

		const args = this.options.bootstrapFile
			? [this.options.bootstrapFile]
			: ["-e", this.options.bootstrapScript ?? ""];

		const command = buildSubprocessSandboxCommand(args, {
			name: this.options.name,
			runtimeExecutable: this.options.runtimeExecutable,
		});
		const child = spawn(
			command[0] ?? resolveSubprocessRuntimeExecutable(this.options),
			command.slice(1),
			{
				stdio: ["ignore", "ignore", "pipe", "ipc"],
				env: withResolvedClineBuildEnv(process.env),
				// Prevent a console window from flashing on Windows.
				windowsHide: true,
			},
		);
		this.process = child;
		let stderrBuffer = "";
		const appendStderr = (chunk: string) => {
			const next = stderrBuffer + chunk;
			// Keep only a small tail so errors include useful context
			// without unbounded memory growth.
			stderrBuffer = next.length > 4000 ? next.slice(-4000) : next;
		};
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			appendStderr(chunk);
		});
		child.on("message", (message) => {
			this.onMessage(
				child,
				message as SandboxResponseMessage | SandboxEventMessage,
			);
		});
		child.on("error", (error) => {
			this.failPendingForProcess(
				child,
				new Error(
					`${this.processLabel} process error: ${asError(error).message}`,
				),
			);
		});
		child.on("exit", (code, signal) => {
			if (this.process === child) {
				this.process = null;
				this.clearIdleTimer();
			}
			const stderrDetail = stderrBuffer.trim();
			this.failPendingForProcess(
				child,
				new Error(
					`${this.options.name ?? "sandbox"} process exited (code=${String(code)}, signal=${String(signal)})${stderrDetail ? `: ${stderrDetail}` : ""}`,
				),
			);
		});
		this.armIdleTimer(child);
	}

	async call<TResult = unknown>(
		method: string,
		args: unknown,
		options: SandboxCallOptions = {},
	): Promise<TResult> {
		this.start();
		const child = this.process;
		if (!child || !isChildAvailable(child)) {
			throw new Error(`${this.processLabel} process is not available`);
		}
		this.clearIdleTimer();

		const id = `req_${++this.requestCounter}`;
		const message: SandboxCallMessage = {
			type: "call",
			id,
			method,
			args,
		};

		return await new Promise<TResult>((resolve, reject) => {
			const pending: PendingRequest = {
				child,
				resolve: (value) => resolve(value as TResult),
				reject,
			};
			if ((options.timeoutMs ?? 0) > 0) {
				pending.timeout = setTimeout(() => {
					const entry = this.clearPendingRequest(id);
					if (!entry) {
						return;
					}
					this.shutdownProcess(entry.child).catch(() => {
						// Best-effort process shutdown after timeout.
					});
					entry.reject(
						new Error(
							`${this.processLabel} call timed out after ${options.timeoutMs}ms: ${method}`,
						),
					);
				}, options.timeoutMs);
			}
			this.pending.set(id, pending);
			try {
				child.send(message, (error) => {
					if (!error) {
						return;
					}
					const entry = this.clearPendingRequest(id);
					if (!entry) {
						return;
					}
					entry.reject(
						new Error(
							`${this.processLabel} failed to send call "${method}": ${asError(error).message}`,
						),
					);
				});
			} catch (error) {
				// send() throws synchronously when the message is not
				// serializable (e.g. cyclic structures). Cancel the pending
				// entry so the timeout timer above never fires — otherwise it
				// would shut down the sandbox process out from under unrelated
				// in-flight calls. Reject with the original error so callers
				// can classify it (see isSerializationError in plugin-sandbox).
				this.clearPendingRequest(id);
				reject(asError(error));
			}
		});
	}

	async shutdown(): Promise<void> {
		this.clearIdleTimer();
		const child = this.process;
		const inFlightShutdowns = [...this.shutdowns.values()];
		if (child) {
			inFlightShutdowns.push(this.shutdownProcess(child));
		}
		if (inFlightShutdowns.length === 0) {
			this.failPending(new Error(`${this.processLabel} shutdown`));
			return;
		}
		await Promise.all(inFlightShutdowns);
	}

	private shutdownProcess(child: ChildProcess): Promise<void> {
		const existing = this.shutdowns.get(child);
		if (existing) {
			return existing;
		}
		if (this.process === child) {
			this.process = null;
			this.clearIdleTimer();
		}

		const shutdown = this.terminateProcess(child).finally(() => {
			if (this.shutdowns.get(child) === shutdown) {
				this.shutdowns.delete(child);
			}
		});
		this.shutdowns.set(child, shutdown);
		return shutdown;
	}

	private async terminateProcess(child: ChildProcess): Promise<void> {
		if (!isChildRunning(child)) {
			this.failPendingForProcess(
				child,
				new Error(`${this.processLabel} shutdown`),
			);
			return;
		}
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					// Ignore kill failures.
				}
				resolve();
			}, SANDBOX_SHUTDOWN_GRACE_MS);
			child.once("exit", () => {
				clearTimeout(timeout);
				resolve();
			});
			try {
				child.kill("SIGTERM");
			} catch {
				clearTimeout(timeout);
				resolve();
			}
		});
		this.failPendingForProcess(
			child,
			new Error(`${this.processLabel} shutdown`),
		);
	}

	private onMessage(
		child: ChildProcess,
		message: SandboxResponseMessage | SandboxEventMessage,
	): void {
		if (!message) {
			return;
		}
		if (message.type === "event") {
			if (
				this.process === child &&
				typeof message.name === "string" &&
				message.name.length > 0
			) {
				this.options.onEvent?.({
					name: message.name,
					payload: message.payload,
				});
			}
			return;
		}
		if (message.type !== "response" || !message.id) {
			return;
		}
		const matchingPending = this.pending.get(message.id);
		if (!matchingPending || matchingPending.child !== child) {
			return;
		}
		const pending = this.clearPendingRequest(message.id);
		if (!pending) {
			return;
		}
		if (message.ok) {
			pending.resolve(message.result);
			return;
		}
		pending.reject(
			new Error(message.error?.message || `${this.processLabel} call failed`),
		);
	}

	private failPendingForProcess(child: ChildProcess, error: Error): void {
		for (const [id, pending] of this.pending.entries()) {
			if (pending.child !== child) {
				continue;
			}
			this.pending.delete(id);
			if (pending.timeout) {
				clearTimeout(pending.timeout);
			}
			pending.reject(error);
		}
	}

	private failPending(error: Error): void {
		for (const [id, pending] of this.pending.entries()) {
			this.pending.delete(id);
			if (pending.timeout) {
				clearTimeout(pending.timeout);
			}
			pending.reject(error);
		}
	}
}
