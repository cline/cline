import {
	isUserRunMessage,
	parseSubSessionId,
	parseTeamTaskSubSessionId,
	type SessionCompactionState,
} from "@cline/core";
import {
	type ContentBlock,
	formatDisplayUserInput,
	formatFileContentBlock,
	groupSessionMessageIterations,
	hasSessionToolResult,
	type MessageChildSessionLink,
	type MessageWithMetadata,
	type SessionRecordedModelCall,
	type SessionReplayEvent,
	TOOL_ENVIRONMENT_METADATA_KEY,
} from "@cline/shared";
import type {
	LoadedSessionReplayBundle,
	LoadedSessionReplaySession,
} from "../bundle-io";
import {
	buildSessionReplayIterations,
	type SessionReplayIteration,
} from "../bundle-iterations";
import {
	ATIF_SCHEMA_VERSION,
	type AtifAgent,
	type AtifExtra,
	type AtifFinalMetrics,
	type AtifMetrics,
	type AtifObservationResult,
	type AtifStep,
	type AtifSubagentTrajectoryRef,
	type AtifToolCall,
	type AtifTrajectory,
} from "./atif-types";

export interface ExportSessionReplayAtifOptions {
	/** `agent.name` (default `cline`). */
	agentName?: string;
	/** `agent.version`; defaults to the bundle producer's host version, then its version. */
	agentVersion?: string;
	/** Emit the session's system prompt as its first step (default true). */
	includeSystemPrompt?: boolean;
}

export interface ExportSessionReplayAtifResult {
	trajectory: AtifTrajectory;
	/** Non-fatal notes about data the trajectory could not carry exactly. */
	warnings: string[];
}

export type AtifExportBundle = Pick<
	LoadedSessionReplayBundle,
	"manifest" | "sessions" | "redaction" | "sourceSchemaVersion"
>;

type ChildKind = MessageChildSessionLink["kind"];

interface ChildLink {
	parentSessionId: string;
	childSessionId: string;
	kind: ChildKind;
	/** Absent when no tool call of the parent could be matched. */
	toolCallId?: string;
	linkedBy: "message" | "inferred" | "parent";
}

interface MissingChild {
	sessionId: string;
	kind: ChildKind;
}

interface PendingStep {
	order: number;
	step: Omit<AtifStep, "step_id">;
}

interface ExportState {
	bundle: AtifExportBundle;
	options: ExportSessionReplayAtifOptions;
	sessions: Map<string, LoadedSessionReplaySession>;
	links: ChildLink[];
	missing: Map<string, Map<string, MissingChild[]>>;
	omittedImages: number;
	warnings: string[];
}

const SPAWN_TOOL = "spawn_agent";
const TEAM_TOOL = "team_run_task";
/** Slack around a tool call's window when matching a child's start time. */
const LINK_WINDOW_MS = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isoFromMs(ms: number | undefined): string | undefined {
	return typeof ms === "number" && Number.isFinite(ms)
		? new Date(ms).toISOString()
		: undefined;
}

function msFromIso(value: string | null | undefined): number | undefined {
	if (!value) return undefined;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : undefined;
}

function normalizeIso(value: string | null | undefined): string | undefined {
	return isoFromMs(msFromIso(value));
}

function nonEmpty<T extends Record<string, unknown>>(value: T): T | undefined {
	const entries = Object.entries(value).filter(
		([, item]) => item !== undefined,
	);
	return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

function clineExtra(
	cline: Record<string, unknown>,
	other: AtifExtra = {},
): AtifExtra | undefined {
	const compact = nonEmpty(cline);
	return compact || Object.keys(other).length > 0
		? { ...other, ...(compact ? { cline: compact } : {}) }
		: undefined;
}

function toolUses(
	message: MessageWithMetadata,
): Extract<ContentBlock, { type: "tool_use" }>[] {
	return Array.isArray(message.content)
		? message.content.filter(
				(block): block is Extract<ContentBlock, { type: "tool_use" }> =>
					block.type === "tool_use",
			)
		: [];
}

function toolResults(
	message: MessageWithMetadata,
): Extract<ContentBlock, { type: "tool_result" }>[] {
	return Array.isArray(message.content)
		? message.content.filter(
				(block): block is Extract<ContentBlock, { type: "tool_result" }> =>
					block.type === "tool_result",
			)
		: [];
}

function plainText(message: MessageWithMetadata): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n");
}

function isCompactionSummary(message: MessageWithMetadata): boolean {
	return (
		message.compactionSummary === true ||
		message.metadata?.kind === "compaction_summary"
	);
}

function displayRole(message: MessageWithMetadata): string | undefined {
	const role = message.metadata?.displayRole;
	return typeof role === "string" ? role.trim().toLowerCase() : undefined;
}

function firstUserPrompt(
	session: LoadedSessionReplaySession,
): string | undefined {
	const message = session.transcript.messages.find(
		(candidate) =>
			candidate.role === "user" &&
			!hasSessionToolResult(candidate) &&
			isUserRunMessage(candidate),
	);
	return message ? formatDisplayUserInput(plainText(message)) : undefined;
}

