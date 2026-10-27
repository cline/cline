/**
 * Runs the desktop app's backend (`apps/examples/desktop-app/sidecar`) as a
 * child process and tracks its WebSocket endpoint.
 *
 * This mirrors what the Tauri shell does in `src-tauri/src/main.rs`
 * (`spawn_desktop_backend_process`): the backend is the same code, it just
 * has a different parent. When the backend moves into the CLI (`cline`
 * hosting the Hub directly) this file becomes "run `cline` and read its
 * endpoint" — the webview side does not change.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { parseBackendReadyLine } from "./webview-html";

export type BackendEndpoint = {
	endpoint: string;
	wsEndpoint: string;
	pid: number;
};

export type BackendLogger = {
	log(message: string): void;
	error(message: string): void;
};

export type BackendOptions = {
	/** Executable that can run TypeScript: `bun`, or a compiled `cline` CLI with BUN_BE_BUN=1. */
	runtimePath: string;
	/** `sidecar/index.ts` (or a bundle of it). */
	entryPath: string;
	/** Workspace folder the backend treats as its project root. */
	workspaceRoot: string;
	logger: BackendLogger;
	/** Extra origins the backend should accept WebSocket upgrades from. */
	trustedOrigins?: string[];
	/** Called when the process exits (crash or shutdown). */
	onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
};

const READY_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 5_000;

export async function reserveLoopbackPort(): Promise<number> {
	return await new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("failed to reserve a backend port"));
				return;
			}
			const { port } = address;
			server.close((error) => (error ? reject(error) : resolvePort(port)));
		});
	});
}

/**
 * Locate `sidecar/index.ts` relative to this extension. In a repo checkout
 * the desktop app is a sibling directory; a packaged build would bundle it
 * under `dist/backend`.
 */
export function resolveDefaultBackendEntry(extensionRoot: string): string {
	const candidates = [
		join(extensionRoot, "dist", "backend", "index.js"),
		resolve(extensionRoot, "..", "desktop-app", "sidecar", "index.ts"),
	];
	return candidates.find((path) => existsSync(path)) ?? candidates[1];
}

export function isCompiledCli(runtimePath: string): boolean {
	return !/(^|[\\/])bun(\.exe)?$/i.test(runtimePath);
}

export function buildBackendLaunch(options: {
	runtimePath: string;
	entryPath: string;
	workspaceRoot: string;
	port: number;
	approvalToken: string;
	trustedOrigins?: string[];
	baseEnv?: NodeJS.ProcessEnv;
}): { args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
	const compiled = isCompiledCli(options.runtimePath);
	const env: NodeJS.ProcessEnv = {
		...(options.baseEnv ?? process.env),
		CLINE_SIDECAR_PORT: String(options.port),
		CLINE_SIDECAR_APPROVAL_TOKEN: options.approvalToken,
		CLINE_SIDECAR_TRUSTED_ORIGINS: [
			"vscode-webview://*",
			...(options.trustedOrigins ?? []),
		].join(","),
		// Match the Tauri shell: the backend chdirs to the workspace itself.
		CLINE_DESKTOP_WORKSPACE_ROOT: options.workspaceRoot,
	};
	// Electron's extension host sets this; a spawned bun/cline must not inherit it.
	delete env.ELECTRON_RUN_AS_NODE;
	if (compiled) {
		env.BUN_BE_BUN = "1";
		env.CLINE_DESKTOP_CLI_PATH = options.runtimePath;
		// The bundled backend ships the SDK plugin runtime beside it.
		const pluginRuntime = join(dirname(options.entryPath), "plugin-runtime");
		if (existsSync(pluginRuntime)) env.CLINE_PLUGIN_RUNTIME_DIR = pluginRuntime;
	}
	return {
		args: compiled
			? ["run", "--use-system-ca", "--no-env-file", options.entryPath]
			: ["run", options.entryPath],
		cwd: compiled ? dirname(options.entryPath) : options.workspaceRoot,
		env,
	};
}


export class DesktopBackend {
	private child: ChildProcess | undefined;
	private endpoint: BackendEndpoint | undefined;
	private readyPromise: Promise<BackendEndpoint> | undefined;
	private stopping = false;

