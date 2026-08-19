/**
 * DesktopProjection reducer.
 *
 * Hydrates from Gateway snapshots and applies ONLY contiguous durable
 * events on top. A sequence gap stops application (the broker must
 * rehydrate); duplicates are skipped. Gateway events are treated as
 * untrusted input: every payload read is structural, message text is
 * flattened and bounded, and workspace paths are mapped to opaque IDs
 * that never enter the projection.
 */

import type {
	BotRecord,
	ConnectorRecord,
	RunRecord,
	ScheduleJobRecord,
	ScheduleRecord,
	SessionRecord,
	SessionSnapshot,
} from "@cline/gateway/client";
import type { GatewayEvent, GatewayServerRequest } from "@cline/shared/gateway";
import type {
	ActiveSessionProjection,
	ApprovalProjection,
	BotProjection,
	ConnectionProjection,
	ConnectorProjection,
	DesktopProjection,
	MessageProjection,
	RunProjection,
	RunProvenanceProjection,
	ScheduleProjection,
	SessionSummaryProjection,
	WorkspaceProjection,
} from "../../shared/projection";
import {
	createInitialProjection,
	GATEWAY_START_INSTRUCTIONS,
	MANAGED_WORKSPACE_PROJECTION_ID,
	MAX_DIAGNOSTIC_NOTICES,
	MAX_PREVIEW_CHARS,
	MAX_PROJECTION_MESSAGE_CHARS,
	MAX_STREAMING_CHARS,
	truncateForProjection,
} from "../../shared/projection";

/** Bound the conversation so bridge frames stay within limits. */
const MAX_PROJECTION_MESSAGES = 200;

export type ProjectionKey = keyof DesktopProjection;

export interface ReducerContext {
	projection: DesktopProjection;
	/** Last applied global event sequence; -1 before any hydration. */
	cursorSequence: number;
	/** Broker-side only: opaque workspace id <-> real path (never leaks). */
	workspacePathById: Map<string, string>;
	workspaceIdByPath: Map<string, string>;
	/** Prompts of runs this client started (queued-turn previews). */
	promptPreviews: Map<string, string>;
	/** Provenance learned from events before the run entry existed. */
	provenanceHints: Map<string, RunProvenanceProjection>;
	/** Top-level projection keys touched since the last flush. */
	dirtyKeys: Set<ProjectionKey>;
	clock: () => number;
}

export function createReducerContext(
	clock: () => number = () => Date.now(),
): ReducerContext {
	return {
		projection: createInitialProjection(),
		cursorSequence: -1,
		workspacePathById: new Map(),
		workspaceIdByPath: new Map(),
		promptPreviews: new Map(),
		provenanceHints: new Map(),
		dirtyKeys: new Set(),
		clock,
	};
}

function commit(context: ReducerContext, ...keys: ProjectionKey[]): void {
	context.projection.revision += 1;
	context.projection.generatedAt = context.clock();
	for (const key of keys) {
		context.dirtyKeys.add(key);
	}
	context.dirtyKeys.add("revision");
	context.dirtyKeys.add("generatedAt");
}

/** Consume the dirty-key set (bridge patch computation). */
export function takeDirtyKeys(context: ReducerContext): ProjectionKey[] {
	const keys = [...context.dirtyKeys];
	context.dirtyKeys.clear();
	return keys;
}

export function addNotice(context: ReducerContext, notice: string): void {
	const notices = context.projection.diagnostics.notices;
	notices.push(notice);
	if (notices.length > MAX_DIAGNOSTIC_NOTICES) {
		notices.splice(0, notices.length - MAX_DIAGNOSTIC_NOTICES);
	}
	commit(context, "diagnostics");
}

export function setConnection(
	context: ReducerContext,
	connection: Partial<ConnectionProjection> & {
		state: ConnectionProjection["state"];
	},
): void {
	const previous = context.projection.connection;
	context.projection.connection = {
		...(connection.state === previous.state ? previous : {}),
		...connection,
		...(connection.state === "unavailable"
			? { startInstructions: GATEWAY_START_INSTRUCTIONS }
			: {}),
	};
	commit(context, "connection");
}

// -----------------------------------------------------------------------------
// Workspace identity (paths stay broker-side)
// -----------------------------------------------------------------------------

