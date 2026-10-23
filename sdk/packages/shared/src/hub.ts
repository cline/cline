import type { AgentMessage } from "./agent";
import type { GatewayModelSelection, JsonValue } from "./llms/gateway";
import type { ReasoningEffort } from "./llms/reasoning-options";
import type { ToolPolicy } from "./llms/tools";
import type { RuntimeConfigExtensionKind } from "./session/runtime-config";
import type {
	AgendaAutomationPolicy,
	AgendaTaskCreateInput,
	AgendaTaskListInput,
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	AgendaTaskUpdateInput,
} from "./tasks";

export type HubProtocolVersion = "v1";

export const CURRENT_HUB_PROTOCOL_VERSION: HubProtocolVersion = "v1";
export const MIN_CLIENT_HUB_PROTOCOL_VERSION: HubProtocolVersion = "v1";
export const MAX_CLIENT_HUB_PROTOCOL_VERSION: HubProtocolVersion = "v1";

export type HubCapabilityName =
	| "client.register"
	| "client.list"
	| "session.create"
	| "session.list"
	| "session.get"
	| "session.run"
	| "session.abort"
	| "schedule.create"
	| "schedule.list"
	| "task.create"
	| "task.list"
	| "task.get"
	| "task.update"
	| "task.approve"
	| "task.cancel"
	| "task.run"
	| "task.automation.get"
	| "task.automation.set"
	| "settings.get"
	| "settings.set"
	| "approval.list_pending"
	| "connector.start"
	| "connector.stop"
	| "connector.supervised"
	| "run.enqueue"
	| "run.list"
	| "hub.drain"
	| "hub.status"
	| "stream.replay";

/**
 * The single list of commands a hub advertises. Both advertisement points read
 * it — the `client.register` reply and the `/version` endpoint — because two
 * hand-maintained lists drifted: `/version` omitted `approval.list_pending`
 * while the register reply contained nothing else, so `hasCapability` answered
 * "no" for baseline commands the hub had always supported.
 *
 * Extend this when a new optional command lands, and nowhere else.
 */
export const HUB_CAPABILITIES: readonly HubCapabilityName[] = [
	"client.register",
	"client.list",
	"session.create",
	"session.list",
	"session.get",
	"session.run",
	"session.abort",
	"schedule.create",
	"schedule.list",
	"task.create",
	"task.list",
	"task.get",
	"task.update",
	"task.approve",
	"task.cancel",
	"task.run",
	"task.automation.get",
	"task.automation.set",
	"settings.get",
	"settings.set",
	"approval.list_pending",
	"connector.start",
	"connector.stop",
	"connector.supervised",
	"run.enqueue",
	"run.list",
	"hub.drain",
	"hub.status",
	"stream.replay",
];

/**
 * Protocol version assumed for a client that sends none in `client.register`.
 *
 * Clients predating the handshake are still accepted, but not by skipping the
 * compatibility check: they are pinned to the oldest protocol the hub knows and
 * range-checked like everybody else. That keeps the legacy allowance bounded — a
 * future hub that drops `v1` support refuses them with `incompatible_protocol`
 * instead of silently accepting a client it cannot talk to.
 */
export const LEGACY_HUB_PROTOCOL_VERSION: HubProtocolVersion = "v1";

export interface HubProtocolMetadata {
	protocolVersion: string;
	minClientProtocolVersion?: string;
	maxClientProtocolVersion?: string;
	capabilities?: readonly string[];
}

export type HubCompatibilityResult =
	| { compatible: true }
	| { compatible: false; reason: "missing_protocol" | "unsupported_protocol" };

function parseHubProtocolNumber(
	version: string | undefined,
): number | undefined {
	const match = /^v(\d+)$/.exec(version?.trim() ?? "");
	if (!match) {
		return undefined;
	}
	return Number.parseInt(match[1] ?? "", 10);
}

/**
 * `clientProtocolVersion` is a plain string because it also arrives off the wire
 * (`client.register`), where a future or malformed client can send anything;
 * unparsable values are reported as `missing_protocol`.
 */
export function isHubProtocolCompatible(
	hub: HubProtocolMetadata,
	clientProtocolVersion: string = CURRENT_HUB_PROTOCOL_VERSION,
): HubCompatibilityResult {
	const hubProtocol = parseHubProtocolNumber(hub.protocolVersion);
	const clientProtocol = parseHubProtocolNumber(clientProtocolVersion);
	if (hubProtocol === undefined || clientProtocol === undefined) {
		return { compatible: false, reason: "missing_protocol" };
	}
	const minClientProtocol =
		parseHubProtocolNumber(hub.minClientProtocolVersion) ?? hubProtocol;
	const maxClientProtocol =
		parseHubProtocolNumber(hub.maxClientProtocolVersion) ?? hubProtocol;
	return clientProtocol >= minClientProtocol &&
		clientProtocol <= maxClientProtocol
		? { compatible: true }
		: { compatible: false, reason: "unsupported_protocol" };
}

