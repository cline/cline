import { Daytona, type Sandbox } from "@daytona/sdk";
import { ApiError, sanitizeLogMessage } from "@/lib/api";
import { getServerEnv } from "@/lib/env";
import { assertSafeCommand, shellQuote } from "@/lib/sandbox/guard";
import { joinRemotePath, normalizeWorkspacePath, resolveWorkspacePath } from "@/lib/sandbox/path";
import { runtimeInstallCommand, runtimeSpec } from "@/lib/sandbox/runtime";
import { templateFiles } from "@/lib/sandbox/templates";
import {
	type ExecResult,
	type ProvisionedWorkspace,
	type ProvisionInput,
	type RuntimeStatus,
	SandboxError,
	type SandboxFile,
	SandboxNotConfiguredError,
	type SandboxProvider,
	type StreamingCommand,
	type StreamingSnapshot,
} from "@/lib/sandbox/types";

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_LIST_ENTRIES = 1500;

function baseLanguage(language: string): string {
	// Python and TypeScript snapshots are the two prebuilt toolchains Daytona
	// ships. Everything else starts from the Node image and is provisioned
	// explicitly at runtime instead of pretending the toolchain is present.
	return language === "python" ? "python" : "typescript";
}

function stateLabel(sandbox: Sandbox): string {
	return String(sandbox.state ?? "unknown");
}

function safeError(error: unknown): SandboxError {
	const message = error instanceof Error ? error.message : String(error);
	return new SandboxError(
		"Cloud sandbox request failed",
		sanitizeLogMessage(message).slice(0, 1200),
	);
}

export class DaytonaSandboxProvider implements SandboxProvider {
	readonly name = "daytona";
	private readonly daytona: Daytona;
	private readonly cache = new Map<string, Sandbox>();

	constructor() {
		const env = getServerEnv();
		if (!env.DAYTONA_API_KEY) {
			throw new Error("DAYTONA_API_KEY is not configured");
		}
		this.daytona = new Daytona({
			apiKey: env.DAYTONA_API_KEY,
			apiUrl: env.DAYTONA_API_URL,
			...(env.DAYTONA_TARGET ? { target: env.DAYTONA_TARGET } : {}),
		});
	}

	private async sandbox(externalId: string): Promise<Sandbox> {
		const cached = this.cache.get(externalId);
		if (cached) return cached;
		try {
			const sandbox = await this.daytona.get(externalId);
			this.cache.set(externalId, sandbox);
			return sandbox;
		} catch (error) {
			throw safeError(error);
		}
	}

	async ensureRunning(externalId: string): Promise<{ state: string }> {
		const sandbox = await this.sandbox(externalId);
		const state = stateLabel(sandbox);
		if (state === "started") return { state };
		if (state === "error" || state === "build_failed" || state === "destroyed") {
			throw new SandboxError(`Sandbox is not available (state: ${state}). Recreate the workspace.`);
		}
		try {
			if (state !== "started") {
				await this.daytona.start(sandbox, 120);
			}
			const refreshed = await this.daytona.get(externalId);
			this.cache.set(externalId, refreshed);
			return { state: stateLabel(refreshed) };
		} catch (error) {
			throw safeError(error);
		}
	}