function hashPath(path: string): string {
	let hash = 5381;
	for (let index = 0; index < path.length; index += 1) {
		hash = ((hash << 5) + hash + path.charCodeAt(index)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

export function workspaceIdForPath(
	context: ReducerContext,
	rootPath: string,
): string {
	const existing = context.workspaceIdByPath.get(rootPath);
	if (existing) {
		return existing;
	}
	const workspaceId = `workspace-${hashPath(rootPath)}`;
	context.workspaceIdByPath.set(rootPath, workspaceId);
	context.workspacePathById.set(workspaceId, rootPath);
	return workspaceId;
}

function rebuildWorkspaces(
	context: ReducerContext,
	sessions: readonly SessionRecord[],
): void {
	const workspaces: WorkspaceProjection[] = [
		{
			workspaceId: MANAGED_WORKSPACE_PROJECTION_ID,
			label: "Managed workspace (Gateway-owned)",
			kind: "managed",
		},
	];
	for (const session of sessions) {
		const workspaceId = workspaceIdForPath(context, session.workspace.rootPath);
		if (workspaces.some((entry) => entry.workspaceId === workspaceId)) {
			continue;
		}
		workspaces.push({
			workspaceId,
			label: `Workspace of session ${session.sessionId.slice(0, 12)}…`,
			kind: "existing",
			sessionId: session.sessionId,
		});
	}
	context.projection.workspaces = workspaces;
	if (
		!context.projection.selectedWorkspaceId ||
		!workspaces.some(
			(entry) => entry.workspaceId === context.projection.selectedWorkspaceId,
		)
	) {
		context.projection.selectedWorkspaceId = MANAGED_WORKSPACE_PROJECTION_ID;
	}
	commit(context, "workspaces", "selectedWorkspaceId");
}

// -----------------------------------------------------------------------------
// Snapshot hydration
// -----------------------------------------------------------------------------

function toBotProjection(
	record: BotRecord,
	defaultBotId?: string,
): BotProjection {
	return {
		botId: record.identity.botId,
		name: record.identity.name,
		role: record.identity.role,
		status: record.status,
		isDefaultLead: record.identity.botId === defaultBotId,
	};
}

/** Structural read of the Gateway-reported run provenance (untrusted). */
export function provenanceProjectionFrom(
	value: unknown,
): RunProvenanceProjection | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const typed = value as {
		mode?: unknown;
		submittedBy?: unknown;
		scheduleId?: unknown;
		connectorId?: unknown;
	};
	if (typeof typed.mode !== "string") {
		return undefined;
	}
	return {
		mode: typed.mode,
		...(typeof typed.submittedBy === "string"
			? { submittedBy: typed.submittedBy }
			: {}),
		...(typeof typed.scheduleId === "string"
			? { scheduleId: typed.scheduleId }
			: {}),
		...(typeof typed.connectorId === "string"
			? { connectorId: typed.connectorId }
			: {}),
	};
}

function runProjectionFrom(
	record: RunRecord & { provenance?: unknown },
	attempt: number,
): RunProjection {
	const retryable = record.state === "failed" || record.state === "interrupted";
	const output = record.outputText
		? truncateForProjection(record.outputText, MAX_PREVIEW_CHARS)
		: undefined;
	const provenance = provenanceProjectionFrom(record.provenance);
	return {
		runId: record.runId,
		state: record.state,
		attempt: Math.max(1, attempt),
		acceptedAt: record.acceptedAt,
		...(record.startedAt !== undefined ? { startedAt: record.startedAt } : {}),
		...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
		retryable,
		...(record.error ? { error: { ...record.error } } : {}),
		...(output ? { outputPreview: output.text } : {}),
		...(provenance ? { provenance } : {}),
	};
}

function sessionActivity(
	state: string,
	runs: readonly { state: string }[],
): SessionSummaryProjection["activity"] {
	if (state === "closed") {
		return "closed";
	}
	if (runs.some((run) => run.state === "running")) {
		return "running";
	}
	if (runs.some((run) => run.state === "queued")) {
		return "queued";
	}
	return "idle";
}

/** Flatten AgentMessage content into UI-safe bounded text. */
export function flattenMessageText(message: unknown): {
	text: string;
	truncated: boolean;
} {
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) {
		return { text: "", truncated: false };
	}
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part !== "object" || part === null) {
			continue;
		}
		const typed = part as {
			type?: unknown;
			text?: unknown;
			toolName?: unknown;
		};
		if (typed.type === "text" && typeof typed.text === "string") {
			parts.push(typed.text);
		} else if (typed.type === "reasoning" && typeof typed.text === "string") {
			parts.push(`(reasoning) ${typed.text}`);
		} else if (
			typed.type === "tool-call" &&
			typeof typed.toolName === "string"
		) {
			parts.push(`[tool call: ${typed.toolName}]`);
		} else if (
			typed.type === "tool-result" &&
			typeof typed.toolName === "string"
		) {
			parts.push(`[tool result: ${typed.toolName}]`);
		}
	}
	return truncateForProjection(parts.join("\n"), MAX_PROJECTION_MESSAGE_CHARS);
}

