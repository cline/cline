import type { ReasoningEffort } from "./agents/types";
import type {
	AgentMessage,
	GatewayModelSelection,
	JsonValue,
} from "./llms/gateway";

export type HubProtocolVersion = "v1";

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

export interface HubScheduleCreateInput {
	name: string;
	cronPattern: string;
	prompt: string;
	workspaceRoot: string;
	cwd?: string;
	modelSelection?: GatewayModelSelection;
	enabled?: boolean;
	mode?: "act" | "plan" | "yolo";
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
	prompt?: string;
	workspaceRoot?: string;
	cwd?: string;
	modelSelection?: GatewayModelSelection;
	enabled?: boolean;
	mode?: "act" | "plan" | "yolo";
	systemPrompt?: string | null;
	maxIterations?: number | null;
	timeoutSeconds?: number | null;
	maxParallel?: number;
	createdBy?: string | null;
	tags?: string[];
	runtimeOptions?: HubSessionRuntimeOptions;
	metadata?: Record<string, JsonValue | undefined>;
}

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
	| "session.create"
	| "session.attach"
	| "session.detach"
	| "session.get"
	| "session.delete"
	| "session.update"
	| "session.fork"
	| "session.hook"
	| "run.start"
	| "session.send_input"
	| "run.abort"
	| "approval.request"
	| "approval.respond"
	| "capability.request"
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
	| "schedule.upcoming";

export interface HubCommandEnvelope {
	version: HubProtocolVersion;
	command: HubCommandName;
	requestId?: string;
	clientId?: string;
	sessionId?: string;
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
	| "run.started"
	| "run.aborted"
	| "run.completed"
	| "assistant.delta"
	| "reasoning.delta"
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
	| "schedule.execution_failed";

export interface HubEventEnvelope {
	version: HubProtocolVersion;
	event: HubEventName;
	eventId?: string;
	sessionId?: string;
	clientId?: string;
	sourceHubId?: string;
	timestamp?: number;
	payload?: Record<string, unknown>;
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

export interface HubSessionRuntimeOptions {
	mode?: "act" | "plan" | "yolo";
	systemPrompt?: string;
	maxIterations?: number;
	thinking?: boolean;
	reasoningEffort?: ReasoningEffort;
	checkpointEnabled?: boolean;
	enableTools?: boolean;
	enableSpawn?: boolean;
	enableTeams?: boolean;
	autoApproveTools?: boolean;
	toolExecutors?: HubToolExecutorName[];
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
	| { kind: "stream.subscribe"; clientId: string; sessionId?: string }
	| { kind: "stream.unsubscribe"; clientId: string; sessionId?: string }
	| { kind: "event"; envelope: HubEventEnvelope };
