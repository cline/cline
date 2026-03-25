import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
	AgentConfig,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@clinebot/agents";
import { getRpcServerDefaultAddress, getRpcServerHealth } from "@clinebot/rpc";
import type { ITelemetryService } from "@clinebot/shared";
import { resolveSessionDataDir } from "@clinebot/shared/storage";
import { nanoid } from "nanoid";
import { SqliteSessionStore } from "../storage/sqlite-session-store";
import type { ToolExecutors } from "../tools";
import { DefaultSessionManager } from "./default-session-manager";
import { FileSessionService } from "./file-session-service";
import { RpcCoreSessionService } from "./rpc-session-service";
import { tryAcquireRpcSpawnLease } from "./rpc-spawn-lease";
import type { SessionManager } from "./session-manager";
import { CoreSessionService } from "./session-service";

const DEFAULT_RPC_ADDRESS =
	process.env.CLINE_RPC_ADDRESS?.trim() || getRpcServerDefaultAddress();

export type SessionBackend =
	| RpcCoreSessionService
	| CoreSessionService
	| FileSessionService;

let cachedBackend: SessionBackend | undefined;
let backendInitPromise: Promise<SessionBackend> | undefined;

export interface CreateSessionHostOptions {
	distinctId?: string;
	sessionService?: SessionBackend;
	backendMode?: "auto" | "rpc" | "local";
	rpcAddress?: string;
	autoStartRpcServer?: boolean;
	rpcConnectAttempts?: number;
	rpcConnectDelayMs?: number;
	defaultToolExecutors?: Partial<ToolExecutors>;
	telemetry?: ITelemetryService;
	toolPolicies?: AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
}

export type SessionHost = SessionManager;

async function reconcileDeadSessionsIfSupported(
	backend: SessionBackend,
): Promise<void> {
	const service = backend as SessionBackend & {
		reconcileDeadSessions?: (limit?: number) => Promise<number>;
	};
	await service.reconcileDeadSessions?.().catch(() => {});
}

function startRpcServerInBackground(address: string): void {
	const lease = tryAcquireRpcSpawnLease(address);
	if (!lease) {
		return;
	}
	const launcher = process.execPath;
	const entryArg = process.argv[1]?.trim();
	if (!entryArg) {
		lease.release();
		return;
	}
	const entry = resolve(process.cwd(), entryArg);
	if (!existsSync(entry)) {
		lease.release();
		return;
	}
	const conditionsArg = process.execArgv.find((arg) =>
		arg.startsWith("--conditions="),
	);
	const args = [
		...(conditionsArg ? [conditionsArg] : []),
		entry,
		"rpc",
		"start",
		"--address",
		address,
	];

	const child = spawn(launcher, args, {
		detached: true,
		stdio: "ignore",
		env: {
			...process.env,
			CLINE_NO_INTERACTIVE: "1",
		},
		cwd: process.cwd(),
	});
	child.unref();
	setTimeout(() => lease.release(), 10_000).unref();
}

async function tryConnectRpcBackend(
	address: string,
): Promise<RpcCoreSessionService | undefined> {
	try {
		const health = await getRpcServerHealth(address);
		if (!health) {
			return undefined;
		}
		return new RpcCoreSessionService({
			address,
			sessionsDir: resolveSessionDataDir(),
		});
	} catch {
		return undefined;
	}
}

function createLocalBackend(): SessionBackend {
	try {
		const store = new SqliteSessionStore();
		store.init();
		return new CoreSessionService(store);
	} catch (error) {
		console.warn(
			"SQLite session persistence unavailable, falling back to file-based session storage.",
			error,
		);
		return new FileSessionService();
	}
}

function resolveHostDistinctId(explicitDistinctId: string | undefined): string {
	if (
		typeof explicitDistinctId === "string" &&
		explicitDistinctId.trim().length > 0
	) {
		return explicitDistinctId.trim();
	}

	const sessionDataDir = resolveSessionDataDir();
	const distinctIdPath = resolve(sessionDataDir, "machine-id");
	try {
		if (existsSync(distinctIdPath)) {
			const savedDistinctId = readFileSync(distinctIdPath, "utf8").trim();
			if (savedDistinctId.length > 0) {
				return savedDistinctId;
			}
		}
	} catch {
		// Ignore read errors and generate a fresh fallback ID.
	}

	const generatedDistinctId = nanoid();
	try {
		mkdirSync(sessionDataDir, { recursive: true });
		writeFileSync(distinctIdPath, generatedDistinctId, "utf8");
	} catch {
		// Ignore write errors and continue with in-memory fallback.
	}
	return generatedDistinctId;
}

export async function resolveSessionBackend(
	options: CreateSessionHostOptions,
): Promise<SessionBackend> {
	if (cachedBackend) {
		return cachedBackend;
	}
	if (backendInitPromise) {
		return await backendInitPromise;
	}

	const mode = options.backendMode ?? "auto";
	const address = options.rpcAddress?.trim() || DEFAULT_RPC_ADDRESS;
	const attempts = Math.max(1, options.rpcConnectAttempts ?? 5);
	const delayMs = Math.max(0, options.rpcConnectDelayMs ?? 100);
	const autoStartRpc = options.autoStartRpcServer !== false;

	backendInitPromise = (async () => {
		if (mode === "local") {
			cachedBackend = createLocalBackend();
			await reconcileDeadSessionsIfSupported(cachedBackend);
			return cachedBackend;
		}

		const existingRpcBackend = await tryConnectRpcBackend(address);
		if (existingRpcBackend) {
			cachedBackend = existingRpcBackend;
			await reconcileDeadSessionsIfSupported(cachedBackend);
			return cachedBackend;
		}

		if (mode === "rpc") {
			throw new Error(`RPC backend unavailable at ${address}`);
		}

		if (autoStartRpc) {
			try {
				startRpcServerInBackground(address);
			} catch {
				// Ignore launch failures and fall back to local backend.
			}

			for (let attempt = 0; attempt < attempts; attempt += 1) {
				const rpcBackend = await tryConnectRpcBackend(address);
				if (rpcBackend) {
					cachedBackend = rpcBackend;
					await reconcileDeadSessionsIfSupported(cachedBackend);
					return cachedBackend;
				}
				if (delayMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, delayMs));
				}
			}
		}

		cachedBackend = createLocalBackend();
		await reconcileDeadSessionsIfSupported(cachedBackend);
		return cachedBackend;
	})().finally(() => {
		backendInitPromise = undefined;
	});

	return await backendInitPromise;
}

export async function createSessionHost(
	options: CreateSessionHostOptions,
): Promise<SessionHost> {
	const distinctId = resolveHostDistinctId(options.distinctId);
	options.telemetry?.setDistinctId(distinctId);
	const backend =
		options.sessionService ?? (await resolveSessionBackend(options));
	return new DefaultSessionManager({
		sessionService: backend,
		defaultToolExecutors: options.defaultToolExecutors,
		telemetry: options.telemetry,
		toolPolicies: options.toolPolicies,
		requestToolApproval: options.requestToolApproval,
		distinctId,
	});
}