function messageProjectionFrom(
	message: unknown,
	runId: string | undefined,
): MessageProjection | undefined {
	const typed = message as {
		id?: unknown;
		role?: unknown;
		createdAt?: unknown;
	};
	if (typeof typed.id !== "string" || typeof typed.role !== "string") {
		return undefined;
	}
	const { text, truncated } = flattenMessageText(message);
	return {
		id: typed.id,
		role: typed.role,
		text,
		...(truncated ? { truncated: true } : {}),
		createdAt: typeof typed.createdAt === "number" ? typed.createdAt : 0,
		...(runId ? { runId } : {}),
	};
}

function boundMessages(messages: MessageProjection[]): MessageProjection[] {
	return messages.length > MAX_PROJECTION_MESSAGES
		? messages.slice(messages.length - MAX_PROJECTION_MESSAGES)
		: messages;
}

export interface HydrationInput {
	hello: {
		gatewayId: string;
		instanceId: string;
		protocolVersion: number;
	};
	status: {
		executionMode?: unknown;
		sandboxed?: unknown;
		defaultBotId?: unknown;
		catalogGeneration?: unknown;
		execution?: unknown;
		plugins?: unknown;
		connectorHealth?: unknown;
		counts?: { lastEventSequence?: unknown };
	};
	bots: readonly BotRecord[];
	sessions: readonly SessionRecord[];
	/** Queued + running runs across sessions (activity derivation). */
	pendingRuns: readonly RunRecord[];
	/** Bot-scoped connectors (Phase 6 diagnostics). */
	connectors?: readonly ConnectorRecord[];
	/** Usage aggregates readout (Phase 3 statistics pipeline). */
	usageSummary?: unknown;
	/** Schedules plus their most recent job reports (Phase 6). */
	schedules?: readonly ScheduleRecord[];
	scheduleJobs?: ReadonlyMap<string, readonly ScheduleJobRecord[]>;
	/** Snapshot of the selected session, when one is selected. */
	snapshot?: SessionSnapshot;
	/**
	 * Cursor basis for the subscription that follows this hydration.
	 * Taken BEFORE the list reads so replay can only overlap, never gap.
	 */
	cursorBasis: number;
}

/** Structural read of `gateway.status.execution` (untrusted). */
function executionHealthFrom(value: unknown): {
	isolation?: string;
	development?: boolean;
} {
	if (typeof value !== "object" || value === null) {
		return {};
	}
	const typed = value as { isolation?: unknown; development?: unknown };
	return {
		...(typeof typed.isolation === "string"
			? { isolation: typed.isolation }
			: {}),
		...(typeof typed.development === "boolean"
			? { development: typed.development }
			: {}),
	};
}

/** Structural read of `gateway.status.plugins` (untrusted). */
function pluginSummaryFrom(
	value: unknown,
): DesktopProjection["diagnostics"]["plugins"] {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const typed = value as {
		generation?: unknown;
		plugins?: unknown;
		heldGenerations?: unknown;
		pinnedByRuns?: unknown;
		lastReloadOk?: unknown;
	};
	if (typeof typed.generation !== "number") {
		return undefined;
	}
	return {
		generation: typed.generation,
		pluginCount: typeof typed.plugins === "number" ? typed.plugins : 0,
		heldGenerations: Array.isArray(typed.heldGenerations)
			? typed.heldGenerations.filter(
					(entry): entry is number => typeof entry === "number",
				)
			: [],
		pinnedByRuns:
			typeof typed.pinnedByRuns === "number" ? typed.pinnedByRuns : 0,
		lastReloadOk: typed.lastReloadOk !== false,
	};
}

function connectorWorkerStates(
	value: unknown,
): Map<string, { state: string; restarts: number }> {
	const byId = new Map<string, { state: string; restarts: number }>();
	if (typeof value !== "object" || value === null) {
		return byId;
	}
	const running = (value as { running?: unknown }).running;
	if (!Array.isArray(running)) {
		return byId;
	}
	for (const entry of running) {
		const typed = entry as {
			connectorId?: unknown;
			state?: unknown;
			restarts?: unknown;
		};
		if (typeof typed.connectorId === "string") {
			byId.set(typed.connectorId, {
				state: typeof typed.state === "string" ? typed.state : "unknown",
				restarts: typeof typed.restarts === "number" ? typed.restarts : 0,
			});
		}
	}
	return byId;
}

