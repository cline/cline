import type { AgentMessage } from "./agent";
import type {
	FactoryFeedbackAnalysis,
	FactoryReplayRequest,
	FactoryVerificationProfile,
	FactoryWorkflowRecipe,
} from "./factory";
import type { FactoryPriority } from "./factory-priority";
import type { GatewayModelSelection, JsonValue } from "./llms/gateway";
import type { ReasoningEffort } from "./llms/reasoning-options";
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
	| "task.archive"
	| "task.restore"
	| "task.delete"
	| "task.run"
	| "task.factory.start"
	| "task.factory.stop"
	| "task.factory.stamp"
	| "task.factory.audit"
	| "task.factory.audit.resolve"
	| "task.factory.answer"
	| "task.factory.design"
	| "task.factory.watch"
	| "task.factory.priority"
	| "task.factory.split.approve"
	| "task.factory.split.keep"
	| "task.factory.parts.cancel"
	| "task.factory.part.start"
	| "task.factory.replay"
	| "task.factory.defaults.get"
	| "task.factory.defaults.set"
	| "task.factory.limits.get"
	| "task.factory.limits.set"
	| "task.factory.stages.get"
	| "task.factory.stages.set"
	| "task.factory.guidance.get"
	| "task.factory.guidance.history"
	| "task.factory.guidance.set"
	| "task.factory.guidance.resolve"
	| "task.factory.verification.get"
	| "task.factory.verification.set"
	| "task.factory.storage.get"
	| "task.factory.storage.clean"
	| "task.factory.reset"
	| "task.factory.projects.get"
	| "task.automation.get"
	| "task.automation.set"
	| "settings.get"
	| "settings.set"
	| "connector.start"
	| "connector.stop"
	| "connector.supervised"
	| "run.enqueue"
	| "run.list"
	| "hub.drain"
	| "hub.status"
	| "stream.replay";

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
	"task.archive",
	"task.restore",
	"task.delete",
	"task.run",
	"task.factory.start",
	"task.factory.stop",
	"task.factory.stamp",
	"task.factory.audit",
	"task.factory.audit.resolve",
	"task.factory.answer",
	"task.factory.design",
	"task.factory.watch",
	"task.factory.priority",
	"task.factory.split.approve",
	"task.factory.split.keep",
	"task.factory.parts.cancel",
	"task.factory.part.start",
	"task.factory.replay",
	"task.factory.defaults.get",
	"task.factory.defaults.set",
	"task.factory.limits.get",
	"task.factory.limits.set",
	"task.factory.stages.get",
	"task.factory.stages.set",
	"task.factory.guidance.get",
	"task.factory.guidance.history",
	"task.factory.guidance.set",
	"task.factory.guidance.resolve",
	"task.factory.verification.get",
	"task.factory.verification.set",
	"task.factory.storage.get",
	"task.factory.storage.clean",
	"task.factory.reset",
	"task.factory.projects.get",
	"task.automation.get",
	"task.automation.set",
	"settings.get",
	"settings.set",
	"connector.start",
	"connector.stop",
	"connector.supervised",
	"run.enqueue",
	"run.list",
	"hub.drain",
	"hub.status",
	"stream.replay",
];

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

export function isHubProtocolCompatible(
	hub: HubProtocolMetadata,
	clientProtocolVersion: HubProtocolVersion = CURRENT_HUB_PROTOCOL_VERSION,
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
	allWorkspaces?: boolean;
	taskId: string;
}

export type HubTaskCreateInput = Omit<AgendaTaskCreateInput, "createdBy"> & {
	allWorkspaces?: boolean;
	/**
	 * Factory cards only: skip the duplicate check (never the exact repeat
	 * match), for when the person says this is different work.
	 */
	allowDuplicate?: boolean;
};