	async provision(input: ProvisionInput): Promise<ProvisionedWorkspace> {
		const env = getServerEnv();
		const setupLog: string[] = [];
		let sandbox: Sandbox;
		try {
			sandbox = await this.daytona.create(
				{
					name: `a21-${input.projectId.slice(0, 8)}-${Date.now().toString(36)}`,
					language: baseLanguage(input.language),
					labels: {
						app: "21-agent",
						project: input.projectId,
					},
					public: true,
					autoStopInterval: env.SANDBOX_AUTO_STOP_MINUTES,
					autoArchiveInterval: env.SANDBOX_AUTO_ARCHIVE_MINUTES,
					ephemeral: false,
				},
				{ timeout: 180 },
			);
		} catch (error) {
			throw safeError(error);
		}

		this.cache.set(sandbox.id, sandbox);
		const rootPath = await this.resolveRoot(sandbox, env.DAYTONA_WORKSPACE_ROOT);
		setupLog.push(`sandbox ${sandbox.id} ready at ${rootPath}`);

		try {
			const existing = await this.listFilesInternal(sandbox, rootPath, ".", 1);
			if (existing.length === 0) {
				if (input.repoUrl) {
					setupLog.push(`cloning ${input.repoUrl}`);
					const branch = input.repoBranch ? ` --branch ${shellQuote(input.repoBranch)}` : "";
					const clone = await this.runInternal(
						sandbox,
						rootPath,
						`git clone --depth 1${branch} ${shellQuote(input.repoUrl)} .`,
						240,
					);
					setupLog.push(...clone.output.split("\n").filter(Boolean).slice(-8));
					if (clone.exitCode !== 0) {
						throw new SandboxError(
							"Could not clone the repository into the sandbox.",
							clone.output.slice(-1200),
						);
					}
				} else {
					const files = templateFiles(input.template, input.projectName);
					for (const [relative, content] of Object.entries(files)) {
						await this.writeInternal(sandbox, rootPath, relative, content);
					}
					setupLog.push(`wrote ${Object.keys(files).length} starter files (${input.template})`);
				}
			} else {
				setupLog.push("workspace already contains files; starter scaffold skipped");
			}
		} catch (error) {
			if (error instanceof SandboxError) throw error;
			throw safeError(error);
		}

		let runtime: RuntimeStatus;
		try {
			runtime = await this.detectRuntimeInternal(sandbox, rootPath, input.language);
		} catch (error) {
			runtime = {
				language: input.language,
				ready: false,
				detail: error instanceof Error ? error.message : "Runtime detection failed",
			};
		}
		setupLog.push(
			runtime.ready ? `runtime ready: ${runtime.detail}` : `runtime missing: ${runtime.detail}`,
		);

		return {
			externalId: sandbox.id,
			rootPath,
			state: "ready",
			runtime,
			setupLog,
		};
	}