/** Structural read of a `statistics.summary` result (untrusted). */
function usageSummaryFrom(
	value: unknown,
): DesktopProjection["diagnostics"]["usage"] {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const typed = value as {
		from?: unknown;
		to?: unknown;
		totals?: unknown;
		activeModels?: unknown;
	};
	if (
		typeof typed.from !== "string" ||
		typeof typed.to !== "string" ||
		typeof typed.totals !== "object" ||
		typed.totals === null
	) {
		return undefined;
	}
	const totals = typed.totals as Record<string, unknown>;
	const numberOf = (key: string) =>
		typeof totals[key] === "number" ? (totals[key] as number) : 0;
	return {
		from: typed.from,
		to: typed.to,
		tokens: numberOf("tokens"),
		inputTokens: numberOf("inputTokens"),
		outputTokens: numberOf("outputTokens"),
		messages: numberOf("messages"),
		modelCalls: numberOf("modelCalls"),
		estimatedCost: numberOf("estimatedCost"),
		activeModels: Array.isArray(typed.activeModels)
			? typed.activeModels.length
			: 0,
	};
}

function scheduleTrigger(record: ScheduleRecord): string {
	if (record.intervalMs !== undefined) {
		return `every ${record.intervalMs}ms`;
	}
	if (record.at !== undefined) {
		return `once at ${new Date(record.at).toISOString()}`;
	}
	return "unknown trigger";
}

/** Rebuild the projection wholesale from Gateway state. */
export function hydrate(context: ReducerContext, input: HydrationInput): void {
	const projection = context.projection;
	const defaultBotId =
		typeof input.status.defaultBotId === "string"
			? input.status.defaultBotId
			: undefined;

	const execution = executionHealthFrom(input.status.execution);
	projection.connection = {
		state: "connected",
		gatewayId: input.hello.gatewayId,
		instanceId: input.hello.instanceId,
		protocolVersion: input.hello.protocolVersion,
		executionMode:
			typeof input.status.executionMode === "string"
				? input.status.executionMode
				: "development",
		sandboxed: input.status.sandboxed === true,
		...(execution.isolation ? { isolation: execution.isolation } : {}),
		// Absent execution health means development until proven otherwise.
		developmentExecution: execution.development !== false,
	};

	projection.bots = input.bots.map((record) =>
		toBotProjection(record, defaultBotId),
	);
	if (
		!projection.selectedBotId ||
		!projection.bots.some((bot) => bot.botId === projection.selectedBotId)
	) {
		projection.selectedBotId =
			defaultBotId ?? projection.bots[0]?.botId ?? undefined;
	}

	rebuildWorkspaces(context, input.sessions);

	const pendingBySession = new Map<string, RunRecord[]>();
	for (const run of input.pendingRuns) {
		const list = pendingBySession.get(run.sessionId) ?? [];
		list.push(run);
		pendingBySession.set(run.sessionId, list);
	}
	projection.sessions = input.sessions.map(
		(session): SessionSummaryProjection => ({
			sessionId: session.sessionId,
			botId: session.botId,
			state: session.state,
			createdAt: session.createdAt,
			workspaceId: workspaceIdForPath(context, session.workspace.rootPath),
			activity: sessionActivity(
				session.state,
				pendingBySession.get(session.sessionId) ?? [],
			),
		}),
	);
	if (
		projection.selectedSessionId &&
		!projection.sessions.some(
			(session) => session.sessionId === projection.selectedSessionId,
		)
	) {
		projection.selectedSessionId = undefined;
	}

	// Phase 6 read-only diagnostics: connectors and schedules.
	const workerStates = connectorWorkerStates(input.status.connectorHealth);
	projection.connectors = (input.connectors ?? []).map(
		(record): ConnectorProjection => {
			const worker = workerStates.get(record.connectorId);
			return {
				connectorId: record.connectorId,
				botId: record.botId,
				kind: record.kind,
				name: record.name,
				status: record.status,
				hasCredential: Boolean(record.credentialRef),
				...(worker
					? { workerState: worker.state, workerRestarts: worker.restarts }
					: {}),
			};
		},
	);
	projection.schedules = (input.schedules ?? []).map(
		(record): ScheduleProjection => {
			const jobs = input.scheduleJobs?.get(record.scheduleId) ?? [];
			const lastJob = jobs.at(-1);
			return {
				scheduleId: record.scheduleId,
				botId: record.botId,
				name: record.name,
				trigger: scheduleTrigger(record),
				enabled: record.enabled,
				...(record.nextDueAt !== undefined
					? { nextDueAt: record.nextDueAt }
					: {}),
				...(lastJob ? { lastJobState: lastJob.state } : {}),
				...(lastJob?.runId ? { lastRunId: lastJob.runId } : {}),
			};
		},
	);

	if (input.snapshot) {
		applySnapshot(context, input.snapshot);
	} else if (!projection.selectedSessionId) {
		projection.activeSession = undefined;
	}

	projection.diagnostics.lastEventSequence = input.cursorBasis;
	projection.diagnostics.plugins = pluginSummaryFrom(input.status.plugins);
	if (typeof input.status.catalogGeneration === "number") {
		projection.diagnostics.catalogGeneration = input.status.catalogGeneration;
	}
	const usage = usageSummaryFrom(input.usageSummary);
	if (usage) {
		projection.diagnostics.usage = usage;
	}
	context.cursorSequence = input.cursorBasis;
	commit(
		context,
		"connection",
		"bots",
		"selectedBotId",
		"sessions",
		"selectedSessionId",
		"activeSession",
		"connectors",
		"schedules",
		"diagnostics",
	);
}

