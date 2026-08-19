/**
 * Swappable worker isolation boundary (Gateway RFC, Phase 4).
 *
 * A `WorkerDriver` turns a spawn spec into a live message connection to
 * one worker. Isolation is an execution policy chosen per Gateway, not a
 * bot role: the same bot/engine/protocol contracts run under any driver.
 * V0 ships an in-process driver (tests only) and a macOS sandbox-process
 * driver (Seatbelt via `@anthropic-ai/sandbox-runtime`); the boundary is
 * shaped so Linux bubblewrap / Docker / Podman drivers can be added later
 * without changing bot, engine, or protocol contracts.
 *
 * Security invariants encoded in the spec:
 * - Workers never mount secret files. The spawn spec has no place for
 *   one; secrets stay owner-only 0600 files read by the Gateway.
 * - Credential *use* is injected as scoped network capabilities: an
 *   allowed-domain list plus masked credential env vars whose real values
 *   are substituted by the sandbox proxy on egress only.
 * - Required isolation fails closed when unavailable; the explicit
 *   development-only unsandboxed mode is visible in health/telemetry.
 */

import type { BotId, WorkerId } from "@cline/shared/gateway";
import type {
	SupervisorToWorkerMessage,
	WorkerToSupervisorMessage,
} from "./protocol";

export type WorkerIsolationMode =
	/** No process boundary. Tests only — never a production policy. */
	| "in-process-test"
	/** macOS Seatbelt sandboxed child process. */
	| "sandbox-seatbelt"
	/** Explicit development-only unsandboxed child process. */
	| "unsandboxed-development";

/** A worker's scoped network capability: domains, never credentials. */
export interface WorkerNetworkPolicy {
	readonly allowedDomains: readonly string[];
}

/**
 * A masked credential capability. The worker's environment carries a
 * sentinel value under `envVar`; the sandbox proxy substitutes the real
 * secret on egress to `injectHosts` only. The worker can therefore *use*
 * the credential without ever holding it.
 */
export interface WorkerCredentialCapability {
	readonly envVar: string;
	readonly injectHosts: readonly string[];
}

export interface WorkerSpawnSpec {
	readonly workerId: WorkerId;
	readonly botId: BotId;
	/** Filesystem mounts derived from the bot's fixed workspaces root. */
	readonly mounts: {
		readonly writeRoots: readonly string[];
		readonly readRoots: readonly string[];
	};
	readonly network: WorkerNetworkPolicy;
	readonly credentials?: readonly WorkerCredentialCapability[];
	/**
	 * Extra plain environment variables. MUST NOT contain secrets;
	 * drivers apply an allowlist and the supervisor asserts none of the
	 * configured credential env vars appear here.
	 */
	readonly env?: Readonly<Record<string, string>>;
}

export interface WorkerExitInfo {
	readonly code?: number | null;
	readonly signal?: string | null;
	/** True when the worker died without a clean drain. */
	readonly crashed: boolean;
}

export interface WorkerConnection {
	readonly pid?: number;
	send(message: SupervisorToWorkerMessage): void;
	onMessage(listener: (message: WorkerToSupervisorMessage) => void): () => void;
	onExit(listener: (info: WorkerExitInfo) => void): () => void;
	kill(): void;
}

export interface WorkerDriverAvailability {
	readonly available: boolean;
	readonly reason?: string;
}

export interface WorkerDriver {
	readonly id: string;
	readonly isolation: WorkerIsolationMode;
	availability(): WorkerDriverAvailability;
	spawn(spec: WorkerSpawnSpec): Promise<WorkerConnection>;
}

/** Required isolation fails closed: thrown instead of degrading. */
export class WorkerIsolationUnavailableError extends Error {
	constructor(driverId: string, reason: string) {
		super(
			`Worker isolation "${driverId}" is unavailable and required isolation fails closed: ${reason}`,
		);
		this.name = "WorkerIsolationUnavailableError";
	}
}
