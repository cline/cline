import { type ChildProcess, spawn } from "node:child_process";
import { basename } from "node:path";
import {
	augmentNodeCommandForDebug,
	withResolvedClineBuildEnv,
} from "@clinebot/shared";

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
	name?: string;
	onEvent?: (event: { name: string; payload?: unknown }) => void;
}

export interface SandboxCallOptions {
	timeoutMs?: number;
}

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout?: NodeJS.Timeout;
};

function asError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}
	return new Error(String(value));
}

export const CLINE_JS_RUNTIME_PATH_ENV = "CLINE_JS_RUNTIME_PATH";

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
	} = {},
): string {
	const env = options.env ?? process.env;
	const explicit =
		options.runtimeExecutable?.trim() || env[CLINE_JS_RUNTIME_PATH_ENV]?.trim();
	if (explicit) {
		return explicit;
	}

	const execPath = options.execPath?.trim() || process.execPath;
	if (isRuntimeExecutable(execPath)) {
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
	} = {},
): string[] {
	const runtimeExecutable = resolveSubprocessRuntimeExecutable({
		env: options.env,
		execPath: options.execPath,
		runtimeExecutable: options.runtimeExecutable,
	});
	return augmentNodeCommandForDebug([runtimeExecutable, ...args], {
		env: options.env,
		execArgv: options.execArgv,
		debugRole: options.name === "plugin-sandbox" ? "plugin-sandbox" : "sandbox",
	});
}

export class SubprocessSandbox {
	private readonly options: SubprocessSandboxOptions;
	private process: ChildProcess | null = null;
	private requestCounter = 0;
	private readonly pending = new Map<string, PendingRequest>();

	constructor(options: SubprocessSandboxOptions) {
		this.options = options;
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
		return pending;
	}

	start(): void {
		if (this.process && this.process.exitCode === null) {
			return;
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
			this.onMessage(message as SandboxResponseMessage | SandboxEventMessage);
		});
		child.on("error", (error) => {
			this.failPending(
				new Error(
					`${this.processLabel} process error: ${asError(error).message}`,
				),
			);
		});
		child.on("exit", (code, signal) => {
			this.process = null;
			const stderrDetail = stderrBuffer.trim();
			this.failPending(
				new Error(
					`${this.options.name ?? "sandbox"} process exited (code=${String(code)}, signal=${String(signal)})${stderrDetail ? `: ${stderrDetail}` : ""}`,
				),
			);
		});
	}

	async call<TResult = unknown>(
		method: string,
		args: unknown,
		options: SandboxCallOptions = {},
	): Promise<TResult> {
		this.start();
		const child = this.process;
		if (!child || child.exitCode !== null) {
			throw new Error(`${this.processLabel} process is not available`);
		}

		const id = `req_${++this.requestCounter}`;
		const message: SandboxCallMessage = {
			type: "call",
			id,
			method,
			args,
		};

		return await new Promise<TResult>((resolve, reject) => {
			const pending: PendingRequest = {
				resolve: (value) => resolve(value as TResult),
				reject,
			};
			if ((options.timeoutMs ?? 0) > 0) {
				pending.timeout = setTimeout(() => {
					this.clearPendingRequest(id);
					this.shutdown().catch(() => {
						// Best-effort process shutdown after timeout.
					});
					reject(
						new Error(
							`${this.processLabel} call timed out after ${options.timeoutMs}ms: ${method}`,
						),
					);
				}, options.timeoutMs);
			}
			this.pending.set(id, pending);
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
		});
	}

	async shutdown(): Promise<void> {
		const child = this.process;
		this.process = null;
		if (!child || child.exitCode !== null) {
			this.failPending(new Error(`${this.processLabel} shutdown`));
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
			}, 300);
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
		this.failPending(new Error(`${this.processLabel} shutdown`));
	}

	private onMessage(
		message: SandboxResponseMessage | SandboxEventMessage,
	): void {
		if (!message) {
			return;
		}
		if (message.type === "event") {
			if (typeof message.name === "string" && message.name.length > 0) {
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
