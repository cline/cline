/**
 * `GatewayPort` — the exact Gateway client surface the broker consumes.
 *
 * The production implementation is `GatewayClient` from
 * `@cline/gateway/client` (it satisfies this interface structurally);
 * tests substitute an in-process fake. The broker NEVER speaks the wire
 * protocol itself — no second protocol stack (ADR 0003).
 */

import type {
	BotRecord,
	GatewayStatusSummary,
	RunRecord,
	SessionRecord,
	SessionSnapshot,
} from "@cline/gateway/client";
import type {
	GatewayEvent,
	GatewayServerRequest,
	RunAccepted,
} from "@cline/shared/gateway";

export interface GatewayHelloInfo {
	readonly gatewayId: string;
	readonly instanceId: string;
	readonly protocolVersion: number;
	readonly clientId: string;
	readonly capabilities: readonly string[];
}

export interface GatewayPort {
	readonly hello: GatewayHelloInfo;
	getStatus(): Promise<GatewayStatusSummary>;
	listBots(): Promise<{ bots: readonly BotRecord[] }>;
	listSessions(input?: {
		botId?: string;
	}): Promise<{ sessions: readonly SessionRecord[] }>;
	listRuns(input?: {
		sessionId?: string;
		runId?: string;
	}): Promise<{ runs: readonly RunRecord[] }>;
	getSession(input: { sessionId: string }): Promise<SessionSnapshot>;
	startRun(input: {
		botId: string;
		prompt: string;
		workspaceRoot?: string;
		idempotencyKey?: string;
	}): Promise<RunAccepted>;
	steerRun(input: {
		runId: string;
		text: string;
		idempotencyKey?: string;
	}): Promise<{ merged: boolean }>;
	interruptRun(input: {
		runId: string;
		reason?: string;
		idempotencyKey?: string;
	}): Promise<{ state: string }>;
	retryRun(input: {
		runId: string;
		reason?: string;
		idempotencyKey?: string;
	}): Promise<RunAccepted>;
	subscribe(params: { cursor?: string }): Promise<unknown>;
	onEvent(listener: (event: GatewayEvent) => void): () => void;
	onServerRequest(
		handler: (request: GatewayServerRequest) => Promise<unknown> | unknown,
	): void;
	onClose(listener: () => void): () => void;
	close(): void;
}

/**
 * How the broker obtains a connected port. The production factory reads
 * the discovery record and dials `GatewayClient.connect`; tests inject
 * fakes. Implementations must throw `GatewayRequestError`-shaped errors
 * (`{ gatewayError: { code, message, retryable } }`) on failure.
 */
export type GatewayPortFactory = (options: {
	/** Resume a previously assigned client identity, when known. */
	clientId?: string;
}) => Promise<GatewayPort>;