/** Install one session snapshot as the active session projection. */
export function applySnapshot(
	context: ReducerContext,
	snapshot: SessionSnapshot,
): void {
	const projection = context.projection;
	const runs = snapshot.runs.map((run) =>
		runProjectionFrom(run, run.attempts.length),
	);
	const messages: MessageProjection[] = [];
	for (const stored of snapshot.messages) {
		const message = messageProjectionFrom(stored.message, stored.runId);
		if (message) {
			messages.push(message);
		}
	}
	const currentRun =
		runs.find((run) => run.state === "running") ??
		runs.filter((run) => run.state === "queued")[0] ??
		runs.at(-1);
	const tools: ActiveSessionProjection["tools"] = [];
	for (const stored of snapshot.messages) {
		const content = (stored.message as { content?: unknown }).content;
		if (!Array.isArray(content)) {
			continue;
		}
		for (const part of content) {
			const typed = part as {
				type?: unknown;
				toolCallId?: unknown;
				toolName?: unknown;
				isError?: unknown;
			};
			if (
				typed.type === "tool-call" &&
				typeof typed.toolCallId === "string" &&
				typeof typed.toolName === "string"
			) {
				tools.push({
					toolCallId: typed.toolCallId,
					toolName: typed.toolName,
					state: "running",
				});
			}
			if (
				typed.type === "tool-result" &&
				typeof typed.toolCallId === "string"
			) {
				const tool = tools.find(
					(entry) => entry.toolCallId === typed.toolCallId,
				);
				if (tool) {
					tool.state = typed.isError === true ? "error" : "finished";
				}
			}
		}
	}
	projection.activeSession = {
		sessionId: snapshot.session.sessionId,
		botId: snapshot.session.botId,
		workspaceId: workspaceIdForPath(
			context,
			snapshot.session.workspace.rootPath,
		),
		state: snapshot.session.state,
		messages: boundMessages(messages),
		queuedTurns: snapshot.runs
			.filter((run) => run.state === "queued")
			.map((run) => ({
				runId: run.runId,
				promptPreview: truncateForProjection(run.input, MAX_PREVIEW_CHARS).text,
				acceptedAt: run.acceptedAt,
			})),
		...(currentRun ? { currentRun } : {}),
		runs,
		tools,
		outstandingApprovalIds: projection.approvals
			.filter((approval) => approval.sessionId === snapshot.session.sessionId)
			.map((approval) => approval.requestId),
	};
	projection.selectedSessionId = snapshot.session.sessionId;
	commit(context, "activeSession", "selectedSessionId");
}

// -----------------------------------------------------------------------------
// Event application (contiguous only)
// -----------------------------------------------------------------------------

export type ApplyResult =
	| { outcome: "applied" }
	| { outcome: "duplicate" }
	| { outcome: "gap" };

export function applyGatewayEvent(
	context: ReducerContext,
	event: GatewayEvent,
): ApplyResult {
	if (context.cursorSequence >= 0 && event.sequence <= context.cursorSequence) {
		return { outcome: "duplicate" };
	}
	if (
		context.cursorSequence >= 0 &&
		event.sequence !== context.cursorSequence + 1
	) {
		// Contiguity broken: STOP. The broker must rehydrate from
		// snapshots; applying past a gap would corrupt the read model.
		return { outcome: "gap" };
	}
	context.cursorSequence = event.sequence;
	context.projection.diagnostics.lastEventSequence = event.sequence;
	context.projection.diagnostics.eventsApplied += 1;
	applyEventBody(context, event);
	commit(context, "diagnostics");
	return { outcome: "applied" };
}

function payloadOf(event: GatewayEvent): Record<string, unknown> {
	return (event.payload ?? {}) as Record<string, unknown>;
}

