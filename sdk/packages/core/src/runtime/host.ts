import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getRpcServerDefaultAddress, getRpcServerHealth } from "@clinebot/rpc";
import {
	augmentNodeCommandForDebug,
	withResolvedClineBuildEnv,
} from "@clinebot/shared";
import {
	resolveClineDataDir,
	resolveSessionDataDir,
} from "@clinebot/shared/storage";
import type { ClineCoreOptions } from "../ClineCore";
import { SqliteSessionStore } from "../services/storage/sqlite-session-store";
import { resolveCoreDistinctId } from "../services/telemetry/distinct-id";
import { FileSessionService } from "../session/file-session-service";
import { RpcCoreSessionService } from "../session/rpc-session-service";
import { CoreSessionService } from "../session/session-service";
import { LocalRuntimeHost } from "../transports/local";
import { RpcRuntimeHost } from "../transports/rpc";
import {
	ensureRpcRuntimeAddress,
	RPC_BUILD_ID_ENV,
	RPC_DISCOVERY_PATH_ENV,
	RPC_OWNER_ID_ENV,
	RPC_STARTUP_LOCK_BYPASS_ENV,
	type RpcOwnerContext,
	resolveRpcOwnerContext,
} from "./rpc-runtime-ensure";
import { tryAcquireRpcSpawnLease } from "./rpc-spawn-lease";
import type { RuntimeHost, RuntimeHostMode } from "./runtime-host";

const DEFAULT_RPC_ADDRESS =
	process.env.CLINE_RPC_ADDRESS?.trim() || getRpcServerDefaultAddress();

function requiresLocalRuntimeHost(options: ClineCoreOptions): boolean {
	return !!options.defaultToolExecutors || !!options.teamToolsFactory;
}

function resolveConfiguredBackendMode(
	options: ClineCoreOptions,
): RuntimeHostMode {
	if (options.backendMode) {
		return options.backendMode;
	}
	if (process.env.CLINE_VCR?.trim()) {
		return "local";
	}
	const raw = process.env.CLINE_SESSION_BACKEND_MODE?.trim().toLowerCase();
	if (raw === "rpc" || raw === "local") {
		return raw;
	}
	return "auto";
}

export type SessionBackend =
	| RpcCoreSessionService
	| CoreSessionService
	| FileSessionService;

let cachedBackend: SessionBackend | undefined;
let backendInitPromise: Promise<SessionBackend> | undefined;

async function reconcileDeadSessionsIfSupported(
	backend: SessionBackend,
): Promise<void> {
	const service = backend as SessionBackend & {
		reconcileDeadSessions?: (limit?: number) => Promise<number>;
	};
	await service.reconcileDeadSessions?.().catch(() => {});
}

function openRpcSidecarLogFile(): { fd: number; logPath: string } | undefined {
	try {
		const logPath = join(resolveClineDataDir(), "logs", "rpc-sidecar.log");
		mkdirSync(dirname(logPath), { recursive: true });
		return { fd: openSync(logPath, "a"), logPath };
	} catch {
		return undefined;
	}
}

