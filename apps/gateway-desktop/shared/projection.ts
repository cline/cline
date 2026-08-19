/**
 * `DesktopProjection` — the replaceable UI read model.
 *
 * The broker derives it from Gateway snapshots plus contiguous durable
 * events and pushes it to the webview over the bridge. Every value in
 * here is UI-safe: opaque IDs only — never storage paths, secrets, env
 * values, or raw diagnostics. The projection is disposable; the broker
 * can rebuild it from the Gateway at any time.
 */

import type { PublicDesktopError } from "./errors";

export type GatewayConnectionState =
	| "connecting"
	| "connected"
	| "reconnecting"
	| "incompatible"
	| "unavailable";

export interface ConnectionProjection {
	state: GatewayConnectionState;
	gatewayId?: string;
	instanceId?: string;
	protocolVersion?: number;
	/** Gateway-reported execution mode ("development" until Phase 4 ships). */
	executionMode?: string;
	/** False until real sandboxing is proven: never claim otherwise. */
	sandboxed?: boolean;
	/** Gateway-reported worker isolation (e.g. "in-process-direct"). */
	isolation?: string;
	/** True when the Gateway reports development (unsandboxed) execution. */
	developmentExecution?: boolean;
	lastError?: PublicDesktopError;
	/** Copyable shell instructions shown when the Gateway is missing. */
	startInstructions?: string;
	/** Reconnect attempt counter (resets on success). */
	reconnectAttempt?: number;
}

export interface BotProjection {
	botId: string;
	name: string;
	role: string;
	status: string;
	isDefaultLead: boolean;
}

export interface ProviderProjection {
	providerId: string;
	modelIds: string[];
}

export type WorkspaceKind = "managed" | "existing";

/**
 * Workspaces are presented as opaque choices. The managed entry asks the
 * Gateway to materialize its own directory; existing entries reuse the
 * immutable workspace of a previous session. Real paths stay in the
 * broker — the webview only ever sees IDs and display labels.
 */
export interface WorkspaceProjection {
	workspaceId: string;
	label: string;
	kind: WorkspaceKind;
	sessionId?: string;
}

export const MANAGED_WORKSPACE_PROJECTION_ID = "workspace-managed";

export interface SessionSummaryProjection {
	sessionId: string;
	botId: string;
	state: string;
	createdAt: number;
	workspaceId: string;
	/** Derived: has queued or running runs. */
	activity: "running" | "queued" | "idle" | "closed";
	lastRunState?: string;
}

export interface MessageProjection {
	id: string;
	role: string;
	/** Flattened text (bounded; `truncated` set when content was cut). */
	text: string;
	truncated?: boolean;
	createdAt: number;
	runId?: string;
}

export interface QueuedTurnProjection {
	runId: string;
	promptPreview: string;
	acceptedAt: number;
}

/** How a run was admitted (Gateway-reported, Phase 6 provenance). */
export interface RunProvenanceProjection {
	mode: string;
	submittedBy?: string;
	scheduleId?: string;
	connectorId?: string;
}

export interface RunProjection {
	runId: string;
	state: string;
	attempt: number;
	acceptedAt: number;
	startedAt?: number;
	endedAt?: number;
	/** Gateway said this run may be manually retried (same runId). */
	retryable: boolean;
	error?: { name: string; message: string };
	outputPreview?: string;
	provenance?: RunProvenanceProjection;
}

export interface ToolProjection {
	toolCallId: string;
	toolName: string;
	state: "running" | "finished" | "error";
}

export interface UsageProjection {
	inputTokens: number;
	outputTokens: number;
	totalCost?: number;
}

export interface StreamingProjection {
	runId: string;
	text: string;
	truncated?: boolean;
}

export interface ActiveSessionProjection {
	sessionId: string;
	botId: string;
	workspaceId: string;
	state: string;
	messages: MessageProjection[];
	queuedTurns: QueuedTurnProjection[];
	currentRun?: RunProjection;
	/** All runs of the session, newest last (for the run history rail). */
	runs: RunProjection[];
	streaming?: StreamingProjection;
	tools: ToolProjection[];
	usage?: UsageProjection;
	outstandingApprovalIds: string[];
}

export interface ApprovalProjection {
	requestId: string;
	method: string;
	botId?: string;
	sessionId?: string;
	runId?: string;
	toolName?: string;
	toolCallId?: string;
	/** Bounded preview of the tool input (never raw payloads). */
	inputPreview?: string;
	receivedAt: number;
}

