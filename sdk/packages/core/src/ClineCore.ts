import type {
	AgentConfig,
	BasicLogger,
	ITelemetryService,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/shared";
import type { TeamToolsFactory } from "./runtime/session-runtime";
import {
	createSessionHost,
	type SessionBackend,
	type SessionHost,
} from "./session/session-host";
import type { StartSessionInput } from "./session/session-manager";
import type { ToolExecutors } from "./tools";

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
	 * Controls how the session backend is selected:
	 * - `"auto"` (default) — connects to a running RPC server if available, starts one in the
	 *   background if `rpc.autoStart` is true, and falls back to local SQLite/file storage.
	 * - `"rpc"` — requires an RPC server; throws if one is not reachable.
	 * - `"local"` — always uses local SQLite (or file-based) storage; never touches RPC.
	 */
	backendMode?: "auto" | "rpc" | "local";
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
	 * adapter that mutates the `StartSessionInput` generically before core
	 * builds the runtime.
	 */
	prepare?: (
		input: StartSessionInput,
	) =>
		| Promise<StartSessionBootstrap | undefined>
		| StartSessionBootstrap
		| undefined;
}

export interface StartSessionBootstrap {
	applyToStartSessionInput(
		input: StartSessionInput,
	): Promise<StartSessionInput> | StartSessionInput;
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
export class ClineCore implements SessionHost {
	readonly clientName: string | undefined;
	private readonly host: SessionHost;
	private readonly prepare: ClineCoreOptions["prepare"] | undefined;
	private readonly teamToolsFactory: TeamToolsFactory | undefined;
	private readonly activeSessionBootstraps = new Map<
		string,
		StartSessionBootstrap
	>();
	private readonly unsubscribeBootstrapCleanup: () => void;

	private constructor(
		host: SessionHost,
		clientName: string | undefined,
		prepare: ClineCoreOptions["prepare"],
		teamToolsFactory: TeamToolsFactory | undefined,
	) {
		this.clientName = clientName;
		this.host = host;
		this.prepare = prepare;
		this.teamToolsFactory = teamToolsFactory;
		this.unsubscribeBootstrapCleanup = this.host.subscribe((event) => {
			if (event.type !== "ended") {
				return;
			}
			void this.disposeSessionBootstrap(event.payload.sessionId);
		});
	}

	static async create(options: ClineCoreOptions = {}): Promise<ClineCore> {
		const host = await createSessionHost(options);
		return new ClineCore(
			host,
			options.clientName,
			options.prepare,
			options.teamToolsFactory,
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

	start: SessionHost["start"] = async (input) => {
		const inputWithFactory: StartSessionInput = this.teamToolsFactory
			? { teamToolsFactory: this.teamToolsFactory, ...input }
			: input;
		const bootstrap = await this.prepare?.(inputWithFactory);
		try {
			const effectiveInput = bootstrap
				? await bootstrap.applyToStartSessionInput(inputWithFactory)
				: inputWithFactory;
			const result = await this.host.start(effectiveInput);
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
	};
	send: SessionHost["send"] = (...args) => this.host.send(...args);
	getAccumulatedUsage: SessionHost["getAccumulatedUsage"] = (...args) =>
		this.host.getAccumulatedUsage(...args);
	abort: SessionHost["abort"] = (...args) => this.host.abort(...args);
	stop: SessionHost["stop"] = async (sessionId) => {
		await this.host.stop(sessionId);
		await this.disposeSessionBootstrap(sessionId);
	};
	dispose: SessionHost["dispose"] = async (...args) => {
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
	get: SessionHost["get"] = (...args) => this.host.get(...args);
	list: SessionHost["list"] = (...args) => this.host.list(...args);
	delete: SessionHost["delete"] = async (sessionId) => {
		const deleted = await this.host.delete(sessionId);
		if (deleted) {
			await this.disposeSessionBootstrap(sessionId);
		}
		return deleted;
	};
	readMessages: SessionHost["readMessages"] = (...args) =>
		this.host.readMessages(...args);
	readTranscript: SessionHost["readTranscript"] = (...args) =>
		this.host.readTranscript(...args);
	readHooks: SessionHost["readHooks"] = (...args) =>
		this.host.readHooks(...args);
	subscribe: SessionHost["subscribe"] = (...args) =>
		this.host.subscribe(...args);
	updateSessionModel: SessionHost["updateSessionModel"] = (...args) =>
		this.host.updateSessionModel?.(...args) ?? Promise.resolve();
}