function startRpcServerInBackground(
	address: string,
	owner: RpcOwnerContext,
	logger?: ClineCoreOptions["logger"],
): void {
	const lease = tryAcquireRpcSpawnLease(address);
	if (!lease) {
		logger?.log("RPC sidecar spawn skipped", {
			address,
			reason: "spawn_lease_unavailable",
			severity: "warn",
		});
		return;
	}
	const launcher = process.execPath;
	const entryArg = process.argv[1]?.trim();
	if (!entryArg) {
		lease.release();
		logger?.error?.("RPC sidecar spawn aborted", {
			address,
			reason: "missing_process_entry_arg",
		});
		return;
	}
	const entry = resolve(process.cwd(), entryArg);
	if (!existsSync(entry)) {
		lease.release();
		logger?.error?.("RPC sidecar spawn aborted", {
			address,
			reason: "entrypoint_missing",
			entryPath: entry,
		});
		return;
	}
	const conditionsArg = process.execArgv.find((arg) =>
		arg.startsWith("--conditions="),
	);
	const command = augmentNodeCommandForDebug(
		[
			launcher,
			...(conditionsArg ? [conditionsArg] : []),
			entry,
			"rpc",
			"start",
			"--address",
			address,
		],
		{ debugRole: "rpc" },
	);
	const sidecarLog = openRpcSidecarLogFile();
	logger?.log("Launching detached RPC sidecar", {
		address,
		command: command.join(" "),
		commandArgs: command.slice(1),
		executable: command[0] ?? launcher,
		entryPath: entry,
		cwd: process.cwd(),
		logPath: sidecarLog?.logPath,
	});
	try {
		const child = spawn(command[0] ?? launcher, command.slice(1), {
			detached: true,
			stdio: sidecarLog ? ["ignore", sidecarLog.fd, sidecarLog.fd] : "ignore",
			env: {
				...withResolvedClineBuildEnv(process.env),
				[RPC_STARTUP_LOCK_BYPASS_ENV]: "1",
				[RPC_OWNER_ID_ENV]: owner.ownerId,
				[RPC_BUILD_ID_ENV]: owner.buildId,
				[RPC_DISCOVERY_PATH_ENV]: owner.discoveryPath,
				CLINE_NO_INTERACTIVE: "1",
			},
			cwd: process.cwd(),
		});
		logger?.log("Detached RPC sidecar spawned", {
			address,
			childPid: child.pid,
			logPath: sidecarLog?.logPath,
		});
		child.unref();
		setTimeout(() => lease.release(), 10_000).unref();
	} catch (error) {
		lease.release();
		logger?.error?.("RPC sidecar spawn failed", {
			address,
			logPath: sidecarLog?.logPath,
			error,
		});
		throw error;
	} finally {
		if (sidecarLog) {
			closeSync(sidecarLog.fd);
		}
	}
}

async function tryConnectRpcBackend(
	address: string,
	options: ClineCoreOptions,
): Promise<RpcCoreSessionService | undefined> {
	try {
		const health = await getRpcServerHealth(address);
		if (!health) {
			return undefined;
		}
		return new RpcCoreSessionService({
			address,
			sessionsDir: resolveSessionDataDir(),
			messagesArtifactUploader: options.messagesArtifactUploader,
		});
	} catch {
		return undefined;
	}
}

function createLocalBackend(options: ClineCoreOptions): SessionBackend {
	try {
		const store = new SqliteSessionStore();
		store.init();
		return new CoreSessionService(store, {
			messagesArtifactUploader: options.messagesArtifactUploader,
		});
	} catch {
		// Fallback to file-based session service if SQLite is unavailable (e.g. due to missing native bindings on certain platforms)
		options.telemetry?.capture({
			event: "session_backend_fallback",
			properties: {
				requestedBackend: "sqlite",
				fallbackBackend: "file",
			},
		});
		return new FileSessionService(undefined, {
			messagesArtifactUploader: options.messagesArtifactUploader,
		});
	}
}