/** The card that already covers a Factory filing the duplicate check blocked. */
export interface HubFactoryDuplicateOf {
	taskId: string;
	/** Short id such as F12. */
	factoryId?: string;
	title: string;
	/** Where the card is, in the board's words (e.g. "Draft PR ready"). */
	state: string;
	pullRequestUrl?: string;
	/** A delivered original: its PR merged, or still open as a draft. */
	outcome?: "merged" | "draft_open";
	/** When the original last changed. */
	at: string;
}

/** A card the duplicate check linked to a newly created one. */
export interface HubFactoryRelatedCard {
	taskId: string;
	factoryId?: string;
	title: string;
}

/**
 * `task.create` reply. `task` is the created card, or the stored one when
 * `existing` is set: an exact repeat, or (with `duplicateOf`, `reason` and
 * `fileAnyway`) a Factory filing the duplicate check matched to an open or
 * recently delivered card; no card was created then. `relatedTo` lists cards
 * linked to a created Factory card.
 */
export interface HubTaskCreateOutput {
	task: AgendaTaskRecord;
	existing?: boolean;
	duplicateOf?: HubFactoryDuplicateOf;
	reason?: string;
	fileAnyway?: string;
	relatedTo?: HubFactoryRelatedCard[];
}
export type HubTaskUpdateInput = Omit<AgendaTaskUpdateInput, "updatedBy"> & {
	allWorkspaces?: boolean;
};

export interface HubTaskRevisionInput extends HubTaskIdInput {
	expectedRevision: number;
}

export interface HubTaskCancelInput extends HubTaskRevisionInput {
	reason?: string;
}

export interface HubTaskAutomationSetInput {
	policy: Omit<AgendaAutomationPolicy, "updatedAt">;
}

/** Sets the default Factory workflow for new work; null clears it. */
export interface HubTaskFactoryDefaultsSetInput {
	workflow: FactoryWorkflowRecipe | null;
}

/**
 * How many Factory cards may be worked at once (scoping and execution
 * together); the rest wait queued. An integer from 1 to 8.
 */
export interface HubTaskFactoryLimits {
	concurrency: number;
	/**
	 * New work is paused: nothing starts scoping, a run or a PR follow-up,
	 * while running work continues. Persisted with the limit. Older Hubs omit it.
	 */
	paused?: boolean;
	/**
	 * Hub-wide limit on Factory model spend per local day, in USD (50 when
	 * never set); `null` when the person chose no daily limit. Once today's
	 * spend reaches it no new scoping or run starts; running work finishes.
	 * Older Hubs omit it.
	 */
	dailyCostUsd?: number | null;
	/**
	 * Factory session cost recorded since local midnight across all cards, in
	 * USD. Sessions still running count what they have reported so far.
	 * Older Hubs omit it.
	 */
	spentTodayUsd?: number;
	/** Today's spend reached `dailyCostUsd`: new work waits for tomorrow or a higher limit. */
	spendingLimitReached?: boolean;
	/**
	 * Factory checks each new filing for an open or recently delivered card
	 * that already covers it (on unless turned off). Older Hubs omit it.
	 */
	duplicateCheck?: boolean;
	/**
	 * Scoping may split large work into parts that a person approves (on
	 * unless turned off). Older Hubs omit it.
	 */
	splitLargeWork?: boolean;
	/**
	 * How often scoping offered a breakdown, proposed one, a person approved
	 * one, and kept a proposed breakdown as one card. Older Hubs omit it.
	 */
	splitCounts?: {
		offered: number;
		proposed: number;
		approved: number;
		kept_whole: number;
	};
}

/**
 * `task.factory.limits.set` input: any of the fields alone, or several.
 * `dailyCostUsd: null` (or `0`) means no daily limit; send 50 to return to
 * the default.
 */
export type HubTaskFactoryLimitsUpdate = {
	concurrency?: number;
	paused?: boolean;
	dailyCostUsd?: number | null;
	duplicateCheck?: boolean;
	splitLargeWork?: boolean;
};

// ---------------------------------------------------------------------------
// Factory settings (task.factory.guidance.*, verification.*, storage.*,
// reset, projects.get): what a person reads and changes in Factory settings.