function normalizeTask(text: string | undefined): string {
	return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sanitizeToken(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/** The agent id a child session id was derived from, when it encodes one. */
function childAgentId(session: LoadedSessionReplaySession): string | undefined {
	const id = session.entry.sessionId;
	return (
		parseTeamTaskSubSessionId(id)?.agentId ??
		parseSubSessionId(id)?.agentId ??
		session.entry.agentId ??
		undefined
	);
}

function childKind(session: LoadedSessionReplaySession): ChildKind {
	return session.entry.role === "teammate" ||
		parseTeamTaskSubSessionId(session.entry.sessionId)
		? "teammate"
		: "subagent";
}

interface ToolCallWindow {
	id: string;
	name: string;
	input: Record<string, unknown>;
	startMs?: number;
	endMs?: number;
}

function toolCallWindows(
	session: LoadedSessionReplaySession,
): ToolCallWindow[] {
	const windows: ToolCallWindow[] = [];
	const byId = new Map<string, ToolCallWindow>();
	for (const message of session.transcript.messages) {
		if (message.role === "assistant") {
			for (const block of toolUses(message)) {
				const window: ToolCallWindow = {
					id: block.id,
					name: block.name,
					input: isRecord(block.input) ? block.input : {},
					...(typeof message.ts === "number" ? { startMs: message.ts } : {}),
				};
				windows.push(window);
				byId.set(block.id, window);
			}
		}
		for (const block of toolResults(message)) {
			const window = byId.get(block.tool_use_id);
			if (window && typeof message.ts === "number") {
				window.endMs = message.ts;
			}
		}
	}
	return windows;
}

/**
 * Picks the parent tool call that most likely started `child`, for sessions
 * written before messages carried `childSessions`: a matching task text and
 * a call window that contains the child's start beat either alone.
 */
function inferSpawningToolCall(
	child: LoadedSessionReplaySession,
	candidates: readonly ToolCallWindow[],
	claimed: ReadonlySet<string>,
): ToolCallWindow | undefined {
	const kind = childKind(child);
	const agentId = childAgentId(child);
	const prompt = normalizeTask(firstUserPrompt(child));
	const startMs = msFromIso(child.entry.startedAt);
	let best:
		| { call: ToolCallWindow; score: number; distance: number }
		| undefined;
	for (const call of candidates) {
		if (claimed.has(call.id)) continue;
		const isTeamTool = call.name === TEAM_TOOL;
		if ((kind === "teammate") !== isTeamTool) continue;
		const targetAgent = str(call.input.agentId);
		if (
			isTeamTool &&
			targetAgent &&
			agentId &&
			sanitizeToken(targetAgent) !== sanitizeToken(agentId)
		) {
			continue;
		}
		const task = normalizeTask(str(call.input.task) ?? str(call.input.prompt));
		const textMatch =
			task.length > 0 &&
			prompt.length > 0 &&
			(prompt === task || prompt.includes(task) || task.includes(prompt));
		const timeMatch =
			startMs !== undefined &&
			call.startMs !== undefined &&
			startMs >= call.startMs - LINK_WINDOW_MS &&
			(call.endMs === undefined || startMs <= call.endMs + LINK_WINDOW_MS);
		const knownSpawner = isTeamTool || call.name === SPAWN_TOOL;
		if (!textMatch && !(timeMatch && knownSpawner)) continue;
		const score = (textMatch ? 2 : 0) + (timeMatch ? 1 : 0);
		const distance =
			startMs !== undefined && call.startMs !== undefined
				? Math.abs(startMs - call.startMs)
				: Number.POSITIVE_INFINITY;
		if (
			!best ||
			score > best.score ||
			(score === best.score && distance < best.distance)
		) {
			best = { call, score, distance };
		}
	}
	return best?.call;
}

function resolveChildLinks(state: ExportState): void {
	const { manifest } = state.bundle;
	const rootId = manifest.rootSessionId;
	const claimedChildren = new Set<string>([rootId]);
	const claimedCalls = new Map<string, Set<string>>();
	const claimCall = (sessionId: string, toolCallId: string) => {
		const calls = claimedCalls.get(sessionId) ?? new Set<string>();
		calls.add(toolCallId);
		claimedCalls.set(sessionId, calls);
	};

	for (const session of state.sessions.values()) {
		const parentId = session.entry.sessionId;
		for (const message of session.transcript.messages) {
			if (message.role !== "assistant") continue;
			for (const link of message.childSessions ?? []) {
				if (link.sessionId === parentId) continue;
				if (!state.sessions.has(link.sessionId)) {
					const byCall = state.missing.get(parentId) ?? new Map();
					byCall.set(link.toolCallId, [
						...(byCall.get(link.toolCallId) ?? []),
						{ sessionId: link.sessionId, kind: link.kind },
					]);
					state.missing.set(parentId, byCall);
					state.warnings.push(
						`Tool call ${link.toolCallId} in session ${parentId} started ${link.kind} session ${link.sessionId}, which is not in the bundle.`,
					);
					continue;
				}
				if (claimedChildren.has(link.sessionId)) continue;
				claimedChildren.add(link.sessionId);
				claimCall(parentId, link.toolCallId);
				state.links.push({
					parentSessionId: parentId,
					childSessionId: link.sessionId,
					kind: link.kind,
					toolCallId: link.toolCallId,
					linkedBy: "message",
				});
			}
		}
	}

	const unclaimed = [...state.sessions.values()]
		.filter((session) => !claimedChildren.has(session.entry.sessionId))
		.sort(
			(a, b) =>
				(msFromIso(a.entry.startedAt) ?? 0) -
				(msFromIso(b.entry.startedAt) ?? 0),
		);
	const windows = new Map<string, ToolCallWindow[]>();
	let inferred = 0;
	for (const child of unclaimed) {
		const childId = child.entry.sessionId;
		const byAgent = child.entry.parentAgentId
			? [...state.sessions.values()].find(
					(candidate) =>
						candidate.entry.sessionId !== childId &&
						candidate.entry.agentId === child.entry.parentAgentId,
				)
			: undefined;
		const parentId =
			byAgent?.entry.sessionId ??
			(child.entry.parentSessionId &&
			state.sessions.has(child.entry.parentSessionId)
				? child.entry.parentSessionId
				: rootId);
		const parent = state.sessions.get(parentId);
		if (!parent) continue;
		if (!windows.has(parentId)) {
			windows.set(parentId, toolCallWindows(parent));
		}
		const call = inferSpawningToolCall(
			child,
			windows.get(parentId) ?? [],
			claimedCalls.get(parentId) ?? new Set(),
		);
		claimedChildren.add(childId);
		if (call) {
			claimCall(parentId, call.id);
			inferred += 1;
		} else {
			state.warnings.push(
				`Child session ${childId} could not be matched to a tool call of session ${parentId}; it is referenced from a system step.`,
			);
		}
		state.links.push({
			parentSessionId: parentId,
			childSessionId: childId,
			kind: childKind(child),
			...(call ? { toolCallId: call.id } : {}),
			linkedBy: call ? "inferred" : "parent",
		});
	}
	if (inferred > 0) {
		state.warnings.push(
			`Matched ${inferred} child session(s) to tool calls by task text and timing, because their messages carry no child session links.`,
		);
	}

	// A link cycle cannot reach the root; hang such sessions off the root.
	const parentOf = new Map(
		state.links.map((link) => [link.childSessionId, link]),
	);
	for (const link of state.links) {
		const seen = new Set<string>([link.childSessionId]);
		let current = link.parentSessionId;
		while (current !== rootId) {
			if (seen.has(current)) break;
			seen.add(current);
			const next = parentOf.get(current)?.parentSessionId;
			if (!next) break;
			current = next;
		}
		if (current !== rootId) {
			state.warnings.push(
				`Child session ${link.childSessionId} is not reachable from the root through its links; it is attached to the root session.`,
			);
			link.parentSessionId = rootId;
			delete link.toolCallId;
			link.linkedBy = "parent";
		}
	}
}

function renderBlocks(
	state: ExportState,
	blocks: ReadonlyArray<ContentBlock | Record<string, unknown>>,
): string {
	return blocks
		.flatMap((raw): string[] => {
			const block = raw as Record<string, unknown>;
			switch (block.type) {
				case "text":
					return typeof block.text === "string" ? [block.text] : [];
				case "file":
					return [
						formatFileContentBlock(
							String(block.path ?? ""),
							String(block.content ?? ""),
						),
					];
				case "image":
					state.omittedImages += 1;
					return [`[image omitted: ${str(block.mediaType) ?? "image"}]`];
				case "media":
					state.omittedImages += 1;
					return ["[media omitted]"];
				case "tool_use":
					return [
						`[tool call ${String(block.name)}: ${JSON.stringify(block.input ?? {})}]`,
					];
				case "tool_result":
					return [
						`[tool result ${String(block.name ?? block.tool_use_id)}]\n${renderToolResultContent(state, block.content)}`,
					];
				case "thinking":
				case "redacted_thinking":
					return [];
				default:
					return [JSON.stringify(block)];
			}
		})
		.join("\n");
}

function renderToolResultContent(state: ExportState, content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return renderBlocks(state, content);
	return JSON.stringify(content ?? null);
}

function renderMessage(
	state: ExportState,
	message: MessageWithMetadata,
): string {
	return typeof message.content === "string"
		? message.content
		: renderBlocks(state, message.content);
}

function stepMetrics(message: MessageWithMetadata): AtifMetrics | undefined {
	const metrics = message.metrics;
	if (!metrics) return undefined;
	const int = (value: number | undefined) =>
		typeof value === "number" && Number.isFinite(value)
			? Math.round(value)
			: undefined;
	const cacheWrite = int(metrics.cacheWriteTokens);
	return nonEmpty({
		prompt_tokens: int(metrics.inputTokens),
		completion_tokens: int(metrics.outputTokens),
		cached_tokens: int(metrics.cacheReadTokens),
		cost_usd:
			typeof metrics.cost === "number" && Number.isFinite(metrics.cost)
				? metrics.cost
				: undefined,
		extra:
			cacheWrite !== undefined
				? { cache_creation_input_tokens: cacheWrite }
				: undefined,
	} satisfies AtifMetrics);
}

function eventExtra(
	event: SessionReplayIteration["events"][number],
	source: SessionReplayEvent | undefined,
): Record<string, unknown> {
	return {
		index: event.index,
		ts: event.ts,
		kind: event.kind,
		name: event.name,
		...(event.seq !== undefined ? { seq: event.seq } : {}),
		...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
		...(event.iteration !== undefined ? { iteration: event.iteration } : {}),
		...(event.refs ? { refs: event.refs } : {}),
		...(event.detail ? { detail: event.detail } : {}),
		...(event.kind === "decision" && source ? { payload: source.payload } : {}),
	};
}

function modelCallExtra(
	call: NonNullable<SessionReplayIteration["modelCalls"]>[number],
	record: SessionRecordedModelCall | undefined,
): Record<string, unknown> {
	return {
		callIndex: call.callIndex,
		seq: call.seq,
		runId: call.runId,
		iteration: call.iteration,
		attempt: call.attempt,
		outcome: call.outcome,
		finishReason: call.finishReason,
		durationMs: call.durationMs,
		matchKey: call.matchKey,
		messageCount: call.messageCount,
		...(call.messageId ? { messageId: call.messageId } : {}),
		...(call.error ? { error: call.error } : {}),
		...(record
			? {
					startedAt: record.startedAt,
					finishedAt: record.finishedAt,
					...(record.response.usage ? { usage: record.response.usage } : {}),
					...(record.compaction ? { compaction: record.compaction } : {}),
				}
			: {}),
	};
}

function toolDefinitions(
	session: LoadedSessionReplaySession,
): Record<string, unknown>[] | undefined {
	const byName = new Map<string, Record<string, unknown>>();
	for (const record of session.requests) {
		const tools = session.blobs.get(record.request.toolsSha256)?.value;
		if (!Array.isArray(tools)) continue;
		for (const tool of tools) {
			if (!isRecord(tool) || typeof tool.name !== "string") continue;
			if (byName.has(tool.name)) continue;
			byName.set(tool.name, {
				type: "function",
				function: {
					name: tool.name,
					...(typeof tool.description === "string"
						? { description: tool.description }
						: {}),
					parameters: isRecord(tool.inputSchema) ? tool.inputSchema : {},
				},
			});
		}
	}
	return byName.size > 0 ? [...byName.values()] : undefined;
}

function childRef(link: ChildLink): AtifSubagentTrajectoryRef {
	return {
		trajectory_id: link.childSessionId,
		session_id: link.childSessionId,
		extra: { cline: { kind: link.kind, linkedBy: link.linkedBy } },
	};
}

function compactionStateStep(
	state: ExportState,
	compaction: SessionCompactionState,
): Omit<AtifStep, "step_id"> {
	const hasSummary = compaction.messages.some(isCompactionSummary);
	return {
		source: "system",
		...(normalizeIso(compaction.updated_at)
			? { timestamp: normalizeIso(compaction.updated_at) }
			: {}),
		message: hasSummary
			? "Context compaction: earlier messages were replaced by a summary."
			: "Context compaction: earlier messages were removed or truncated.",
		observation: {
			results: compaction.messages.map((message) => ({
				content: renderMessage(state, message),
				extra: {
					cline: nonEmpty({
						role: message.role,
						messageId: message.id,
						compactionSummary: isCompactionSummary(message) || undefined,
					}),
				},
			})),
		},
		extra: {
			context_management: {
				type: hasSummary ? "compaction" : "pruning",
				boundary: "replace",
			},
			cline: nonEmpty({
				source: "compaction-state",
				stateId: compaction.source_prefix_hash,
				sourceMessageCount: compaction.source_message_count,
				updatedAt: compaction.updated_at,
			}),
		},
	};
}

function buildAgentStep(input: {
	state: ExportState;
	session: LoadedSessionReplaySession;
	iteration: SessionReplayIteration;
	assistant: MessageWithMetadata;
	tail: readonly MessageWithMetadata[];
	recordsByMessageId: ReadonlyMap<string, SessionRecordedModelCall>;
	recordsByCallIndex: ReadonlyMap<number, SessionRecordedModelCall>;
	linksByCall: ReadonlyMap<string, ChildLink[]>;
	missingByCall: ReadonlyMap<string, MissingChild[]> | undefined;
}): Omit<AtifStep, "step_id"> {
	const { state, iteration, assistant } = input;
	const blocks = Array.isArray(assistant.content) ? assistant.content : [];
	const message =
		typeof assistant.content === "string"
			? assistant.content
			: renderBlocks(
					state,
					blocks.filter((block) => block.type !== "tool_use"),
				);
	const reasoning = blocks
		.flatMap((block) => (block.type === "thinking" ? [block.thinking] : []))
		.join("\n");
	const redactedThinking = blocks.filter(
		(block) => block.type === "redacted_thinking",
	).length;
	const callInfo = new Map(iteration.toolCalls.map((call) => [call.id, call]));
	const toolCalls: AtifToolCall[] = toolUses(assistant).map((block) => {
		const extra = clineExtra({
			execution:
				callInfo.get(block.id)?.execution === "provider"
					? "provider"
					: undefined,
			providerCallId:
				block.call_id && block.call_id !== block.id ? block.call_id : undefined,
		});
		return {
			tool_call_id: block.id,
			function_name: block.name,
			arguments: isRecord(block.input) ? block.input : { value: block.input },
			...(extra ? { extra } : {}),
		};
	});
	const callIds = new Set(toolCalls.map((call) => call.tool_call_id));

	const results: AtifObservationResult[] = [];
	const answered = new Set<string>();
	const resultFor = (
		toolCallId: string | undefined,
		block: Extract<ContentBlock, { type: "tool_result" }> | undefined,
		message: MessageWithMetadata | undefined,
	): AtifObservationResult => {
		const info = toolCallId ? callInfo.get(toolCallId) : undefined;
		const links = toolCallId ? (input.linksByCall.get(toolCallId) ?? []) : [];
		const missing = toolCallId
			? (input.missingByCall?.get(toolCallId) ?? [])
			: [];
		const environment = message?.metadata?.[TOOL_ENVIRONMENT_METADATA_KEY];
		const inStep = toolCallId !== undefined && callIds.has(toolCallId);
		const extra = clineExtra({
			toolCallId: inStep ? undefined : toolCallId,
			toolName: block?.name,
			isError: block?.is_error === true ? true : undefined,
			resultMissing: block ? undefined : true,
			messageId: message?.id,
			startedAt: info?.startedAt,
			endedAt: info?.endedAt,
			durationMs: info?.durationMs,
			environment: environment ?? undefined,
			childSessions:
				missing.length > 0
					? missing.map((child) => ({ ...child, inBundle: false }))
					: undefined,
		});
		return {
			...(inStep ? { source_call_id: toolCallId } : {}),
			...(block
				? { content: renderToolResultContent(state, block.content) }
				: {}),
			...(links.length > 0
				? { subagent_trajectory_ref: links.map(childRef) }
				: {}),
			...(extra ? { extra } : {}),
		};
	};
	for (const message of input.tail) {
		for (const block of toolResults(message)) {
			answered.add(block.tool_use_id);
			results.push(resultFor(block.tool_use_id, block, message));
		}
		const text = Array.isArray(message.content)
			? renderBlocks(
					state,
					message.content.filter((block) => block.type !== "tool_result"),
				)
			: message.content;
		if (text.trim()) {
			results.push({
				content: text,
				extra: { cline: nonEmpty({ messageId: message.id, role: "user" }) },
			});
		}
	}
	for (const call of toolCalls) {
		const id = call.tool_call_id;
		if (answered.has(id)) continue;
		if (
			(input.linksByCall.get(id)?.length ?? 0) > 0 ||
			(input.missingByCall?.get(id)?.length ?? 0) > 0
		) {
			results.push(resultFor(id, undefined, undefined));
		}
	}

	const record = assistant.id
		? input.recordsByMessageId.get(assistant.id)
		: undefined;
	const timestamp =
		isoFromMs(assistant.ts) ??
		normalizeIso(record?.finishedAt) ??
		iteration.timing.startedAt;
	const metrics = stepMetrics(assistant);
	const events = iteration.events.map((event) =>
		eventExtra(
			event,
			input.session.events.find((candidate) => candidate.index === event.index),
		),
	);
	const modelCalls = iteration.modelCalls?.map((call) =>
		modelCallExtra(call, input.recordsByCallIndex.get(call.callIndex)),
	);
	const extra = clineExtra({
		messageId: assistant.id,
		iteration: iteration.index,
		turn: iteration.turn,
		provider: assistant.modelInfo?.provider,
		redactedThinkingBlocks: redactedThinking > 0 ? redactedThinking : undefined,
		modelCalls: modelCalls && modelCalls.length > 0 ? modelCalls : undefined,
		events: events.length > 0 ? events : undefined,
	});
	return {
		source: "agent",
		...(timestamp ? { timestamp } : {}),
		...(assistant.modelInfo?.id ? { model_name: assistant.modelInfo.id } : {}),
		message,
		...(reasoning ? { reasoning_content: reasoning } : {}),
		...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
		...(results.length > 0 ? { observation: { results } } : {}),
		...(metrics ? { metrics } : {}),
		llm_call_count: 1,
		...(extra ? { extra } : {}),
	};
}

/** Steps for a transcript message that is not a model call or its tool results. */
function buildMessageSteps(
	state: ExportState,
	message: MessageWithMetadata,
	order: number,
): PendingStep[] {
	const timestamp = isoFromMs(message.ts);
	const base = timestamp ? { timestamp } : {};
	const kind = str(message.metadata?.kind);
	if (isCompactionSummary(message)) {
		const rendered = renderMessage(state, message);
		const summary = rendered.trim()
			? rendered
			: (str(message.metadata?.summary) ?? rendered);
		return [
			{
				order,
				step: {
					source: "system",
					...base,
					message:
						"Context compaction: earlier messages were replaced by a summary.",
					observation: { results: [{ content: summary }] },
					extra: {
						context_management: { type: "compaction", boundary: "replace" },
						cline: nonEmpty({
							source: "transcript",
							messageId: message.id,
							role: message.role,
						}),
					},
				},
			},
		];
	}
	if (message.role === "user" && hasSessionToolResult(message)) {
		return [
			{
				order,
				step: {
					source: "system",
					...base,
					message: "Tool results without a tool call in this trajectory.",
					observation: {
						results: toolResults(message).map((block) => ({
							content: renderToolResultContent(state, block.content),
							extra: {
								cline: nonEmpty({
									toolCallId: block.tool_use_id,
									toolName: block.name,
									isError: block.is_error === true ? true : undefined,
								}),
							},
						})),
					},
					extra: { cline: nonEmpty({ messageId: message.id, role: "user" }) },
				},
			},
		];
	}
	const text = renderMessage(state, message);
	const displayOnly = message.metadata?.displayOnly === true ? true : undefined;
	if (message.role === "user" && isUserRunMessage(message)) {
		const steps: PendingStep[] = [];
		if (kind === "compaction") {
			steps.push({
				order: order - 0.1,
				step: {
					source: "system",
					...base,
					message:
						"Context compaction: earlier messages were removed before this prompt.",
					extra: {
						context_management: { type: "pruning", boundary: "truncate" },
						cline: nonEmpty({
							source: "transcript",
							messageId: message.id,
							reason: message.metadata?.reason,
							messagesRemoved: message.metadata?.messagesRemoved,
						}),
					},
				},
			});
		}
		const display = formatDisplayUserInput(plainText(message));
		const extra = clineExtra({
			messageId: message.id,
			displayText: display !== text ? display : undefined,
		});
		steps.push({
			order,
			step: {
				source: "user",
				...base,
				message: text,
				...(extra ? { extra } : {}),
			},
		});
		return steps;
	}
	return [
		{
			order,
			step: {
				source: "system",
				...base,
				message: text,
				extra: {
					cline: nonEmpty({
						messageId: message.id,
						role: message.role,
						kind,
						displayRole: displayRole(message),
						displayOnly,
					}),
				},
			},
		},
	];
}

function sessionExtra(
	state: ExportState,
	session: LoadedSessionReplaySession,
	isRoot: boolean,
	unattachedEvents: readonly SessionReplayEvent[],
): AtifExtra {
	const { recording, ...entry } = session.entry;
	const { manifest } = state.bundle;
	return {
		cline: {
			session: entry,
			...(recording
				? {
						recording: {
							version: recording.version,
							counts: recording.counts,
							coverage: recording.coverage,
						},
						environment: {
							segments: recording.segments,
						},
					}
				: {}),
			...(isRoot
				? {
						bundle: {
							format: manifest.format,
							schemaVersion: manifest.schemaVersion,
							sourceSchemaVersion: state.bundle.sourceSchemaVersion,
							createdAt: manifest.createdAt,
							producer: manifest.producer,
							redaction: {
								enabled: state.bundle.redaction.enabled,
								removedCount: state.bundle.redaction.redactions.length,
								covered: state.bundle.redaction.covered,
								notCovered: state.bundle.redaction.notCovered,
							},
							...(manifest.environment
								? { environment: manifest.environment }
								: {}),
						},
					}
				: {}),
			...(unattachedEvents.length > 0
				? {
						events: unattachedEvents.map((event) => ({
							index: event.index,
							ts: event.ts,
							kind: event.kind,
							name: event.name,
							...(event.seq !== undefined ? { seq: event.seq } : {}),
						})),
					}
				: {}),
		},
	};
}

function buildTrajectory(
	state: ExportState,
	sessionId: string,
	isRoot: boolean,
): AtifTrajectory {
	const session = state.sessions.get(sessionId);
	if (!session) {
		throw new Error(`session ${sessionId} is not in the bundle`);
	}
	const { entry, transcript } = session;
	const messages = transcript.messages;
	const iterations = buildSessionReplayIterations({
		sessionId,
		transcript,
		events: session.events,
		requests: session.requests,
	});
	const groups = groupSessionMessageIterations(messages);
	const recordsByMessageId = new Map<string, SessionRecordedModelCall>();
	const recordsByCallIndex = new Map<number, SessionRecordedModelCall>();
	for (const record of session.requests) {
		recordsByCallIndex.set(record.callIndex, record);
		if (record.response.messageId) {
			recordsByMessageId.set(record.response.messageId, record);
		}
	}
	const childLinks = state.links.filter(
		(link) => link.parentSessionId === sessionId,
	);
	const linksByCall = new Map<string, ChildLink[]>();
	for (const link of childLinks) {
		if (!link.toolCallId) continue;
		linksByCall.set(link.toolCallId, [
			...(linksByCall.get(link.toolCallId) ?? []),
			link,
		]);
	}
	const missingByCall = state.missing.get(sessionId);

	const pending: PendingStep[] = [];
	if (state.options.includeSystemPrompt !== false && transcript.systemPrompt) {
		pending.push({
			order: -1,
			step: {
				source: "system",
				...(normalizeIso(entry.startedAt)
					? { timestamp: normalizeIso(entry.startedAt) }
					: {}),
				message: transcript.systemPrompt,
				extra: { cline: { kind: "system-prompt" } },
			},
		});
	}

	let iterationMismatches = 0;
	let previousGroupSteps: PendingStep[] = [];
	for (const [position, group] of groups.entries()) {
		const iteration = iterations[position];
		if (!iteration) continue;
		const groupSteps: PendingStep[] = [];
		let agentStep: PendingStep | undefined;
		const assistantIndex = group.assistantIndex;
		for (let index = group.start; index < group.end; index += 1) {
			const message = messages[index];
			if (!message) continue;
			if (index === assistantIndex) {
				if (
					message.iteration !== undefined &&
					message.iteration !== iteration.index
				) {
					iterationMismatches += 1;
				}
				const tail = messages
					.slice(index + 1, group.end)
					.filter(hasSessionToolResult);
				agentStep = {
					order: index,
					step: buildAgentStep({
						state,
						session,
						iteration,
						assistant: message,
						tail,
						recordsByMessageId,
						recordsByCallIndex,
						linksByCall,
						missingByCall,
					}),
				};
				groupSteps.push(agentStep);
				continue;
			}
			if (
				assistantIndex !== undefined &&
				index > assistantIndex &&
				hasSessionToolResult(message)
			) {
				continue;
			}
			groupSteps.push(...buildMessageSteps(state, message, index));
		}
		if (!agentStep && iteration.events.length > 0) {
			const holder = groupSteps.at(-1) ?? previousGroupSteps.at(-1);
			if (holder) {
				const extra = (holder.step.extra ?? {}) as AtifExtra;
				const cline = (extra.cline ?? {}) as Record<string, unknown>;
				holder.step.extra = {
					...extra,
					cline: {
						...cline,
						events: [
							...((cline.events as unknown[]) ?? []),
							...iteration.events.map((event) =>
								eventExtra(
									event,
									session.events.find(
										(candidate) => candidate.index === event.index,
									),
								),
							),
						],
					},
				};
			}
		}
		pending.push(...groupSteps);
		if (groupSteps.length > 0) previousGroupSteps = groupSteps;
	}
	if (iterationMismatches > 0) {
		state.warnings.push(
			`Session ${sessionId}: ${iterationMismatches} assistant message(s) carry an iteration number that differs from their position; positions were used.`,
		);
	}

	const canonical = messages.flatMap((message, index) =>
		message.metadata?.displayOnly === true ? [] : [index],
	);
	// Compaction runs before the model call that follows the compacted
	// messages, so the step goes right before the next message sent to it.
	const boundaryOrder = (sourceMessageCount: number): number => {
		const next = canonical[Math.max(0, sourceMessageCount)];
		return next === undefined ? messages.length + 0.5 : next - 0.5;
	};
	const sidecarId = session.compaction?.source_prefix_hash;
	if (session.compaction) {
		pending.push({
			order: boundaryOrder(session.compaction.source_message_count),
			step: compactionStateStep(state, session.compaction),
		});
	}
	const recordedCompactions = new Map<
		string,
		NonNullable<SessionRecordedModelCall["compaction"]> & { callIndex: number }
	>();
	for (const record of session.requests) {
		const id = record.compaction?.id;
		if (!record.compaction || !id || id === sidecarId) continue;
		if (!recordedCompactions.has(id)) {
			recordedCompactions.set(id, {
				...record.compaction,
				callIndex: record.callIndex,
			});
		}
	}
	for (const [id, compaction] of recordedCompactions) {
		pending.push({
			order: boundaryOrder(compaction.sourceMessageCount),
			step: {
				source: "system",
				...(normalizeIso(compaction.updatedAt)
					? { timestamp: normalizeIso(compaction.updatedAt) }
					: {}),
				message:
					"Context compaction: the compacted context of this compaction is not stored in the bundle.",
				extra: {
					context_management: { type: "compaction" },
					cline: {
						source: "recorded-request",
						stateId: id,
						sourceMessageCount: compaction.sourceMessageCount,
						updatedAt: compaction.updatedAt,
						firstCallIndex: compaction.callIndex,
					},
				},
			},
		});
	}

	for (const link of childLinks) {
		if (link.toolCallId) continue;
		const child = state.sessions.get(link.childSessionId);
		const startMs = msFromIso(child?.entry.startedAt);
		const after =
			startMs === undefined
				? -1
				: messages.findIndex(
						(message) => typeof message.ts === "number" && message.ts > startMs,
					);
		pending.push({
			order: after >= 0 ? after - 0.25 : messages.length + 1,
			step: {
				source: "system",
				...(isoFromMs(startMs) ? { timestamp: isoFromMs(startMs) } : {}),
				message: `Started ${link.kind} session ${link.childSessionId}.`,
				observation: {
					results: [{ subagent_trajectory_ref: [childRef(link)] }],
				},
				extra: { cline: { childSessionId: link.childSessionId } },
			},
		});
	}

	const unattachedEvents = iterations.length === 0 ? session.events : [];
	const ordered = pending
		.map((item, seq) => ({ ...item, seq }))
		.sort((a, b) => a.order - b.order || a.seq - b.seq);
	const steps: AtifStep[] = ordered.map((item, index) => ({
		step_id: index + 1,
		...item.step,
	}));
	if (steps.length === 0) {
		steps.push({
			step_id: 1,
			source: "system",
			...(normalizeIso(entry.startedAt)
				? { timestamp: normalizeIso(entry.startedAt) }
				: {}),
			message: "The session has no messages.",
		});
	}

	const subagents = childLinks
		.map((link) => state.sessions.get(link.childSessionId))
		.filter((child): child is LoadedSessionReplaySession => !!child)
		.sort(
			(a, b) =>
				(msFromIso(a.entry.startedAt) ?? 0) -
				(msFromIso(b.entry.startedAt) ?? 0),
		)
		.map((child) => buildTrajectory(state, child.entry.sessionId, false));

	const modelName =
		str(entry.model) ??
		messages.find((message) => message.modelInfo?.id)?.modelInfo?.id;
	const tools = toolDefinitions(session);
	const { manifest } = state.bundle;
	const agent: AtifAgent = {
		name: state.options.agentName ?? "cline",
		version:
			state.options.agentVersion ??
			manifest.producer.hostVersion ??
			manifest.producer.version,
		...(modelName ? { model_name: modelName } : {}),
		...(tools ? { tool_definitions: tools } : {}),
		extra: {
			cline: nonEmpty({
				provider: str(entry.provider),
				agentId: entry.agentId ?? undefined,
				role: entry.role,
				producer: manifest.producer,
			}),
		},
	};
	return {
		schema_version: ATIF_SCHEMA_VERSION,
		session_id: sessionId,
		trajectory_id: sessionId,
		agent,
		steps,
		final_metrics: finalMetrics(steps, subagents),
		extra: sessionExtra(state, session, isRoot, unattachedEvents),
		...(subagents.length > 0 ? { subagent_trajectories: subagents } : {}),
	};
}

/** Drops binary floating-point noise from summed costs. */
function roundCost(value: number | undefined): number | undefined {
	return value === undefined ? undefined : Math.round(value * 1e12) / 1e12;
}

function finalMetrics(
	steps: readonly AtifStep[],
	subagents: readonly AtifTrajectory[],
): AtifFinalMetrics {
	const sum = (pick: (metrics: AtifMetrics) => unknown) => {
		let total: number | undefined;
		for (const step of steps) {
			const value = step.metrics ? pick(step.metrics) : undefined;
			if (typeof value === "number") total = (total ?? 0) + value;
		}
		return total;
	};
	const ownCost = roundCost(sum((metrics) => metrics.cost_usd));
	const subagentCosts = subagents
		.map((sub) => sub.final_metrics?.total_cost_usd)
		.filter((value): value is number => typeof value === "number");
	const subagentCost = roundCost(
		subagentCosts.length > 0
			? subagentCosts.reduce((total, value) => total + value, 0)
			: undefined,
	);
	const totalCost = roundCost(
		ownCost === undefined && subagentCost === undefined
			? undefined
			: (ownCost ?? 0) + (subagentCost ?? 0),
	);
	const cacheWrite = sum(
		(metrics) => metrics.extra?.cache_creation_input_tokens,
	);
	return {
		...nonEmpty({
			total_prompt_tokens: sum((metrics) => metrics.prompt_tokens),
			total_completion_tokens: sum((metrics) => metrics.completion_tokens),
			total_cached_tokens: sum((metrics) => metrics.cached_tokens),
			total_cost_usd: totalCost,
		}),
		total_steps: steps.length,
		...(cacheWrite !== undefined || subagentCost !== undefined
			? {
					extra: nonEmpty({
						cache_creation_input_tokens: cacheWrite,
						own_cost_usd: subagentCost !== undefined ? ownCost : undefined,
						subagent_cost_usd: subagentCost,
					}),
				}
			: {}),
	};
}

/**
 * Converts a loaded session replay bundle into one ATIF v1.7 trajectory for
 * its root session. Each model call becomes an agent step holding its tool
 * calls and their results; prompts become user steps; injected messages,
 * notices and compactions become system steps. Subagent and teammate
 * sessions in the bundle are embedded as `subagent_trajectories` and
 * referenced from the tool call that started them. Cline data without an
 * ATIF field (decisions, hook and runtime events, match keys, environment
 * facts, session metadata) is kept under `extra.cline`.
 */
export function exportSessionReplayBundleToAtif(
	bundle: AtifExportBundle,
	options: ExportSessionReplayAtifOptions = {},
): ExportSessionReplayAtifResult {
	const state: ExportState = {
		bundle,
		options,
		sessions: new Map(
			bundle.sessions.map((session) => [session.entry.sessionId, session]),
		),
		links: [],
		missing: new Map(),
		omittedImages: 0,
		warnings: [],
	};
	if (!state.sessions.has(bundle.manifest.rootSessionId)) {
		throw new Error(
			`root session ${bundle.manifest.rootSessionId} is not in the bundle`,
		);
	}
	if (!bundle.redaction.enabled) {
		state.warnings.push(
			"The bundle was exported without redaction; the trajectory carries its values verbatim.",
		);
	}
	resolveChildLinks(state);
	const trajectory = buildTrajectory(
		state,
		bundle.manifest.rootSessionId,
		true,
	);
	const notes = [
		"Exported from a Cline session replay bundle. Cline data without an ATIF field is under extra.cline.",
	];
	if (state.omittedImages > 0) {
		notes.push(
			`${state.omittedImages} image(s) were replaced by text placeholders.`,
		);
		state.warnings.push(
			`${state.omittedImages} image(s) were replaced by text placeholders: ATIF image parts need a file path and the bundle stores images inline.`,
		);
	}
	trajectory.notes = notes.join(" ");
	return {
		trajectory: JSON.parse(JSON.stringify(trajectory)) as AtifTrajectory,
		warnings: state.warnings,
	};
}