export async function resolveSessionBackend(
	options: ClineCoreOptions,
): Promise<SessionBackend> {
	if (cachedBackend) {
		return cachedBackend;
	}
	if (backendInitPromise) {
		return await backendInitPromise;
	}

	const mode = resolveConfiguredBackendMode(options);
	const requestedAddress = options.rpc?.address?.trim() || DEFAULT_RPC_ADDRESS;
	const attempts = Math.max(1, options.rpc?.connectAttempts ?? 5);
	const delayMs = Math.max(0, options.rpc?.connectDelayMs ?? 100);
	const autoStartRpc = options.rpc?.autoStart !== false;
	const logger = options.logger;

	backendInitPromise = (async () => {
		if (mode === "local") {
			cachedBackend = createLocalBackend(options);
			await reconcileDeadSessionsIfSupported(cachedBackend);
			return cachedBackend;
		}

		let address = requestedAddress;
		const existingRpcBackend = await tryConnectRpcBackend(address, options);
		if (existingRpcBackend) {
			logger?.log("Connected to existing RPC session backend", { address });
			cachedBackend = existingRpcBackend;
			await reconcileDeadSessionsIfSupported(cachedBackend);
			return cachedBackend;
		}

		if (mode === "rpc") {
			throw new Error(`RPC backend unavailable at ${address}`);
		}

		if (autoStartRpc) {
			try {
				logger?.log("Ensuring RPC runtime for auto session backend", {
					address,
				});
				const ensured = await ensureRpcRuntimeAddress(address, {
					resolveOwner: () => resolveRpcOwnerContext({ ownerPrefix: "core" }),
					spawnIfNeeded: (rpcAddress, owner) => {
						startRpcServerInBackground(rpcAddress, owner, logger);
					},
				});
				address = ensured.address;
				logger?.log("RPC runtime ensure completed", {
					requestedAddress,
					address,
					action: ensured.action,
				});
			} catch (error) {
				logger?.error?.("RPC backend auto-start failed", {
					address,
					requestedAddress,
					error,
				});
			}

			for (let attempt = 0; attempt < attempts; attempt += 1) {
				const rpcBackend = await tryConnectRpcBackend(address, options);
				if (rpcBackend) {
					logger?.log("Connected to ensured RPC session backend", {
						address,
						attempt: attempt + 1,
						attempts,
					});
					cachedBackend = rpcBackend;
					await reconcileDeadSessionsIfSupported(cachedBackend);
					return cachedBackend;
				}
				if (delayMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, delayMs));
				}
			}
		}

		logger?.log("Falling back to local session backend", {
			requestedAddress,
			address,
			attempts,
			delayMs,
			severity: "warn",
		});
		cachedBackend = createLocalBackend(options);
		await reconcileDeadSessionsIfSupported(cachedBackend);
		return cachedBackend;
	})().finally(() => {
		backendInitPromise = undefined;
	});

	return await backendInitPromise;
}

export async function createRuntimeHost(
	options: ClineCoreOptions,
): Promise<RuntimeHost> {
	const distinctId = resolveCoreDistinctId(options.distinctId);
	options.telemetry?.setDistinctId(distinctId);
	const configuredMode = resolveConfiguredBackendMode(options);
	if (requiresLocalRuntimeHost(options)) {
		if (configuredMode === "rpc") {
			throw new Error(
				"RPC runtime mode does not support local-only runtime host options such as custom tool executors or team tools factories.",
			);
		}
		options.logger?.log("Using local runtime host due to local-only options", {
			configuredMode,
			hasDefaultToolExecutors: !!options.defaultToolExecutors,
			hasTeamToolsFactory: !!options.teamToolsFactory,
		});
		const backend = options.sessionService ?? createLocalBackend(options);
		return new LocalRuntimeHost({
			sessionService: backend,
			defaultToolExecutors: options.defaultToolExecutors,
			teamToolsFactory: options.teamToolsFactory,
			telemetry: options.telemetry,
			toolPolicies: options.toolPolicies,
			requestToolApproval: options.requestToolApproval,
			distinctId,
		});
	}
	const backend =
		options.sessionService ?? (await resolveSessionBackend(options));
	if (backend instanceof RpcCoreSessionService) {
		return new RpcRuntimeHost(
			backend,
			options.toolPolicies,
			options.requestToolApproval,
		);
	}
	return new LocalRuntimeHost({
		sessionService: backend,
		defaultToolExecutors: options.defaultToolExecutors,
		teamToolsFactory: options.teamToolsFactory,
		telemetry: options.telemetry,
		toolPolicies: options.toolPolicies,
		requestToolApproval: options.requestToolApproval,
		distinctId,
	});
}