function activeSessionFor(
	context: ReducerContext,
	event: GatewayEvent,
): ActiveSessionProjection | undefined {
	const active = context.projection.activeSession;
	if (!active || !event.scope.sessionId) {
		return undefined;
	}
	return active.sessionId === event.scope.sessionId ? active : undefined;
}

function upsertSessionSummary(
	context: ReducerContext,
	sessionId: string,
	botId: string | undefined,
	update: Partial<SessionSummaryProjection>,
): void {
	const sessions = context.projection.sessions;
	const existing = sessions.find((session) => session.sessionId === sessionId);
	if (existing) {
		Object.assign(existing, update);
	} else {
		sessions.push({
			sessionId,
			botId: botId ?? "",
			state: "active",
			createdAt: context.clock(),
			workspaceId: MANAGED_WORKSPACE_PROJECTION_ID,
			activity: "idle",
			...update,
		});
	}
	commit(context, "sessions");
}

function applyRunStateEvent(
	context: ReducerContext,
	event: GatewayEvent,
	state: string,
): void {
	const runId = event.scope.runId;
	const sessionId = event.scope.sessionId;
	if (!runId || !sessionId) {
		return;
	}
	const payload = payloadOf(event);
	upsertSessionSummary(context, sessionId, event.scope.botId, {
		activity:
			state === "running" ? "running" : state === "queued" ? "queued" : "idle",
		lastRunState: state,
	});
	const active = activeSessionFor(context, event);
	if (!active) {
		return;
	}
	let run = active.runs.find((entry) => entry.runId === runId);
	if (!run) {
		const hintedProvenance = context.provenanceHints.get(runId);
		run = {
			runId,
			state,
			attempt: 1,
			acceptedAt:
				typeof payload.acceptedAt === "number"
					? payload.acceptedAt
					: context.clock(),
			retryable: false,
			...(hintedProvenance ? { provenance: hintedProvenance } : {}),
		};
		active.runs.push(run);
	} else if (!run.provenance) {
		const hintedProvenance = context.provenanceHints.get(runId);
		if (hintedProvenance) {
			run.provenance = hintedProvenance;
		}
	}
	run.state = state;
	run.retryable = state === "failed" || state === "interrupted";
	if (typeof payload.startedAt === "number") {
		run.startedAt = payload.startedAt;
	}
	if (typeof payload.endedAt === "number") {
		run.endedAt = payload.endedAt;
	}
	if (
		typeof payload.error === "object" &&
		payload.error !== null &&
		typeof (payload.error as { name?: unknown }).name === "string"
	) {
		const error = payload.error as { name: string; message?: unknown };
		run.error = {
			name: error.name,
			message: typeof error.message === "string" ? error.message : "",
		};
	} else if (state === "queued") {
		run.error = undefined;
	}
	if (typeof payload.outputText === "string") {
		run.outputPreview = truncateForProjection(
			payload.outputText,
			MAX_PREVIEW_CHARS,
		).text;
	}

	if (state === "queued") {
		if (!active.queuedTurns.some((turn) => turn.runId === runId)) {
			active.queuedTurns.push({
				runId,
				promptPreview: context.promptPreviews.get(runId) ?? "(queued turn)",
				acceptedAt:
					typeof payload.acceptedAt === "number"
						? payload.acceptedAt
						: context.clock(),
			});
		}
	} else {
		active.queuedTurns = active.queuedTurns.filter(
			(turn) => turn.runId !== runId,
		);
	}

	if (state === "running") {
		active.currentRun = run;
		active.streaming = undefined;
		active.tools = active.tools.filter((tool) => tool.state !== "running");
	} else if (active.currentRun?.runId === runId) {
		active.currentRun = run;
		if (state !== "queued") {
			active.streaming = undefined;
		}
	} else if (
		state === "queued" &&
		(!active.currentRun ||
			!["queued", "running"].includes(active.currentRun.state))
	) {
		// Nothing active: surface the newly queued turn as the current run.
		active.currentRun = run;
	}
	commit(context, "activeSession");
}