/** A Factory guidance target: the manager readme, routing, then the roles. */
export type HubFactoryGuidanceRole =
	| "manager"
	| "factory"
	| "designer"
	| "plan_reviewer"
	| "builder"
	| "verifier"
	| "reviewer";
export type HubFactoryGuidanceScope = "user" | "repository";

/**
 * One scope of one guidance target. `none`: no text; `current`: in use;
 * `changed`: changed outside Factory, waiting for Accept or Discard
 * (`acceptedContent` is the version still in use, when history holds it);
 * `invalid`: unusable (`reason`).
 */
export interface HubFactoryGuidanceScopeState {
	status: "none" | "current" | "changed" | "invalid";
	content: string;
	/** The `expectedHash` of an edit, accept or discard (16 hex). */
	hash: string;
	path?: string;
	truncated?: true;
	reason?: string;
	acceptedHash?: string;
	acceptedContent?: string;
}

export interface HubFactoryGuidanceRepositoryState
	extends HubFactoryGuidanceScopeState {
	accepted: boolean;
	/** The role is given this text now. */
	inUse: boolean;
	/** Builder and tester use repository text only once accepted. */
	needsAcceptance: boolean;
}

export interface HubFactoryGuidanceTarget {
	role: HubFactoryGuidanceRole;
	user: HubFactoryGuidanceScopeState;
	/** With a project; never for the manager readme. */
	repository?: HubFactoryGuidanceRepositoryState;
}

export interface HubFactoryGuidanceSettings {
	maxChars: number;
	userScope: boolean;
	managerReadmeDefault: string;
	workspaceRoot?: string;
	targets: HubFactoryGuidanceTarget[];
}

/** Where a guidance change came from; absent for Ask Factory. */
export type HubFactoryGuidanceHistorySource =
	| { kind: "feedback"; taskId: string; factoryNumber?: number }
	| { kind: "settings" };

export interface HubFactoryGuidanceHistoryEntry {
	/** Cursor for the next page's `before`. */
	id: string;
	time: string;
	role: HubFactoryGuidanceRole;
	scope: HubFactoryGuidanceScope;
	workspaceRoot?: string;
	note: string;
	hashBefore: string;
	hashAfter: string;
	before: string;
	after: string;
	source?: HubFactoryGuidanceHistorySource;
}

export interface HubFactoryGuidanceTargetInput {
	role: HubFactoryGuidanceRole;
	scope: HubFactoryGuidanceScope;
	/** Repository scope only: a project Factory knows. */
	workspaceRoot?: string;
	expectedHash: string;
}

export interface HubFactoryVerificationProposal {
	taskId: string;
	title: string;
	factoryNumber?: number;
	hash: string;
	profile: FactoryVerificationProfile;
}

/**
 * A project's test setup. `status`: none, proposed (a file or a card
 * proposes one), in_use, changed (the file differs from the approval;
 * nothing runs until the person decides), invalid (the file is unusable).
 */
export interface HubFactoryVerificationSettings {
	workspaceRoot: string;
	file: "absent" | "present" | "invalid";
	reason?: string;
	status: "none" | "proposed" | "in_use" | "changed" | "invalid";
	profile?: FactoryVerificationProfile;
	/** sha256 of the shown profile: an approval's `expectedHash`. */
	hash?: string;
	origin?: "repository" | "approved_local" | "proposed";
	approved?: {
		profile: FactoryVerificationProfile;
		hash: string;
		provenAt?: string;
	};
	proposedBy?: { taskId: string; title: string; factoryNumber?: number };
	proposals: HubFactoryVerificationProposal[];
}

export interface HubFactoryStorageSummary {
	dataDir: string;
	worktreesDir: string;
	artifactsDir: string;
	logsDir: string;
	worktrees: {
		count: number;
		bytes: number;
		finishedCount: number;
		finishedBytes: number;
		unknownCount: number;
	};
	artifactsBytes: number;
	logsBytes: number;
	approximate: boolean;
	measuredAt: string;
	/** Finished working copies are being removed now. */
	cleaning?: true;
}