	async delete(externalId: string): Promise<void> {
		try {
			const sandbox = await this.sandbox(externalId);
			await this.daytona.delete(sandbox, 120, true);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/not found|404/i.test(message)) return;
			throw safeError(error);
		} finally {
			this.cache.delete(externalId);
		}
	}

	private async resolveRoot(sandbox: Sandbox, configuredRoot: string): Promise<string> {
		const pwd = await this.runInternal(sandbox, undefined, "pwd", 30);
		const home = (pwd.output.trim().split("\n").pop() || "/home/daytona").replace(/\/+$/, "");
		const name = configuredRoot.replace(/^\/+|\/+$/g, "") || "workspace";
		const root = `${home}/${name}`;
		await this.runInternal(sandbox, home, `mkdir -p ${shellQuote(root)}`, 30);
		return root;
	}

	private async listFilesInternal(
		sandbox: Sandbox,
		rootPath: string,
		relativePath: string,
		depth: number,
	): Promise<SandboxFile[]> {
		const absolute = joinRemotePath(rootPath, relativePath);
		const files = await sandbox.fs.listFiles(absolute, { depth });
		return files
			.slice(0, MAX_LIST_ENTRIES)
			.map((file) => {
				const full = file.path ?? `${absolute}/${file.name}`;
				const relative = full.startsWith(`${rootPath}/`)
					? full.slice(rootPath.length + 1)
					: normalizeWorkspacePath(file.name, { allowRoot: true });
				return {
					name: file.name,
					path: relative,
					type: file.isDir ? ("dir" as const) : ("file" as const),
					size: file.size,
					modifiedAt: file.modifiedAt ?? null,
				};
			})
			.sort((a, b) => {
				if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
				return a.path.localeCompare(b.path);
			});
	}

	async listFiles(
		externalId: string,
		rootPath: string,
		relativePath: string,
		depth: number,
	): Promise<SandboxFile[]> {
		const sandbox = await this.ensureSandboxForData(externalId);
		try {
			return await this.listFilesInternal(
				sandbox,
				rootPath,
				relativePath,
				Math.min(Math.max(depth, 1), 5),
			);
		} catch (error) {
			throw safeError(error);
		}
	}

	async readFile(externalId: string, rootPath: string, relativePath: string): Promise<Buffer> {
		const sandbox = await this.ensureSandboxForData(externalId);
		const { absolute } = resolveWorkspacePath(rootPath, relativePath);
		try {
			const info = await sandbox.fs.getFileDetails(absolute);
			if (info.isDir) throw new SandboxError("That path is a directory, not a file.");
			if (info.size > MAX_READ_BYTES) {
				throw new SandboxError(
					`File is too large to read (${info.size} bytes; limit ${MAX_READ_BYTES}).`,
				);
			}
			return await sandbox.fs.downloadFile(absolute);
		} catch (error) {
			if (error instanceof SandboxError) throw error;
			throw safeError(error);
		}
	}

	private async writeInternal(
		sandbox: Sandbox,
		rootPath: string,
		relativePath: string,
		content: Buffer | string,
	): Promise<void> {
		const { absolute, relative } = resolveWorkspacePath(rootPath, relativePath);
		const parent = relative.split("/").slice(0, -1).join("/");
		if (parent) {
			await this.runInternal(
				sandbox,
				rootPath,
				`mkdir -p ${shellQuote(joinRemotePath(rootPath, parent))}`,
				30,
			);
		}
		await sandbox.fs.uploadFile(
			Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"),
			absolute,
		);
	}

	async writeFile(
		externalId: string,
		rootPath: string,
		relativePath: string,
		content: Buffer | string,
	): Promise<void> {
		const sandbox = await this.ensureSandboxForData(externalId);
		try {
			await this.writeInternal(sandbox, rootPath, relativePath, content);
		} catch (error) {
			throw safeError(error);
		}
	}

	async deleteFile(externalId: string, rootPath: string, relativePath: string): Promise<void> {
		const sandbox = await this.ensureSandboxForData(externalId);
		const { absolute } = resolveWorkspacePath(rootPath, relativePath);
		try {
			await sandbox.fs.deleteFile(absolute, true);
		} catch (error) {
			throw safeError(error);
		}
	}

	private async runInternal(
		sandbox: Sandbox,
		cwd: string | undefined,
		command: string,
		timeoutSeconds: number,
	): Promise<ExecResult> {
		const started = Date.now();
		const response = await sandbox.process.executeCommand(command, cwd, undefined, timeoutSeconds);
		return {
			exitCode: typeof response.exitCode === "number" ? response.exitCode : -1,
			output: response.result ?? "",
			durationMs: Date.now() - started,
		};
	}

	async execute(
		externalId: string,
		rootPath: string,
		command: string,
		options?: { cwd?: string; timeoutSeconds?: number; env?: Record<string, string> },
	): Promise<ExecResult> {
		assertSafeCommand(command);
		const sandbox = await this.ensureSandboxForData(externalId);
		const cwd = options?.cwd
			? joinRemotePath(rootPath, normalizeWorkspacePath(options.cwd, { allowRoot: true }))
			: rootPath;
		const timeout = Math.min(Math.max(options?.timeoutSeconds ?? 60, 1), 600);
		const started = Date.now();
		try {
			const response = await sandbox.process.executeCommand(command, cwd, options?.env, timeout);
			return {
				exitCode: typeof response.exitCode === "number" ? response.exitCode : -1,
				output: response.result ?? "",
				durationMs: Date.now() - started,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/timeout|timed out/i.test(message)) {
				return {
					exitCode: 124,
					output: `Command timed out after ${timeout}s.\n${message}`,
					durationMs: Date.now() - started,
					timedOut: true,
				};
			}
			throw safeError(error);
		}
	}

	async startStreamingCommand(
		externalId: string,
		rootPath: string,
		command: string,
		options?: { cwd?: string; timeoutSeconds?: number; env?: Record<string, string> },
	): Promise<StreamingCommand> {
		assertSafeCommand(command);
		const sandbox = await this.ensureSandboxForData(externalId);
		const cwd = options?.cwd
			? joinRemotePath(rootPath, normalizeWorkspacePath(options.cwd, { allowRoot: true }))
			: rootPath;
		const sessionId = `a21-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		// Session requests do not accept a cwd, so change directory explicitly.
		const sessionCommand = options?.cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
		try {
			await sandbox.process.createSession(sessionId);
			const response = await sandbox.process.executeSessionCommand(
				sessionId,
				{ command: sessionCommand, runAsync: true, suppressInputEcho: true },
				Math.min(Math.max(options?.timeoutSeconds ?? 120, 1), 600),
			);
			if (!response.cmdId) {
				throw new SandboxError("The sandbox did not return a command id.");
			}
			return { sessionId, commandId: response.cmdId };
		} catch (error) {
			if (error instanceof SandboxError) throw error;
			throw safeError(error);
		}
	}

	async getStreamingSnapshot(
		externalId: string,
		sessionId: string,
		commandId: string,
	): Promise<StreamingSnapshot> {
		const sandbox = await this.ensureSandboxForData(externalId);
		try {
			const [logs, command] = await Promise.all([
				sandbox.process.getSessionCommandLogs(sessionId, commandId),
				sandbox.process.getSessionCommand(sessionId, commandId),
			]);
			return {
				stdout: logs.stdout ?? logs.output ?? "",
				stderr: logs.stderr ?? "",
				exitCode: typeof command.exitCode === "number" ? command.exitCode : null,
			};
		} catch (error) {
			throw safeError(error);
		}
	}

	async getPreviewLink(externalId: string, port: number): Promise<{ url: string }> {
		const sandbox = await this.ensureSandboxForData(externalId);
		try {
			const link = await sandbox.getPreviewLink(port);
			if (!link?.url) throw new SandboxError("Daytona did not return a preview URL.");
			return { url: link.url };
		} catch (error) {
			if (error instanceof SandboxError) throw error;
			throw safeError(error);
		}
	}

	async detectRuntime(
		externalId: string,
		rootPath: string,
		language: string,
	): Promise<RuntimeStatus> {
		const sandbox = await this.ensureSandboxForData(externalId);
		return this.detectRuntimeInternal(sandbox, rootPath, language);
	}

	private async detectRuntimeInternal(
		sandbox: Sandbox,
		rootPath: string,
		language: string,
	): Promise<RuntimeStatus> {
		const spec = runtimeSpec(language);
		try {
			const result = await this.runInternal(sandbox, rootPath, spec.probe, 45);
			const detail = result.output.trim().split("\n").slice(0, 2).join(" · ") || "no output";
			return { language, ready: result.exitCode === 0, detail };
		} catch (error) {
			return {
				language,
				ready: false,
				detail: sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
			};
		}
	}

	async installRuntime(
		externalId: string,
		rootPath: string,
		language: string,
	): Promise<RuntimeStatus> {
		const sandbox = await this.ensureSandboxForData(externalId);
		const current = await this.detectRuntimeInternal(sandbox, rootPath, language);
		if (current.ready) return current;

		const command = runtimeInstallCommand(language);
		const result = await this.runInternal(sandbox, rootPath, command, 480);
		const after = await this.detectRuntimeInternal(sandbox, rootPath, language);
		if (!after.ready) {
			return {
				language,
				ready: false,
				detail: `${after.detail}\n${result.output.slice(-900)}`,
			};
		}
		return after;
	}

	private async ensureSandboxForData(externalId: string): Promise<Sandbox> {
		await this.ensureRunning(externalId);
		return this.sandbox(externalId);
	}
}

export function isSandboxError(error: unknown): error is SandboxError {
	return error instanceof SandboxError;
}

export function sandboxApiError(error: unknown): ApiError {
	if (error instanceof SandboxNotConfiguredError) {
		return new ApiError(503, "sandbox_not_configured", error.message);
	}
	return new ApiError(
		502,
		"sandbox_error",
		error instanceof SandboxError ? error.message : "Cloud sandbox request failed.",
		error instanceof SandboxError ? error.detail : undefined,
	);
}