function applyEventBody(context: ReducerContext, event: GatewayEvent): void {
	const payload = payloadOf(event);
	const active = activeSessionFor(context, event);
	switch (event.event) {
		case "session.created": {
			if (event.scope.sessionId) {
				upsertSessionSummary(
					context,
					event.scope.sessionId,
					event.scope.botId,
					{
						state: "active",
						activity: "idle",
						...(typeof payload.workspaceRoot === "string"
							? {
									workspaceId: workspaceIdForPath(
										context,
										payload.workspaceRoot,
									),
								}
							: {}),
					},
				);
			}
			return;
		}
		case "session.closed": {
			if (event.scope.sessionId) {
				upsertSessionSummary(
					context,
					event.scope.sessionId,
					event.scope.botId,
					{ state: "closed", activity: "closed" },
				);
			}
			return;
		}
		case "run.queued":
			applyRunStateEvent(context, event, "queued");
			return;
		case "run.started":
			applyRunStateEvent(context, event, "running");
			return;
		case "run.completed":
			applyRunStateEvent(context, event, "completed");
			return;
		case "run.failed":
			applyRunStateEvent(context, event, "failed");
			return;
		case "run.aborted":
			applyRunStateEvent(context, event, "aborted");
			return;
		case "run.interrupted":
			applyRunStateEvent(context, event, "interrupted");
			return;
		case "run.retried": {
			addNotice(
				context,
				`Run ${event.scope.runId ?? "?"} manually retried (attempt ${
					typeof payload.nextAttempt === "number" ? payload.nextAttempt : "?"
				})`,
			);
			return;
		}
		case "run.attemptStarted": {
			if (active && typeof payload.attempt === "number") {
				const run = active.runs.find(
					(entry) => entry.runId === event.scope.runId,
				);
				if (run) {
					run.attempt = payload.attempt;
					commit(context, "activeSession");
				}
			}
			return;
		}
		case "run.attemptSettled": {
			if (payload.status === "failed") {
				addNotice(
					context,
					`Attempt ${typeof payload.attempt === "number" ? payload.attempt : "?"} of run ${event.scope.runId ?? "?"} failed`,
				);
			}
			return;
		}
		case "run.attemptRetrying":
			addNotice(
				context,
				`Run ${event.scope.runId ?? "?"} retrying (attempt ${
					typeof payload.nextAttempt === "number" ? payload.nextAttempt : "?"
				})`,
			);
			return;
		case "run.steered":
			addNotice(
				context,
				`Steering merged into run ${event.scope.runId ?? "?"}`,
			);
			return;
		case "run.messageAppended": {
			if (!active) {
				return;
			}
			const message = messageProjectionFrom(payload.message, event.scope.runId);
			if (!message) {
				return;
			}
			if (!active.messages.some((entry) => entry.id === message.id)) {
				active.messages.push(message);
				active.messages = boundMessages(active.messages);
			}
			if (message.role === "assistant") {
				active.streaming = undefined;
			}
			commit(context, "activeSession");
			return;
		}
		case "engine.textDelta": {
			if (!active || typeof payload.text !== "string" || !event.scope.runId) {
				return;
			}
			const current =
				active.streaming?.runId === event.scope.runId
					? active.streaming.text
					: "";
			const combined = truncateForProjection(
				current + payload.text,
				MAX_STREAMING_CHARS,
			);
			active.streaming = {
				runId: event.scope.runId,
				text: combined.text,
				...(combined.truncated ? { truncated: true } : {}),
			};
			commit(context, "activeSession");
			return;
		}
		case "engine.toolStarted": {
			if (
				active &&
				typeof payload.toolCallId === "string" &&
				typeof payload.toolName === "string"
			) {
				if (
					!active.tools.some((tool) => tool.toolCallId === payload.toolCallId)
				) {
					active.tools.push({
						toolCallId: payload.toolCallId,
						toolName: payload.toolName,
						state: "running",
					});
					commit(context, "activeSession");
				}
			}
			return;
		}
		case "engine.toolFinished": {
			if (active && typeof payload.toolCallId === "string") {
				const tool = active.tools.find(
					(entry) => entry.toolCallId === payload.toolCallId,
				);
				if (tool) {
					tool.state = payload.isError === true ? "error" : "finished";
					commit(context, "activeSession");
				}
			}
			return;
		}
		case "engine.usageUpdated": {
			if (active && typeof payload.usage === "object" && payload.usage) {
				const usage = payload.usage as {
					inputTokens?: unknown;
					outputTokens?: unknown;
					totalCost?: unknown;
				};
				active.usage = {
					inputTokens:
						typeof usage.inputTokens === "number" ? usage.inputTokens : 0,
					outputTokens:
						typeof usage.outputTokens === "number" ? usage.outputTokens : 0,
					...(typeof usage.totalCost === "number"
						? { totalCost: usage.totalCost }
						: {}),
				};
				commit(context, "activeSession");
			}
			return;
		}
		case "approval.resolved": {
			if (typeof payload.requestId === "string") {
				removeApproval(context, payload.requestId);
				addNotice(
					context,
					`Approval ${payload.requestId} resolved (${payload.approved === true ? "approved" : "denied"})`,
				);
			}
			return;
		}
		case "gateway.drainStarted":
			addNotice(context, "Gateway started draining");
			return;
		case "gateway.recoveryCompleted":
			addNotice(context, "Gateway completed restart recovery");
			return;
		case "connector.registered": {
			if (
				typeof payload.connectorId === "string" &&
				typeof payload.kind === "string" &&
				!context.projection.connectors.some(
					(connector) => connector.connectorId === payload.connectorId,
				)
			) {
				context.projection.connectors.push({
					connectorId: payload.connectorId,
					botId: event.scope.botId ?? "",
					kind: payload.kind,
					name: typeof payload.name === "string" ? payload.name : "",
					status: "enabled",
					// Unknown until the next hydration refreshes the record.
					hasCredential: false,
				});
				commit(context, "connectors");
			}
			addNotice(
				context,
				`Connector registered: ${typeof payload.name === "string" ? payload.name : payload.connectorId}`,
			);
			return;
		}
		case "connector.messageAdmitted": {
			if (typeof payload.connectorId === "string" && event.scope.runId) {
				// Provenance for the run this admission created: the run's
				// lifecycle events carry no provenance, so remember the hint.
				context.provenanceHints.set(event.scope.runId, {
					mode: "connector",
					connectorId: payload.connectorId,
					submittedBy: `connector:${payload.connectorId}`,
				});
				const run = active?.runs.find(
					(entry) => entry.runId === event.scope.runId,
				);
				if (run && !run.provenance) {
					run.provenance = {
						mode: "connector",
						connectorId: payload.connectorId,
					};
					commit(context, "activeSession");
				}
			}
			addNotice(
				context,
				`Connector message admitted into session ${event.scope.sessionId ?? "?"} (run ${event.scope.runId ?? "?"})`,
			);
			return;
		}
		case "schedule.created": {
			if (
				typeof payload.scheduleId === "string" &&
				!context.projection.schedules.some(
					(schedule) => schedule.scheduleId === payload.scheduleId,
				)
			) {
				context.projection.schedules.push({
					scheduleId: payload.scheduleId,
					botId: event.scope.botId ?? "",
					name: typeof payload.name === "string" ? payload.name : "",
					// Details land with the next hydration refresh.
					trigger: "pending refresh",
					enabled: true,
				});
				commit(context, "schedules");
			}
			addNotice(
				context,
				`Schedule created: ${typeof payload.name === "string" ? payload.name : payload.scheduleId}`,
			);
			return;
		}
		default:
			// Unknown additive events must never break the client.
			return;
	}
}