/**
 * What "Remove finished copies" did. `running`: removal continues in the
 * Hub past the reply; the counts are what was done so far, and
 * `task.factory.storage.get` reports `cleaning` until it finishes.
 */
export interface HubFactoryStorageCleanResult {
	removed: number;
	bytes: number;
	skipped: Array<{ path: string; reason: string }>;
	storage: HubFactoryStorageSummary;
	running?: true;
}

export type HubFactoryResetWhat =
	| "stage_trust"
	| "verification_trust"
	| "user_guidance"
	| "settings";

export interface HubFactoryResetResult {
	what: HubFactoryResetWhat;
	dryRun: boolean;
	/** stage_trust: decisions forgotten (or that would be). */
	stages?: number;
	/** stage_trust and verification_trust: projects affected. */
	projects?: number;
	/** user_guidance: targets cleared. */
	roles?: HubFactoryGuidanceRole[];
	/** settings: the values restored. */
	concurrency?: number;
	dailyCostUsd?: number;
	duplicateCheck?: boolean;
}

export interface HubFactoryProjectSummary {
	workspaceRoot: string;
	name: string;
	remote?: string;
	defaultBranch?: string;
	cards: { open: number; archived: number };
	stages: {
		file: "absent" | "present" | "invalid";
		total: number;
		inUse: number;
		awaiting: number;
	};
	verification: HubFactoryVerificationSettings["status"];
	guidance: {
		roles: HubFactoryGuidanceRole[];
		changed: HubFactoryGuidanceRole[];
	};
	taskFiles: number;
}

/** The Factory role a session works in, for live activity. */
export type HubFactoryActivityRole =
	| "designer"
	| "plan_reviewer"
	| "builder"
	| "verifier"
	| "reviewer";

/**
 * `task.factory.activity` payload: one tool start of a Factory role session,
 * throttled per session. `input` is a short redacted view (one path, command
 * head or query), never file contents; `summary` is a plain line such as
 * "Reading src/api/routes.ts".
 */
export interface HubFactoryActivityPayload {
	taskId: string;
	/** The card's short id, such as `F42`, when it has one. */
	factoryId?: string;
	sessionId: string;
	role: HubFactoryActivityRole;
	toolName: string;
	input?: { path?: string; command?: string; query?: string };
	summary?: string;
	/** ISO-8601 time of the tool start. */
	at: string;
}