	constructor(private readonly options: BackendOptions) {}

	get current(): BackendEndpoint | undefined {
		return this.endpoint;
	}

	get isRunning(): boolean {
		return Boolean(
			this.child && this.child.exitCode === null && !this.stopping,
		);
	}

	/** Start (or return the in-flight start of) the backend and resolve its endpoint. */
	ready(): Promise<BackendEndpoint> {
		if (this.endpoint && this.isRunning) {
			return Promise.resolve(this.endpoint);
		}
		if (!this.readyPromise) {
			this.readyPromise = this.start().catch((error) => {
				this.readyPromise = undefined;
				throw error;
			});
		}
		return this.readyPromise;
	}

	private async start(): Promise<BackendEndpoint> {
		const { runtimePath, entryPath, workspaceRoot, logger } = this.options;
		if (!existsSync(entryPath)) {
			throw new Error(`desktop backend entry not found: ${entryPath}`);
		}
		const port = await reserveLoopbackPort();
		const launch = buildBackendLaunch({
			runtimePath,
			entryPath,
			workspaceRoot,
			port,
			approvalToken: randomUUID(),
			trustedOrigins: this.options.trustedOrigins,
		});
		this.stopping = false;
		logger.log(
			`starting desktop backend: ${runtimePath} ${launch.args.join(" ")} (cwd=${launch.cwd}, port=${port})`,
		);
		const child = spawn(runtimePath, launch.args, {
			cwd: launch.cwd,
			env: launch.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		this.child = child;
		return await this.awaitReady(child);
	}

	private awaitReady(child: ChildProcess): Promise<BackendEndpoint> {
		const { logger } = this.options;
		return new Promise<BackendEndpoint>((resolveReady, reject) => {
			let settled = false;
			let stdoutBuffer = "";
			const timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				reject(new Error("desktop backend did not report ready in time"));
				void this.stop();
			}, READY_TIMEOUT_MS);

			child.stdout?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string) => {
				stdoutBuffer += chunk;
				let newline = stdoutBuffer.indexOf("\n");
				while (newline >= 0) {
					const line = stdoutBuffer.slice(0, newline);
					stdoutBuffer = stdoutBuffer.slice(newline + 1);
					newline = stdoutBuffer.indexOf("\n");
					const ready = parseBackendReadyLine(line);
					if (ready && !settled) {
						settled = true;
						clearTimeout(timeout);
						this.endpoint = ready;
						logger.log(
							`desktop backend ready: ${ready.endpoint} (pid ${ready.pid})`,
						);
						resolveReady(ready);
					} else if (line.trim()) {
						logger.log(`[backend] ${line}`);
					}
				}
			});
			child.stderr?.setEncoding("utf8");
			child.stderr?.on("data", (chunk: string) => {
				for (const line of chunk.split("\n")) {
					if (line.trim()) logger.error(`[backend] ${line}`);
				}
			});
			child.once("error", (error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				reject(
					new Error(`failed to start desktop backend: ${error.message}`),
				);
			});
			child.once("exit", (code, signal) => {
				logger.log(`desktop backend exited (code=${code}, signal=${signal})`);
				if (this.child === child) {
					this.child = undefined;
					this.endpoint = undefined;
					this.readyPromise = undefined;
				}
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					reject(
						new Error(
							`desktop backend exited before it was ready (code=${code}, signal=${signal})`,
						),
					);
				}
				this.options.onExit?.(code, signal);
			});
		});
	}

	async stop(): Promise<void> {
		const child = this.child;
		if (!child) return;
		this.stopping = true;
		this.child = undefined;
		this.endpoint = undefined;
		this.readyPromise = undefined;
		if (child.exitCode !== null) return;
		await new Promise<void>((resolveStopped) => {
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				resolveStopped();
			}, STOP_TIMEOUT_MS);
			child.once("exit", () => {
				clearTimeout(timer);
				resolveStopped();
			});
			child.kill("SIGTERM");
		});
	}

	async restart(): Promise<BackendEndpoint> {
		await this.stop();
		return await this.ready();
	}
}