/**
 * Error code returned by `client.register` when the client advertised a protocol
 * version outside the hub's supported client range. Not retryable: the client
 * has to be upgraded (or downgraded), so clients must not reconnect-loop on it.
 */
export const HUB_INCOMPATIBLE_PROTOCOL_ERROR_CODE = "incompatible_protocol";

/**
 * `error.details` of an `incompatible_protocol` reply. Every field is optional
 * because it is parsed from the wire; the hub always populates all four. Declared
 * as a type (not an interface) so it stays assignable to the envelope's
 * `Record<string, unknown>` details slot without a cast.
 */
export type HubIncompatibleProtocolDetails = {
	serverProtocolVersion?: string;
	minClientProtocolVersion?: string;
	maxClientProtocolVersion?: string;
	/** Version the client advertised. Absent means the hub could not read one. */
	clientProtocolVersion?: string;
};

/**
 * Reply payload of `client.register`. `protocol` and `capabilities` were added
 * after `clientId`, so a client talking to an older hub sees them absent and
 * must treat that as "no handshake information" rather than an error — read it
 * as `Partial<HubClientRegisterResult>`.
 */
export interface HubClientRegisterResult {
	clientId: string;
	protocol: HubProtocolMetadata;
	/** Commands this hub build answers beyond the v1 baseline. */
	capabilities: string[];
}

export type HubActorKind = "client" | "peerHub";

export type HubTransportKind =
	| "native"
	| "browser"
	| "remote"
	| "native-grpc"
	| "browser-ws"
	| "browser-grpc-web"
	| "peer-grpc";

export type HubRuntimeStatus =
	| "idle"
	| "running"
	| "pending"
	| "completed"
	| "aborted"
	| "failed";

export type HubSpokeStatus =
	| "starting"
	| "ready"
	| "busy"
	| "stopping"
	| "stopped"
	| "failed";

export interface ClientCapability {
	name: string;
	description?: string;
	scopes?: string[];
	payloadSchema?: Record<string, unknown>;
}

/** Client capability advertised by a live user surface that can answer tool approvals. */
export const HUB_CLIENT_TOOL_APPROVAL_CAPABILITY = "approval.respond";

export interface HubClientRegistration {
	clientId?: string;
	clientType: string;
	displayName?: string;
	actorKind?: HubActorKind;
	transport: HubTransportKind;
	capabilities?: ClientCapability[];
	metadata?: Record<string, JsonValue | undefined>;
	workspaceContext?: {
		workspaceRoot?: string;
		cwd?: string;
	};
	protocolVersion?: HubProtocolVersion;
}

export interface HubClientRecord {
	clientId: string;
	clientType: string;
	displayName?: string;
	actorKind: HubActorKind;
	connectedAt: number;
	lastSeenAt: number;
	transport: HubTransportKind;
	capabilities: ClientCapability[];
	metadata?: Record<string, JsonValue | undefined>;
	workspaceContext?: {
		workspaceRoot?: string;
		cwd?: string;
	};
}

export interface SessionParticipant {
	clientId: string;
	attachedAt: number;
	role?: "creator" | "participant" | "observer";
	metadata?: Record<string, JsonValue | undefined>;
}

export interface SessionMetrics {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	totalCost?: number;
}

export interface HubTeamMembership {
	teamId: string;
	role?: "lead" | "teammate" | "contractor";
}

export interface HubSessionRuntimeSnapshot {
	runId?: string;
	status?: HubRuntimeStatus;
	iteration?: number;
	messages?: AgentMessage[];
	pendingToolCalls?: unknown[];
	usage?: SessionMetrics;
	aggregateUsage?: SessionMetrics;
	lastError?: string;
}

export interface SessionRecord {
	sessionId: string;
	workspaceRoot: string;
	cwd?: string;
	createdAt: number;
	updatedAt: number;
	createdByClientId: string;
	assignedSpokeId?: string;
	status: HubRuntimeStatus;
	/**
	 * Clients currently observing or attached to this session. Participants do not
	 * own client-local capabilities; capability routing is owned by the client that
	 * created/restored the runtime session and advertised those capabilities.
	 */
	participants: SessionParticipant[];
	activeRunId?: string;
	/**
	 * Provider/model the session is configured to run with. Typed here (they have
	 * always also traveled in `metadata`) so clients need not dig through an
	 * untyped blob to render the current model. Updated by
	 * `session.update_connection`, announced via `session.updated`.
	 */
	provider?: string;
	model?: string;
	runtimeOptions?: HubSessionRuntimeOptions;
	metadata?: Record<string, JsonValue | undefined>;
	runtimeSession?: {
		agentId: string;
		agentRole?: string;
		team?: HubTeamMembership;
	};
	usage?: SessionMetrics;
	aggregateUsage?: SessionMetrics;
}