export const FACTORY_CONCURRENCY_MIN = 1;
export const FACTORY_CONCURRENCY_MAX = 8;
export const FACTORY_CONCURRENCY_DEFAULT = 2;

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
	"task.list": AgendaTaskListInput & { allWorkspaces?: boolean };
	"task.get": HubTaskIdInput;
	"task.update": HubTaskUpdateInput;
	"task.approve": HubTaskRevisionInput;
	"task.cancel": HubTaskCancelInput;
	"task.archive": HubTaskRevisionInput;
	"task.restore": HubTaskRevisionInput;
	"task.delete": HubTaskRevisionInput;
	"task.run": HubTaskRevisionInput;
	"task.factory.start": {
		tasks: HubTaskRevisionInput[];
		allWorkspaces?: boolean;
	};
	"task.factory.stop": { allWorkspaces?: boolean };
	"task.factory.stamp": HubTaskIdInput & { expectedHead: string };
	"task.factory.audit": HubTaskIdInput & {
		finding?: string;
		selectionReason?: "manual" | "random";
	};
	/**
	 * The person's decision on the feedback analysis of the card's last run:
	 * `save` writes the proposed rule (exactly the diff whose hash is
	 * `expectedHash`; needs a client trusted across workspaces), `discard`
	 * writes nothing, `retry` re-proposes a stored rule against the current
	 * guidance or, after a failed analysis, runs the analyst once more.
	 */
	"task.factory.audit.resolve": HubTaskIdInput & {
		decision: "save" | "discard" | "retry";
		expectedHash?: string;
	};
	"task.factory.answer": HubTaskIdInput & {
		questionId: string;
		answer: string;
	};
	"task.factory.design": HubTaskIdInput;
	"task.factory.watch": HubTaskRevisionInput & { enabled: boolean };
	/**
	 * A person sets the card's Factory priority (`null` clears it). Allowed in
	 * any status; it never revises the plan or changes approval or status.
	 */
	"task.factory.priority": HubTaskIdInput & {
		priority: FactoryPriority | null;
	};
	/**
	 * A person approves the card's proposed breakdown (its design progress
	 * `split`): the card becomes a completed parent and each kept part its own
	 * card. `omit`: zero-based parts to leave out. Needs a client trusted
	 * across workspaces; nothing approves a breakdown automatically.
	 */
	"task.factory.split.approve": HubTaskRevisionInput & { omit?: number[] };
	/** "Keep as one card": scope the request again, never offering a breakdown. */
	"task.factory.split.keep": HubTaskRevisionInput;
	/**
	 * "Cancel remaining parts" of a parent: each part not yet delivered is
	 * cancelled; delivered parts and their PRs stay. Needs a client trusted
	 * across workspaces.
	 */
	"task.factory.parts.cancel": HubTaskIdInput;
	/**
	 * "Start anyway": a part waiting for earlier parts' merges starts now.
	 * Needs a client trusted across workspaces.
	 */
	"task.factory.part.start": HubTaskRevisionInput;
	"task.factory.replay": FactoryReplayRequest & { allWorkspaces?: boolean };
	"task.factory.defaults.get": Record<string, never>;
	"task.factory.defaults.set": HubTaskFactoryDefaultsSetInput;
	"task.factory.limits.get": Record<string, never>;
	"task.factory.limits.set": HubTaskFactoryLimitsUpdate;
	"task.factory.guidance.get": { workspaceRoot?: string };
	"task.factory.guidance.history": {
		role?: HubFactoryGuidanceRole;
		workspaceRoot?: string;
		/** 1..50, default 20. */
		limit?: number;
		/** The `id` of the previous page's last entry. */
		before?: string;
	};
	/** Needs a client trusted across workspaces. Empty content removes the file. */
	"task.factory.guidance.set": HubFactoryGuidanceTargetInput & {
		content: string;
		note?: string;
	};
	/** Needs a client trusted across workspaces. */
	"task.factory.guidance.resolve": HubFactoryGuidanceTargetInput & {
		decision: "accept" | "discard";
	};
	"task.factory.verification.get": { workspaceRoot: string };
	/**
	 * Needs a client trusted across workspaces. `approve` + `expectedHash`:
	 * the shown file or card proposal; `approve` + `profile`: save a setup
	 * approved on this computer; `remove`: stop using the approval.
	 */
	"task.factory.verification.set": {
		workspaceRoot: string;
		decision: "approve" | "remove";
		expectedHash?: string;
		profile?: FactoryVerificationProfile;
	};
	"task.factory.storage.get": { refresh?: boolean };
	"task.factory.storage.clean": { what: "finished_worktrees" };
	"task.factory.reset": {
		what: HubFactoryResetWhat;
		/** stage_trust and verification_trust only: one project. */
		workspaceRoot?: string;
		/** Count only; change nothing. */
		dryRun?: boolean;
	};
	"task.factory.projects.get": Record<string, never>;
	"task.automation.get": Record<string, never>;
	"task.automation.set": HubTaskAutomationSetInput;
}