// -----------------------------------------------------------------------------
// Approvals (server-initiated requests are independent of events)
// -----------------------------------------------------------------------------

export function addApproval(
	context: ReducerContext,
	request: GatewayServerRequest,
): void {
	if (
		context.projection.approvals.some(
			(approval) => approval.requestId === request.id,
		)
	) {
		return;
	}
	const params = (request.params ?? {}) as Record<string, unknown>;
	let inputPreview: string | undefined;
	if (params.input !== undefined) {
		try {
			inputPreview = truncateForProjection(
				JSON.stringify(params.input),
				MAX_PREVIEW_CHARS,
			).text;
		} catch {
			inputPreview = undefined;
		}
	}
	const approval: ApprovalProjection = {
		requestId: request.id,
		method: request.method,
		...(request.scope.botId ? { botId: request.scope.botId } : {}),
		...(request.scope.sessionId ? { sessionId: request.scope.sessionId } : {}),
		...(request.scope.runId ? { runId: request.scope.runId } : {}),
		...(typeof params.toolName === "string"
			? { toolName: params.toolName }
			: {}),
		...(typeof params.toolCallId === "string"
			? { toolCallId: params.toolCallId }
			: {}),
		...(inputPreview ? { inputPreview } : {}),
		receivedAt: context.clock(),
	};
	context.projection.approvals.push(approval);
	const active = context.projection.activeSession;
	if (active && active.sessionId === request.scope.sessionId) {
		active.outstandingApprovalIds.push(request.id);
		commit(context, "activeSession");
	}
	commit(context, "approvals");
}

export function removeApproval(
	context: ReducerContext,
	requestId: string,
): void {
	const before = context.projection.approvals.length;
	context.projection.approvals = context.projection.approvals.filter(
		(approval) => approval.requestId !== requestId,
	);
	const active = context.projection.activeSession;
	if (active) {
		active.outstandingApprovalIds = active.outstandingApprovalIds.filter(
			(id) => id !== requestId,
		);
		commit(context, "activeSession");
	}
	if (context.projection.approvals.length !== before) {
		commit(context, "approvals");
	}
}
