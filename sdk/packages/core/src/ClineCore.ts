import type {
	AgentConfig,
	BasicLogger,
	ITelemetryService,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/shared";
import type { ToolExecutors } from "./extensions/tools";
import { hydrateSessionHistory } from "./runtime/history";
import type { SessionBackend } from "./runtime/host";
import { createRuntimeHost } from "./runtime/host";
import type {
	LocalRuntimeStartOptions,
	RuntimeHost,
	RuntimeHostMode,
	StartSessionInput,
	StartSessionResult,
} from "./runtime/runtime-host";
import { splitCoreSessionConfig } from "./runtime/runtime-host";
import type { TeamToolsFactory } from "./runtime/session-runtime";
import type { CoreSessionConfig } from "./types/config";
import type { SessionMessagesArtifactUploader } from "./types/session";

/** Advanced options for connecting to or spawning the Cline RPC server. */
export interface RpcOptions {
	/**
	 * The address of the Cline RPC server to connect to.
	 * Defaults to the `CLINE_RPC_ADDRESS` env var, or the SDK default address if unset.
	 */
	address?: string;
	/**
	 * When `true` (default), automatically spawns a background RPC server process if one is
	 * not already running.
	 */
	autoStart?: boolean;
	/**
	 * Number of connection attempts made to the RPC server after it is spawned.
	 * Defaults to `5`.
	 */
	connectAttempts?: number;
	/**
	 * Milliseconds to wait between RPC connection attempts. Defaults to `100`.
	 */
	connectDelayMs?: number;
}

export type { RuntimeHostMode };

export interface ClineCoreStartInput
	extends Omit<StartSessionInput, "config" | "localRuntime"> {
	config: CoreSessionConfig;
	localRuntime?: LocalRuntimeStartOptions;
}

export interface ClineCoreOptions {
	/**
	 * A human-readable name for this SDK client (e.g. `"my-app"`, `"acme-bot"`).
	 * Used to identify the consumer in telemetry and logs.
	 */
	clientName?: string;
	/**
	 * A stable identifier for this machine or user, used for telemetry attribution.
	 * Defaults to the system machine ID, falling back to a generated `cl-<nanoid>` persisted
	 * at `~/.cline/data/machine-id`.
	 */
	distinctId?: string;
	/**
	 * Controls how the runtime host is selected:
	 * - `"auto"` (default) — connects to a running RPC server if available, starts one in the
	 *   background if `rpc.autoStart` is true, and falls back to local in-process execution.
	 * - `"rpc"` — requires an RPC runtime server; throws if one is not reachable.
	 * - `"local"` — always uses local in-process execution and local SQLite/file storage.
	 */
	backendMode?: RuntimeHostMode;
	/**
	 * RPC server connection options. Only relevant when `backendMode` is `"auto"` or `"rpc"`.
	 */
	rpc?: RpcOptions;
	/**
	 * Override one or more default tool executors (e.g. file I/O, shell, browser).
	 * Partial — only the keys you supply are replaced; the rest use built-in implementations.
	 */
	defaultToolExecutors?: Partial<ToolExecutors>;
	/**
	 * Telemetry service instance to use for capturing events and usage.
	 * If omitted, telemetry is a no-op.
	 */
	telemetry?: ITelemetryService;
	/**
	 * Optional structured logger for core-side operational diagnostics such as
	 * RPC backend startup, reuse, and fallback decisions.
	 */
	logger?: BasicLogger;
	/**
	 * Per-tool approval policies that control whether a tool runs automatically,
	 * requires user confirmation, or is blocked entirely.
	 */
	toolPolicies?: AgentConfig["toolPolicies"];
	/**
	 * Called before any tool is executed that requires explicit user approval.
	 * Return `{ approved: true }` to allow or `{ approved: false }` to deny.
	 * If omitted, all approval-required tools are auto-denied.
	 */
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
	/**
	 * Optional hook invoked after `messages.json` is persisted to disk.
	 * Consumers can use this to mirror session transcripts into remote storage.
	 */
	messagesArtifactUploader?: SessionMessagesArtifactUploader;
	/**
	 * An already-constructed session backend to use instead of resolving one automatically.
	 * Intended for testing or embedding a custom persistence layer.
	 * @internal
	 */
	sessionService?: SessionBackend;
	/**
	 * Factory that creates team management tools for the multi-agent team system.
	 * When provided, team tools are registered whenever `enableAgentTeams` is `true`
	 * on a session config.
	 *
	 * Consumers that depend on `@clinebot/enterprise` can pass
	 * `bootstrapAgentTeams` here directly.
	 */
	teamToolsFactory?: TeamToolsFactory;
	/**
	 * Optional hook invoked before each session starts.
	 * Use this to prepare workspace-scoped runtime state and then return an
	 * adapter that mutates the shared session input before core starts the run.
	 */
	prepare?: (
		input: ClineCoreStartInput,
	) =>
		| Promise<StartSessionBootstrap | undefined>
		| StartSessionBootstrap
		| undefined;
}

export interface StartSessionBootstrap {
	applyToStartSessionInput(
		input: ClineCoreStartInput,
	): Promise<ClineCoreStartInput> | ClineCoreStartInput;
	dispose?(): Promise<void> | void;
}

/**
 * The primary entry point for the Cline Core SDK.
 *
 * @example
 * ```ts
 * import { ClineCore } from "@clinebot/core";
 *
 * const cline = await ClineCore.create({ clientName: "my-app" });
 * const session = await cline.start({ ... });
 * ```
 */
export class ClineCore implements RuntimeHost {
	readonly clientName: string | undefined;
	readonly runtimeAddress: string | undefined;
	private readonly host: RuntimeHost;
	private readonly prepare: ClineCoreOptions["prepare"] | undefined;
	private readonly activeSessionBootstraps = new Map<
		string,
		StartSessionBootstrap
	>();
	private readonly unsubscribeBootstrapCleanup: () => void;

	private constructor(
		host: RuntimeHost,
		clientName: string | undefined,
		runtimeAddress: string | undefined,
		prepare: ClineCoreOptions["prepare"],
	) {
		this.clientName = clientName;
		this.runtimeAddress = runtimeAddress;
		this.host = host;
		this.prepare = prepare;
		this.unsubscribeBootstrapCleanup = this.host.subscribe((event) => {
			if (event.type !== "ended") {
				return;
			}
			void this.disposeSessionBootstrap(event.payload.sessionId);
		});
	}

	static async create(options: ClineCoreOptions = {}): Promise<ClineCore> {
		const host = await createRuntimeHost(options);
		return new ClineCore(
			host,
			options.clientName,
			host.runtimeAddress,
			options.prepare,
		);
	}

	private async disposeSessionBootstrap(sessionId: string): Promise<void> {
		const bootstrap = this.activeSessionBootstraps.get(sessionId);
		if (!bootstrap) {
			return;
		}
		this.activeSessionBootstraps.delete(sessionId);
		await Promise.resolve(bootstrap.dispose?.());
	}

	private toClineCoreStartInput(
		input: StartSessionInput | ClineCoreStartInput,
	): ClineCoreStartInput {
		const config = input.config as CoreSessionConfig;
		return "providerId" in config
			? {
					...input,
					config: {
						...config,
						...(input.localRuntime?.configOverrides ?? {}),
					},
					localRuntime: input.localRuntime
						? {
								...input.localRuntime,
								configOverrides: input.localRuntime.configOverrides,
							}
						: undefined,
				}
			: (input as ClineCoreStartInput);
	}

	private normalizeStartInput(input: ClineCoreStartInput): StartSessionInput {
		const split = splitCoreSessionConfig(input.config);
		const localRuntime =
			split.localRuntime || input.localRuntime
				? {
						...(split.localRuntime ?? {}),
						...(input.localRuntime ?? {}),
						configOverrides: {
							...(split.localRuntime?.configOverrides ?? {}),
							...(input.localRuntime?.configOverrides ?? {}),
						},
					}
				: undefined;
		return {
			...input,
			...split,
			...(localRuntime ? { localRuntime } : {}),
		};
	}

	start(input: StartSessionInput): Promise<StartSessionResult>;
	start(input: ClineCoreStartInput): Promise<StartSessionResult>;
	async start(
		input: StartSessionInput | ClineCoreStartInput,
	): Promise<StartSessionResult> {
		const clineCoreInput = this.toClineCoreStartInput(input);
		const bootstrap = await this.prepare?.(clineCoreInput);
		try {
			const preparedInput = bootstrap
				? await bootstrap.applyToStartSessionInput(clineCoreInput)
				: clineCoreInput;
			const result = await this.host.start(
				this.normalizeStartInput(preparedInput),
			);
			if (bootstrap) {
				const activeSession = await this.host.get(result.sessionId);
				if (activeSession) {
					this.activeSessionBootstraps.set(result.sessionId, bootstrap);
				} else {
					await Promise.resolve(bootstrap.dispose?.());
				}
			}
			return result;
		} catch (error) {
			await Promise.resolve(bootstrap?.dispose?.());
			throw error;
		}
	}
	send: RuntimeHost["send"] = (...args) => this.host.send(...args);
	getAccumulatedUsage: RuntimeHost["getAccumulatedUsage"] = (...args) =>
		this.host.getAccumulatedUsage(...args);
	abort: RuntimeHost["abort"] = (...args) => this.host.abort(...args);
	stop: RuntimeHost["stop"] = async (sessionId) => {
		await this.host.stop(sessionId);
		await this.disposeSessionBootstrap(sessionId);
	};
	dispose: RuntimeHost["dispose"] = async (...args) => {
		try {
			await this.host.dispose(...args);
		} finally {
			this.unsubscribeBootstrapCleanup();
			const sessionIds = [...this.activeSessionBootstraps.keys()];
			await Promise.allSettled(
				sessionIds.map((sessionId) => this.disposeSessionBootstrap(sessionId)),
			);
		}
	};
	get: RuntimeHost["get"] = (...args) => this.host.get(...args);
	list: RuntimeHost["list"] = async (limit = 200) =>
		await hydrateSessionHistory(this.host, await this.host.list(limit));
	delete: RuntimeHost["delete"] = async (sessionId) => {
		const deleted = await this.host.delete(sessionId);
		if (deleted) {
			await this.disposeSessionBootstrap(sessionId);
		}
		return deleted;
	};
	update: RuntimeHost["update"] = (...args) => this.host.update(...args);
	readMessages: RuntimeHost["readMessages"] = (...args) =>
		this.host.readMessages(...args);
	handleHookEvent: RuntimeHost["handleHookEvent"] = (...args) =>
		this.host.handleHookEvent(...args);
	subscribe: RuntimeHost["subscribe"] = (...args) =>
		this.host.subscribe(...args);
	updateSessionModel: RuntimeHost["updateSessionModel"] = (...args) =>
		this.host.updateSessionModel?.(...args) ?? Promise.resolve();
}