/** Typed task command results returned in {@link HubReplyEnvelope.payload}. */
export interface HubCommandOutputMap {
	"session.search": { hits: HubSessionSearchHit[] };
	"task.create": HubTaskCreateOutput;
	"task.list": { tasks: AgendaTaskRecord[] };
	"task.get": { task?: AgendaTaskRecord; runs?: AgendaTaskRunRecord[] };
	"task.update": { task: AgendaTaskRecord };
	"task.approve": { task: AgendaTaskRecord };
	"task.cancel": { task: AgendaTaskRecord };
	"task.archive": { task: AgendaTaskRecord };
	"task.restore": { task: AgendaTaskRecord };
	"task.delete": { taskId: string };
	"task.run": { task: AgendaTaskRecord; run?: AgendaTaskRunRecord };
	"task.factory.start": { queued: number };
	"task.factory.stop": { stopped: boolean };
	"task.factory.stamp": { task: AgendaTaskRecord };
	"task.factory.audit": { task: AgendaTaskRecord };
	"task.factory.audit.resolve": {
		task: AgendaTaskRecord;
		/** The analysis after the decision. */
		analysis?: FactoryFeedbackAnalysis;
	};
	"task.factory.answer": { task: AgendaTaskRecord };
	"task.factory.design": { sessionId: string };
	"task.factory.watch": { task: AgendaTaskRecord };
	"task.factory.priority": { task: AgendaTaskRecord };
	"task.factory.split.approve": {
		task: AgendaTaskRecord;
		parts: AgendaTaskRecord[];
	};
	"task.factory.split.keep": { task: AgendaTaskRecord };
	"task.factory.parts.cancel": {
		task: AgendaTaskRecord;
		cancelled: AgendaTaskRecord[];
	};
	"task.factory.part.start": { task: AgendaTaskRecord };
	"task.factory.replay": { tasks: AgendaTaskRecord[] };
	"task.factory.defaults.get": { workflow?: FactoryWorkflowRecipe };
	"task.factory.defaults.set": { workflow?: FactoryWorkflowRecipe };
	"task.factory.limits.get": HubTaskFactoryLimits;
	"task.factory.limits.set": HubTaskFactoryLimits;
	"task.factory.guidance.get": HubFactoryGuidanceSettings;
	"task.factory.guidance.history": {
		entries: HubFactoryGuidanceHistoryEntry[];
		more: boolean;
	};
	"task.factory.guidance.set": {
		target: HubFactoryGuidanceTarget;
		entry: HubFactoryGuidanceHistoryEntry;
	};
	"task.factory.guidance.resolve": { target: HubFactoryGuidanceTarget };
	"task.factory.verification.get": HubFactoryVerificationSettings;
	"task.factory.verification.set": HubFactoryVerificationSettings;
	"task.factory.storage.get": HubFactoryStorageSummary;
	"task.factory.storage.clean": HubFactoryStorageCleanResult;
	"task.factory.reset": HubFactoryResetResult;
	"task.factory.projects.get": {
		projects: HubFactoryProjectSummary[];
		userGuidanceChanged: HubFactoryGuidanceRole[];
	};
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
	| "task.archive"
	| "task.restore"
	| "task.delete"
	| "task.run"
	| "task.factory.start"
	| "task.factory.stop"
	| "task.factory.stamp"
	| "task.factory.audit"
	| "task.factory.audit.resolve"
	| "task.factory.answer"
	| "task.factory.design"
	| "task.factory.watch"
	| "task.factory.priority"
	| "task.factory.split.approve"
	| "task.factory.split.keep"
	| "task.factory.parts.cancel"
	| "task.factory.part.start"
	| "task.factory.replay"
	| "task.factory.defaults.get"
	| "task.factory.defaults.set"
	| "task.factory.limits.get"
	| "task.factory.limits.set"
	| "task.factory.stages.get"
	| "task.factory.stages.set"
	| "task.factory.guidance.get"
	| "task.factory.guidance.history"
	| "task.factory.guidance.set"
	| "task.factory.guidance.resolve"
	| "task.factory.verification.get"
	| "task.factory.verification.set"
	| "task.factory.storage.get"
	| "task.factory.storage.clean"
	| "task.factory.reset"
	| "task.factory.projects.get"
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
		case "task.factory.stamp":
		case "task.factory.storage.get":
		case "task.factory.storage.clean":
			return 75_000;
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
	| "task.factory.activity"
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