/** Plugin catalog summary (counts only; never plugin entries). */
export interface PluginCatalogProjection {
	generation: number;
	pluginCount: number;
	heldGenerations: number[];
	pinnedByRuns: number;
	lastReloadOk: boolean;
}

/** Bot-scoped connector (read-only diagnostics; no onboarding UI). */
export interface ConnectorProjection {
	connectorId: string;
	botId: string;
	kind: string;
	name: string;
	status: string;
	/** Whether a credential file is referenced (never the name/value). */
	hasCredential: boolean;
	/** Live worker state when the Gateway reports it. */
	workerState?: string;
	workerRestarts?: number;
}

/** Schedule (read-only diagnostics; automation provenance source). */
export interface ScheduleProjection {
	scheduleId: string;
	botId: string;
	name: string;
	/** "every Nms" or "once at <epoch>". */
	trigger: string;
	enabled: boolean;
	nextDueAt?: number;
	lastJobState?: string;
	lastRunId?: string;
}

/** Thin usage readout from `statistics.summary` (no Statistics page). */
export interface UsageSummaryProjection {
	from: string;
	to: string;
	tokens: number;
	inputTokens: number;
	outputTokens: number;
	messages: number;
	modelCalls: number;
	estimatedCost: number;
	activeModels: number;
}

export interface DiagnosticsProjection {
	/** Bounded, redacted, user-presentable notices (newest last). */
	notices: string[];
	lastEventSequence: number;
	eventsApplied: number;
	/** True when the native shell can reveal the diagnostics folder. */
	revealAvailable: boolean;
	/** Phase 4 plugin catalog summary from gateway.status. */
	plugins?: PluginCatalogProjection;
	/** Durable catalog generation from gateway.status/hello. */
	catalogGeneration?: number;
	/** Phase 3 usage pipeline readout (aggregates only). */
	usage?: UsageSummaryProjection;
}

export interface DesktopProjection {
	/** Monotonic; bumps on every change. Patches are revision-fenced. */
	revision: number;
	generatedAt: number;
	connection: ConnectionProjection;
	bots: BotProjection[];
	selectedBotId?: string;
	providers: ProviderProjection[];
	selectedProviderId?: string;
	selectedModelId?: string;
	workspaces: WorkspaceProjection[];
	selectedWorkspaceId?: string;
	sessions: SessionSummaryProjection[];
	selectedSessionId?: string;
	activeSession?: ActiveSessionProjection;
	approvals: ApprovalProjection[];
	/** Bot-scoped connectors (Phase 6, read-only). */
	connectors: ConnectorProjection[];
	/** Schedules (Phase 6, read-only). */
	schedules: ScheduleProjection[];
	diagnostics: DiagnosticsProjection;
}

/** Per-message flattened-text bound inside the projection. */
export const MAX_PROJECTION_MESSAGE_CHARS = 64 * 1024;
/** Live streaming buffer bound. */
export const MAX_STREAMING_CHARS = 128 * 1024;
/** Bounded diagnostics notice list. */
export const MAX_DIAGNOSTIC_NOTICES = 50;
/** Preview bounds (queued turns, tool inputs, run output). */
export const MAX_PREVIEW_CHARS = 280;

export const GATEWAY_START_INSTRUCTIONS = [
	"# Start the Cline Gateway, then press Reconnect:",
	"cline-gateway start",
	"",
	"# Or run it in the foreground:",
	"cline-gateway serve",
].join("\n");

export function createInitialProjection(): DesktopProjection {
	return {
		revision: 0,
		generatedAt: 0,
		connection: { state: "connecting" },
		bots: [],
		providers: [],
		workspaces: [
			{
				workspaceId: MANAGED_WORKSPACE_PROJECTION_ID,
				label: "Chat",
				kind: "managed",
			},
		],
		sessions: [],
		approvals: [],
		connectors: [],
		schedules: [],
		diagnostics: {
			notices: [],
			lastEventSequence: -1,
			eventsApplied: 0,
			revealAvailable: false,
		},
	};
}

export function truncateForProjection(
	text: string,
	maxChars: number,
): { text: string; truncated: boolean } {
	if (text.length <= maxChars) {
		return { text, truncated: false };
	}
	return { text: `${text.slice(0, maxChars)}…`, truncated: true };
}