export interface HubSessionSnapshot {
	sessionId: string;
	agentId: string;
	agentRole?: string;
	workspacePath: string;
	rootPath?: string;
	createdAt: number;
	updatedAt: number;
	messages: AgentMessage[];
	runCount: number;
	lastRunId?: string;
	status: HubRuntimeStatus;
	metadata?: Record<string, unknown>;
	team?: HubTeamMembership;
	runtime?: HubSessionRuntimeSnapshot;
}

export interface SpokeRecord {
	spokeId: string;
	kind: "subprocess";
	status: HubSpokeStatus;
	workspaceRoots: string[];
	sessionIds: string[];
	startedAt: number;
	lastSeenAt: number;
	metadata?: Record<string, JsonValue | undefined>;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface ApprovalRequestRecord {
	approvalId: string;
	sessionId: string;
	requestedByClientId: string;
	targetClientId?: string;
	status: ApprovalStatus;
	requestedAt: number;
	resolvedAt?: number;
	payload: Record<string, JsonValue | undefined>;
	response?: {
		approved: boolean;
		respondedByClientId: string;
		payload?: Record<string, JsonValue | undefined>;
	};
}

export type CapabilityRequestStatus =
	| "pending"
	| "resolved"
	| "rejected"
	| "cancelled";

export interface CapabilityRequestRecord {
	requestId: string;
	sessionId: string;
	requestedByClientId: string;
	targetClientId?: string;
	capabilityName: string;
	status: CapabilityRequestStatus;
	requestedAt: number;
	resolvedAt?: number;
	payload?: Record<string, JsonValue | undefined>;
	response?: {
		ok: boolean;
		respondedByClientId: string;
		payload?: Record<string, JsonValue | undefined>;
		error?: string;
	};
}

export interface PeerHubRecord {
	peerHubId: string;
	status: "connecting" | "ready" | "disconnected" | "failed";
	connectedAt: number;
	lastSeenAt: number;
	transport: Extract<HubTransportKind, "peer-grpc" | "remote" | "native">;
	metadata?: Record<string, JsonValue | undefined>;
}

export interface ScheduleRecord {
	scheduleId: string;
	name: string;
	cronPattern: string;
	timezone?: string;
	prompt: string;
	workspaceRoot: string;
	cwd?: string;
	modelSelection?: GatewayModelSelection;
	enabled: boolean;
	mode?: "act" | "plan" | "yolo";
	systemPrompt?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	maxParallel?: number;
	createdAt: number;
	updatedAt: number;
	nextRunAt?: number;
	lastRunAt?: number;
	createdBy?: string;
	tags?: string[];
	runtimeOptions?: HubSessionRuntimeOptions;
	metadata?: Record<string, JsonValue | undefined>;
}

export type ScheduleExecutionStatus =
	| "pending"
	| "running"
	| "success"
	| "completed"
	| "failed"
	| "timeout"
	| "aborted";

export interface ScheduleExecutionRecord {
	executionId: string;
	scheduleId: string;
	sessionId?: string;
	triggeredAt: number;
	startedAt?: number;
	endedAt?: number;
	status: ScheduleExecutionStatus;
	exitCode?: number;
	errorMessage?: string;
	iterations?: number;
	tokensUsed?: number;
	costUsd?: number;
}

export const ONE_TIME_SCHEDULE_CRON_PATTERN = "0";
export const ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY = "__hubScheduleRunAt";

export const HUB_SCHEDULE_MODES = ["act", "plan", "yolo"] as const;
export type HubScheduleMode = (typeof HUB_SCHEDULE_MODES)[number];

export function isHubScheduleMode(value: unknown): value is HubScheduleMode {
	return HUB_SCHEDULE_MODES.some((mode) => mode === value);
}

export function readHubScheduleMode(
	payload: Record<string, unknown> | undefined,
	defaultWhenAbsent: HubScheduleMode,
): HubScheduleMode;
export function readHubScheduleMode(
	payload: Record<string, unknown> | undefined,
): HubScheduleMode | undefined;
export function readHubScheduleMode(
	payload: Record<string, unknown> | undefined,
	defaultWhenAbsent?: HubScheduleMode,
): HubScheduleMode | undefined {
	if (!payload || !Object.hasOwn(payload, "mode")) {
		return defaultWhenAbsent;
	}
	const mode = payload.mode;
	if (isHubScheduleMode(mode)) {
		return mode;
	}
	throw new Error(`mode must be one of: ${HUB_SCHEDULE_MODES.join(", ")}`);
}

export interface HubScheduleCreateInput {
	name: string;
	cronPattern: string;
	timezone?: string;
	prompt: string;
	workspaceRoot: string;
	cwd?: string;
	modelSelection?: GatewayModelSelection;
	enabled?: boolean;
	mode?: HubScheduleMode;
	systemPrompt?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	maxParallel?: number;
	createdBy?: string;
	tags?: string[];
	runtimeOptions?: HubSessionRuntimeOptions;
	metadata?: Record<string, JsonValue | undefined>;
}

export interface HubScheduleUpdateInput {
	scheduleId: string;
	name?: string;
	cronPattern?: string;
	timezone?: string | null;
	prompt?: string;
	workspaceRoot?: string;
	cwd?: string;
	modelSelection?: GatewayModelSelection;
	enabled?: boolean;
	mode?: HubScheduleMode;
	systemPrompt?: string | null;
	maxIterations?: number | null;
	timeoutSeconds?: number | null;
	maxParallel?: number;
	createdBy?: string | null;
	tags?: string[];
	runtimeOptions?: HubSessionRuntimeOptions;
	metadata?: Record<string, JsonValue | undefined>;
}

export interface HubTaskIdInput {
	taskId: string;
}

export type HubTaskCreateInput = Omit<AgendaTaskCreateInput, "createdBy">;
export type HubTaskUpdateInput = Omit<AgendaTaskUpdateInput, "updatedBy">;

export interface HubTaskRevisionInput extends HubTaskIdInput {
	expectedRevision: number;
}

export interface HubTaskCancelInput extends HubTaskRevisionInput {
	reason?: string;
}

export interface HubTaskAutomationSetInput {
	policy: Omit<AgendaAutomationPolicy, "updatedAt">;
}

export interface HubSessionSearchInput {
	query: string;
	limit?: number;
	workspaceRoot?: string;
}

export interface HubSessionSearchHit {
	sessionId: string;
	documentId: string;
	ordinal: number;
	role: string;
	startedAt: string;
	workspaceRoot: string;
	title: string;
	snippet: string;
	score: number;
}

/**
 * Strongly typed task command payloads. This map is intentionally extensible so
 * other Hub command families can adopt typed payloads without changing the wire
 * envelope.
 */
export interface HubCommandInputMap {
	"session.search": HubSessionSearchInput;
	"task.create": HubTaskCreateInput;
	"task.list": AgendaTaskListInput;
	"task.get": HubTaskIdInput;
	"task.update": HubTaskUpdateInput;
	"task.approve": HubTaskRevisionInput;
	"task.cancel": HubTaskCancelInput;
	"task.run": HubTaskRevisionInput;
	"task.automation.get": Record<string, never>;
	"task.automation.set": HubTaskAutomationSetInput;
}

/** Typed task command results returned in {@link HubReplyEnvelope.payload}. */
export interface HubCommandOutputMap {
	"session.search": { hits: HubSessionSearchHit[] };
	"task.create": { task: AgendaTaskRecord };
	"task.list": { tasks: AgendaTaskRecord[] };
	"task.get": { task?: AgendaTaskRecord };
	"task.update": { task: AgendaTaskRecord };
	"task.approve": { task: AgendaTaskRecord };
	"task.cancel": { task: AgendaTaskRecord };
	"task.run": { task: AgendaTaskRecord; run?: AgendaTaskRunRecord };
	"task.automation.get": { policy: AgendaAutomationPolicy };
	"task.automation.set": { policy: AgendaAutomationPolicy };
}

export type HubTypedCommandName = keyof HubCommandInputMap & HubCommandName;
export type HubCommandInput<TCommand extends HubTypedCommandName> =
	HubCommandInputMap[TCommand];
export type HubCommandOutput<TCommand extends HubTypedCommandName> =
	HubCommandOutputMap[TCommand];

export type HubCommandName =
	| "client.register"
	| "client.update"
	| "client.unregister"
	| "client.list"
	| "cline.account.get_current"
	| "prompt_commands.list"
	| "prompt_commands.execute"
	| "mention_files.search"
	| "catalog.list"
	| "session.list"
	| "session.search"
	| "session.create"
	| "session.attach"
	| "session.detach"
	| "session.get"
	| "session.messages"
	| "session.restore"
	| "session.delete"
	| "session.update"
	| "session.update_connection"
	| "session.compaction.get"
	| "session.compaction.update"
	| "session.pending_prompts"
	| "session.steer_first_pending_prompt"
	| "session.update_pending_prompt"
	| "session.remove_pending_prompt"
	| "session.fork"
	| "session.hook"
	| "run.start"
	| "session.send_input"
	| "run.enqueue"
	| "run.list"
	| "run.abort"
	| "run.proceed_while_running"
	| "hub.drain"
	| "hub.status"
	| "approval.request"
	| "approval.respond"
	| "approval.list_pending"
	| "capability.request"
	| "capability.progress"
	| "capability.respond"
	| "peer.register"
	| "peer.list_sessions"
	| "peer.attach_session"
	| "peer.detach_session"
	| "peer.proxy_command"
	| "schedule.create"
	| "schedule.list"
	| "schedule.get"
	| "schedule.update"
	| "schedule.delete"
	| "schedule.enable"
	| "schedule.disable"
	| "schedule.trigger"
	| "schedule.list_executions"
	| "schedule.stats"
	| "schedule.active"
	| "schedule.upcoming"
	| "task.create"
	| "task.list"
	| "task.get"
	| "task.update"
	| "task.approve"
	| "task.cancel"
	| "task.run"
	| "task.automation.get"
	| "task.automation.set"
	| "settings.list"
	| "settings.get"
	| "settings.patch"
	| "settings.toggle"
	| "connector.channels"
	| "connector.configure"
	| "connector.delete_config"
	| "connector.start"
	| "connector.stop"
	| "connector.supervised"
	| "cron.event.ingest"
	| "cron.event.list"
	| "cron.event.get"
	| "ui.notify"
	| "ui.show_window";

export const HUB_DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const HUB_COMMAND_SLOW_LOG_MS = 5_000;

export function getDefaultHubCommandTimeoutMs(
	command: HubCommandName,
): number | null {
	switch (command) {
		case "run.start":
		case "session.send_input":
			return null;
		default:
			return HUB_DEFAULT_COMMAND_TIMEOUT_MS;
	}
}

export function resolveHubCommandTimeoutMs(
	command: HubCommandName,
	timeoutMs?: number | null,
): number | null {
	return timeoutMs === undefined
		? getDefaultHubCommandTimeoutMs(command)
		: timeoutMs;
}

export interface HubCommandEnvelope {
	version: HubProtocolVersion;
	command: HubCommandName;
	requestId?: string;
	clientId?: string;
	sessionId?: string;
	timeoutMs?: number | null;
	payload?: Record<string, unknown>;
}

export interface HubReplyEnvelope {
	version: HubProtocolVersion;
	requestId?: string;
	ok: boolean;
	payload?: Record<string, unknown>;
	error?: {
		code: string;
		message: string;
		details?: Record<string, unknown>;
	};
}

export type HubEventName =
	| "hub.client.registered"
	| "hub.client.disconnected"
	| "session.created"
	| "session.updated"
	| "session.attached"
	| "session.detached"
	| "session.forked"
	| "session.pending_prompts"
	| "session.pending_prompt_submitted"
	| "run.started"
	| "run.heartbeat"
	| "run.aborted"
	| "run.completed"
	| "run.failed"
	| "run.enqueued"
	| "run.interrupted"
	| "hub.drain_changed"
	| "iteration.started"
	| "iteration.finished"
	| "assistant.delta"
	| "assistant.media"
	| "assistant.finished"
	| "session.notice"
	| "reasoning.delta"
	| "reasoning.finished"
	| "agent.done"
	| "usage.updated"
	| "tool.started"
	| "tool.updated"
	| "tool.finished"
	| "approval.requested"
	| "approval.resolved"
	| "capability.requested"
	| "capability.resolved"
	| "team.progress"
	| "artifact.created"
	| "diff.created"
	| "spoke.started"
	| "spoke.failed"
	| "spoke.stopped"
	| "peer.registered"
	| "peer.session_attached"
	| "peer.session_detached"
	| "schedule.created"
	| "schedule.updated"
	| "schedule.deleted"
	| "schedule.triggered"
	| "schedule.execution_completed"
	| "schedule.execution_failed"
	| "task.created"
	| "task.updated"
	| "task.deleted"
	| "task.run.started"
	| "task.run.completed"
	| "task.run.failed"
	| "task.automation.updated"
	| "settings.changed"
	| "ui.notify"
	| "ui.show_window"
	| "hub.client.updated";

export interface HubEventEnvelope {
	version: HubProtocolVersion;
	event: HubEventName;
	eventId?: string;
	/**
	 * Monotonic global sequence assigned by the Hub's durable event log.
	 * A client can resume delivery exactly where it left off by passing the
	 * last observed sequence as `sinceSequence` on `stream.subscribe`.
	 * Absent on hubs (or events) without a durable log.
	 */
	sequence?: number;
	sessionId?: string;
	clientId?: string;
	sourceHubId?: string;
	timestamp?: number;
	payload?: Record<string, unknown>;
}

export interface HubCapabilityRequestedPayload {
	requestId: string;
	targetClientId: string;
	capabilityName: string;
	payload?: Record<string, unknown>;
}

export interface HubCapabilityResolvedPayload {
	requestId: string;
	targetClientId: string;
	respondedByClientId?: string;
	capabilityName: string;
	ok: boolean;
	cancelled?: boolean;
	payload?: Record<string, unknown>;
	error?: string;
}

export type HubToolExecutorName =
	| "readFile"
	| "search"
	| "bash"
	| "webFetch"
	| "editor"
	| "applyPatch"
	| "skills"
	| "askQuestion"
	| "submit";

export const HUB_TOOL_EXECUTOR_NAMES = [
	"readFile",
	"search",
	"bash",
	"webFetch",
	"editor",
	"applyPatch",
	"skills",
	"askQuestion",
	"submit",
] as const satisfies readonly HubToolExecutorName[];

const HUB_TOOL_EXECUTOR_NAME_SET = new Set<string>(HUB_TOOL_EXECUTOR_NAMES);

export function isHubToolExecutorName(
	value: unknown,
): value is HubToolExecutorName {
	return typeof value === "string" && HUB_TOOL_EXECUTOR_NAME_SET.has(value);
}

export const HUB_TOOL_EXECUTOR_CAPABILITY_PREFIX = "tool_executor.";
export const HUB_CUSTOM_TOOL_CAPABILITY_PREFIX = "custom_tool.";
export const HUB_HOOK_CAPABILITY_PREFIX = "hook.";
export const HUB_COMPACTION_CAPABILITY = "compaction.compact";
export const HUB_CHECKPOINT_CAPABILITY = "checkpoint.create";
export const HUB_MISTAKE_LIMIT_CAPABILITY = "mistake_limit.decide";
export const HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY =
	"user_instructions.snapshot";

export type HubClientContributionKind =
	| "toolExecutor"
	| "tool"
	| "hook"
	| "compaction"
	| "checkpoint"
	| "mistakeLimit"
	| "userInstructionService";

export interface HubClientContributionBase {
	kind: HubClientContributionKind;
	capabilityName: string;
}

export interface HubClientToolExecutorContribution
	extends HubClientContributionBase {
	kind: "toolExecutor";
	executor: HubToolExecutorName;
}

export interface HubClientToolContribution extends HubClientContributionBase {
	kind: "tool";
	name: string;
	description: string;
	inputSchema: Record<string, JsonValue | undefined>;
	lifecycle?: Record<string, JsonValue | undefined>;
}

export interface HubClientHookContribution extends HubClientContributionBase {
	kind: "hook";
	name: string;
}

export interface HubClientCompactionContribution
	extends HubClientContributionBase {
	kind: "compaction";
	config?: Record<string, JsonValue | undefined>;
}

export interface HubClientCheckpointContribution
	extends HubClientContributionBase {
	kind: "checkpoint";
	config?: Record<string, JsonValue | undefined>;
}

export interface HubClientMistakeLimitContribution
	extends HubClientContributionBase {
	kind: "mistakeLimit";
}

export interface HubClientUserInstructionServiceContribution
	extends HubClientContributionBase {
	kind: "userInstructionService";
}

export type HubClientContribution =
	| HubClientToolExecutorContribution
	| HubClientToolContribution
	| HubClientHookContribution
	| HubClientCompactionContribution
	| HubClientCheckpointContribution
	| HubClientMistakeLimitContribution
	| HubClientUserInstructionServiceContribution;

export interface HubSessionRuntimeOptions {
	mode?: "act" | "plan" | "yolo";
	systemPrompt?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	thinking?: boolean;
	reasoningEffort?: ReasoningEffort;
	thinkingBudgetTokens?: number;
	checkpointEnabled?: boolean;
	enableTools?: boolean;
	enableSpawn?: boolean;
	enableTeams?: boolean;
	autoApproveTools?: boolean;
	configExtensions?: RuntimeConfigExtensionKind[];
	clientContributions?: HubClientContribution[];
}

export interface HubSessionCreateInput {
	workspaceRoot: string;
	cwd?: string;
	sessionConfig?: Record<string, JsonValue | undefined>;
	metadata?: Record<string, JsonValue | undefined>;
	toolPolicies?: Record<string, JsonValue | undefined>;
	initialMessages?: AgentMessage[];
	agentId?: string;
	agentRole?: string;
	team?: HubTeamMembership;
	modelSelection?: GatewayModelSelection;
	runtimeOptions?: HubSessionRuntimeOptions;
}

export interface HubModelCatalogProvider {
	id: string;
	name: string;
	enabled: boolean;
	defaultModelId?: string;
}

export interface HubModelCatalogModel {
	id: string;
	name?: string;
	supportsThinking?: boolean;
}

export interface HubModelCatalog {
	providers: HubModelCatalogProvider[];
	modelsByProvider: Record<string, HubModelCatalogModel[]>;
	defaultSelection?: GatewayModelSelection;
	defaultWorkspaceRoot?: string;
}

export interface HubSessionAttachInput {
	sessionId: string;
	metadata?: Record<string, JsonValue | undefined>;
	role?: SessionParticipant["role"];
}

export interface HubSessionUpdateInput {
	sessionId: string;
	metadata?: Record<string, JsonValue | undefined>;
}

export interface HubSessionDeleteInput {
	sessionId: string;
	deleteCheckpointRefs?: boolean;
}

export interface HubRunStartInput {
	sessionId: string;
	input?: string | AgentMessage | AgentMessage[];
}

export interface HubApprovalRequestInput {
	sessionId: string;
	targetClientId?: string;
	payload: Record<string, JsonValue | undefined>;
}

export interface HubApprovalRespondInput {
	approvalId: string;
	approved: boolean;
	payload?: Record<string, JsonValue | undefined>;
}

/**
 * Error code returned by `approval.respond` when the approval id is not
 * pending: it was already answered, cancelled, or never existed. Callers should
 * treat all three the same way — drop the approval from their UI.
 */
export const HUB_APPROVAL_ALREADY_RESOLVED_ERROR_CODE = "already_resolved";

/**
 * Error code returned when the calling client has no relationship to the
 * session a command targets — it neither created the session nor attached to it.
 * Used by `approval.respond`; clients should treat it as "not yours", not as a
 * transient failure to retry.
 *
 * A client that legitimately needs access asks for it explicitly with
 * `session.attach`; there is no implicit grant for untracked sessions.
 */
export const HUB_NOT_AUTHORIZED_ERROR_CODE = "not_authorized";

/**
 * Error code returned when a command names a `clientId` other than the one its
 * connection registered. The hub binds a connection to the identity it
 * registered with, so naming somebody else's id is refused instead of dispatched
 * — a client cannot act as another client by relabelling its envelopes.
 *
 * Not retryable: reconnect and register as yourself. Omitting `clientId`
 * entirely is always safe, since the hub then fills in the bound identity.
 */
export const HUB_CLIENT_ID_MISMATCH_ERROR_CODE = "client_id_mismatch";

/**
 * Error code returned when an identity-bound command (approvals, session
 * attach/detach) arrives on a connection that has not completed
 * `client.register`. Authorization for those commands is derived from the
 * connection's registered identity, so there is nothing to check against yet.
 *
 * Fixed by registering first; every `HubClient` does that before its first
 * command.
 */
export const HUB_NOT_REGISTERED_ERROR_CODE = "not_registered";

/**
 * Error code returned when `client.register` names a `clientId` that another
 * *live* connection already holds. A hub identity is single-occupancy: two
 * sockets sharing one id would share its session participation, so the second
 * one could answer the first one's approvals and, on disconnect, unregister it.
 *
 * Retryable only in the sense that the incumbent may go away: the hub hands the
 * id over as soon as the previous socket is closed or has failed its heartbeat,
 * which is what makes an ordinary reconnect (same id, new socket, after a drop)
 * succeed. A client that gets this code while its own previous socket is still
 * healthy is either racing itself or impersonating somebody.
 */
export const HUB_CLIENT_ID_IN_USE_ERROR_CODE = "client_id_in_use";

/**
 * Error code returned when a frame's `kind` is recognized but its shape is not
 * usable — e.g. a `command` frame with no `envelope`, or an envelope with no
 * `command` name. Sent only when the frame carried a `requestId` to reply to;
 * otherwise the frame is dropped with a log line, since there is no request to
 * answer.
 */
export const HUB_INVALID_FRAME_ERROR_CODE = "invalid_frame";

/**
 * `reason` carried by the `approval.resolved` event and the tool result when a
 * pending approval expired before anyone answered it.
 */
export const HUB_APPROVAL_TIMEOUT_REASON = "approval_timeout";

/**
 * Default lifetime of a pending tool approval. A hub that waits forever leaks a
 * parked run (and its promise) per abandoned approval, so unanswered approvals
 * auto-deny at this age unless the hub server overrides it.
 */
export const DEFAULT_HUB_APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Largest single websocket frame either side of the hub protocol will accept.
 *
 * Both ends enforce it: the client drops an oversized inbound frame, and the hub
 * server passes it to `ws` as `maxPayload` so an oversized *inbound* frame is
 * refused at the transport instead of being buffered. `ws` defaults to 100 MiB,
 * which on an authenticated-but-hostile connection is a cheap way to make the
 * hub allocate two orders of magnitude more memory than any real frame needs.
 *
 * Sized for the largest thing the protocol legitimately carries: a session
 * snapshot with a full transcript.
 */
export const HUB_MAX_FRAME_BYTES = 8 * 1024 * 1024;

/**
 * A tool approval the hub is still waiting on.
 *
 * This is the payload of the `approval.requested` event and the element type of
 * the `approval.list_pending` reply, so a client that connected after the event
 * was published (a mobile app opened from a push notification, a reconnecting
 * UI) can recover the same information and respond to it.
 *
 * Pending approvals are in-memory only: after a hub restart
 * `approval.list_pending` reports an empty list rather than an error.
 */
export interface PendingApprovalInfo {
	/** Stable id to pass back to `approval.respond`. */
	approvalId: string;
	sessionId: string;
	agentId: string;
	conversationId: string;
	iteration: number;
	toolCallId: string;
	toolName: string;
	/** Tool input serialized as JSON (`"null"` when there was no input). */
	inputJson: string;
	policy: ToolPolicy;
	/** Agenda task that owns the session, when this approval came from one. */
	agendaTaskId?: string;
	/** Epoch ms when the hub started waiting for a response. */
	createdAt: number;
	/**
	 * Epoch ms after which the hub auto-denies the approval with reason
	 * {@link HUB_APPROVAL_TIMEOUT_REASON}. Always set by hubs that implement
	 * approval expiry; absent from older hubs, which wait indefinitely.
	 */
	expiresAt?: number;
}

/**
 * Payload of `approval.list_pending`. Omit `sessionId` to list every pending
 * approval the calling client is authorized to see — the hub scopes the reply to
 * sessions the client created or attached to, so omitting it is not a way to
 * observe another client's approvals.
 */
export interface HubApprovalListPendingInput {
	sessionId?: string;
}

/** Reply payload of `approval.list_pending`, oldest approval first. */
export interface HubApprovalListPendingResult {
	approvals: PendingApprovalInfo[];
}

export interface HubCapabilityRequestInput {
	sessionId: string;
	capabilityName: string;
	targetClientId?: string;
	payload?: Record<string, JsonValue | undefined>;
}

export interface HubCapabilityRespondInput {
	requestId: string;
	ok: boolean;
	payload?: Record<string, JsonValue | undefined>;
	error?: string;
}

export interface HubPeerRegisterInput {
	peerHubId?: string;
	transport?: Extract<HubTransportKind, "peer-grpc" | "remote" | "native">;
	metadata?: Record<string, JsonValue | undefined>;
}

export interface HubPeerAttachSessionInput {
	peerHubId: string;
	sessionId: string;
}

export interface HubStateSnapshot {
	hubId: string;
	protocolVersion: HubProtocolVersion;
	sessions: SessionRecord[];
	spokes: SpokeRecord[];
	approvals: ApprovalRequestRecord[];
	capabilityRequests: CapabilityRequestRecord[];
	peers: PeerHubRecord[];
	schedules?: ScheduleRecord[];
	scheduleExecutions?: ScheduleExecutionRecord[];
}

export type HubTransportFrame =
	| { kind: "command"; envelope: HubCommandEnvelope }
	| { kind: "reply"; envelope: HubReplyEnvelope }
	| {
			kind: "stream.subscribe";
			clientId: string;
			sessionId?: string;
			/**
			 * Replay cursor: when set, the Hub first replays durable events with
			 * `sequence > sinceSequence` (scoped to `sessionId` when given), then
			 * live-tails. Omit for live-only delivery (legacy behavior).
			 */
			sinceSequence?: number;
	  }
	| { kind: "stream.unsubscribe"; clientId: string; sessionId?: string }
	| { kind: "event"; envelope: HubEventEnvelope };

export interface HubUINotifyPayload {
	title: string;
	body: string;
	severity?: "info" | "warning" | "error";
	sessionId?: string;
	clientId?: string;
}

export interface HubUIShowWindowPayload {
	windowId?: string;
	focus?: boolean;
}

/**
 * Human phrase for the live work an outdated Hub is serving, used by the
 * "Hub update required" surfaces in the CLI and the desktop app - the two
 * must read identically, which is why the copy lives here. Falls back to an
 * unquantified phrase when the Hub could not answer the activity query.
 */
export function describeOutdatedHubSessions(counts: {
	activeSessionCount?: number;
	participantClientCount?: number;
}): string {
	const sessions = counts.activeSessionCount;
	if (typeof sessions !== "number" || sessions <= 0) {
		return "active sessions from other Cline clients";
	}
	const sessionsPhrase = `${sessions} active session${sessions === 1 ? "" : "s"}`;
	const clients = counts.participantClientCount;
	if (typeof clients !== "number" || clients <= 0) {
		return sessionsPhrase;
	}
	return `${sessionsPhrase} from ${clients} connected Cline client${clients === 1 ? "" : "s"}`;
}
