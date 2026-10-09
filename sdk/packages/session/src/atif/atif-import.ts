import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CORE_BUILD_VERSION } from "@cline/core";
import {
	type ContentBlock,
	groupSessionMessageIterations,
	type MessageChildSessionLink,
	type MessageWithMetadata,
	SESSION_REPLAY_BUNDLE_FORMAT,
	SESSION_REPLAY_BUNDLE_SCHEMA_VERSION,
	SESSION_REPLAY_REDACTION_FILE,
	type SessionRecordedModelCall,
	SessionRecordedModelCallSchema,
	type SessionReplayBundleManifest,
	type SessionReplayEvent,
	SessionReplayEventSchema,
	type SessionReplayRedactionReport,
	SessionReplayRedactionReportSchema,
	type SessionReplayRequestBlob,
	SessionReplayRequestBlobSchema,
	type SessionReplaySessionEntry,
	SessionReplaySessionEntrySchema,
	SessionReplayTranscriptFileSchema,
} from "@cline/shared";
import {
	type LoadedSessionReplaySession,
	type SessionReplayBundleSessionInput,
	validateSessionReplayBundle,
	type WriteSessionReplayBundleInput,
	writeSessionReplayBundle,
} from "../bundle-io";
import { SessionReplayCompactionFileSchema } from "../bundle-layout";
import { SessionReplayBundleError } from "../bundle-migrations";
import {
	ATIF_CLINE_REPLAY_DATA_VERSION,
	type AtifExportBundle,
	exportSessionReplayBundleToAtif,
} from "./atif-export";
import type {
	AtifContent,
	AtifExtra,
	AtifStep,
	AtifSubagentTrajectoryRef,
	AtifTrajectory,
} from "./atif-types";
import { validateAtifTrajectory } from "./atif-validate";

/** `sessions[].source` of sessions rebuilt from ATIF steps. */
export const ATIF_IMPORT_SOURCE = "atif-import";
/** Written next to the manifest of an imported bundle; not indexed in it. */
export const ATIF_IMPORT_REPORT_FILE = "import-report.json";
export const ATIF_IMPORT_REPORT_FORMAT = "cline.atif-import-report";
export const ATIF_IMPORT_REPORT_VERSION = 1;

/** The input is not a valid ATIF trajectory; `issues` lists why. */
export class AtifImportError extends SessionReplayBundleError {
	constructor(message: string, issues: readonly string[] = []) {
		super(message, issues);
		this.name = "AtifImportError";
	}
}

/** One kind of ATIF data the import could not carry, or had to interpret. */
export interface AtifImportUnmapped {
	sessionId: string;
	/** ATIF location, e.g. `steps[].metrics.logprobs`. */
	field: string;
	reason: string;
	count: number;
	/** Up to 20 `step_id`s where it occurred. */
	stepIds?: number[];
}

export interface AtifImportReport {
	format: typeof ATIF_IMPORT_REPORT_FORMAT;
	version: typeof ATIF_IMPORT_REPORT_VERSION;
	/** `schema_version` of the file, when it names one. */
	schemaVersion: string | null;
	trajectoryId: string | null;
	rootSessionId: string;
	agent: { name: string; version: string };
	/**
	 * `extra.cline`: the bundle data a Cline export embedded was restored
	 * exactly. `steps`: sessions were rebuilt from the ATIF steps.
	 */
	restored: "extra.cline" | "steps";
	sessions: Array<{
		sessionId: string;
		trajectoryId: string | null;
		parentSessionId: string | null;
		steps: number;
		messages: number;
	}>;
	/** Data the bundle does not carry. */
	unmapped: AtifImportUnmapped[];
	/** Data the import carried by interpreting it, e.g. a result without `source_call_id`. */
	assumptions: AtifImportUnmapped[];
	warnings: string[];
}

export interface ImportAtifTrajectoryOptions {
	/** Bundle `createdAt` for rebuilt sessions, and their start when no step has a timestamp. */
	now?: () => Date;
	producer?: { host?: string; hostVersion?: string };
	/**
	 * `auto` (default): restore the bundle data a Cline export embedded in
	 * `extra.cline` when it reproduces the file's steps, else rebuild from the
	 * steps. `steps`: always rebuild from the steps.
	 */
	restore?: "auto" | "steps";
}

export interface ImportAtifTrajectoryResult {
	bundle: WriteSessionReplayBundleInput;
	report: AtifImportReport;
}

type TextBlock = Extract<ContentBlock, { type: "text" }>;
type ToolUseBlock = Extract<ContentBlock, { type: "tool_use" }>;
type ToolResultBlock = Extract<ContentBlock, { type: "tool_result" }>;

const MAX_STEP_IDS = 20;
const MAX_SESSION_ID_LENGTH = 120;
const SYSTEM_STEP_KIND = "atif_system_step";
const OBSERVATION_KIND = "atif_observation";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function msFromIso(value: string | null | undefined): number | undefined {
	if (!value) return undefined;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : undefined;
}

function clineOf(
	holder: { extra?: AtifExtra | null } | null | undefined,
): Record<string, unknown> | undefined {
	const cline = holder?.extra?.cline;
	return isRecord(cline) ? cline : undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T | undefined {
	const entries = Object.entries(value).filter(
		([, item]) => item !== undefined,
	);
	return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

function flatten(
	trajectory: AtifTrajectory,
	out: AtifTrajectory[] = [],
): AtifTrajectory[] {
	out.push(trajectory);
	for (const child of trajectory.subagent_trajectories ?? []) {
		flatten(child, out);
	}
	return out;
}

function hasStepMetrics(trajectory: AtifTrajectory): boolean {
	return (
		trajectory.steps.some((step) => !!step.metrics) ||
		(trajectory.subagent_trajectories ?? []).some(hasStepMetrics)
	);
}

function trajectoryLabel(trajectory: AtifTrajectory): string {
	return trajectory.trajectory_id ?? trajectory.session_id ?? "(unnamed)";
}

// ── Restoring a Cline export ─────────────────────────────────────────────

type Restored =
	| { ok: true; bundle: WriteSessionReplayBundleInput }
	| { ok: false; reason?: string };

function zodIssues(
	label: string,
	error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> },
): string {
	const [issue] = error.issues;
	const path = issue?.path.map(String).join(".");
	return `${label}${path ? ` ${path}` : ""}: ${issue?.message ?? "invalid"}`;
}

function parseList<T>(
	label: string,
	value: unknown,
	schema: {
		safeParse(item: unknown):
			| { success: true; data: T }
			| {
					success: false;
					error: {
						issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
					};
			  };
	},
): T[] | string {
	if (!Array.isArray(value)) return `${label} is not a list`;
	const out: T[] = [];
	for (const [index, item] of value.entries()) {
		const parsed = schema.safeParse(item);
		if (!parsed.success) return zodIssues(`${label}[${index}]`, parsed.error);
		out.push(parsed.data);
	}
	return out;
}

function restoreSession(
	trajectory: AtifTrajectory,
): LoadedSessionReplaySession | string {
	const label = `trajectory ${trajectoryLabel(trajectory)}`;
	const cline = clineOf(trajectory);
	const replay = cline?.replay;
	if (!isRecord(replay)) return `${label} has no extra.cline.replay`;
	if (replay.version !== ATIF_CLINE_REPLAY_DATA_VERSION) {
		return `${label} has extra.cline.replay version ${String(replay.version)}; this build reads version ${ATIF_CLINE_REPLAY_DATA_VERSION}`;
	}
	const recording = isRecord(cline?.recording)
		? {
				...cline.recording,
				segments: isRecord(cline?.environment)
					? cline.environment.segments
					: undefined,
			}
		: null;
	const entry = SessionReplaySessionEntrySchema.safeParse({
		...(isRecord(cline?.session) ? cline.session : {}),
		recording,
	});
	if (!entry.success) {
		return zodIssues(`${label} extra.cline.session`, entry.error);
	}
	const transcript = SessionReplayTranscriptFileSchema.safeParse(
		replay.transcript,
	);
	if (!transcript.success) {
		return zodIssues(
			`${label} extra.cline.replay.transcript`,
			transcript.error,
		);
	}
	if (transcript.data.sessionId !== entry.data.sessionId) {
		return `${label}: the transcript belongs to session ${transcript.data.sessionId}, not ${entry.data.sessionId}`;
	}
	const events = parseList<SessionReplayEvent>(
		`${label} extra.cline.replay.events`,
		replay.events,
		SessionReplayEventSchema,
	);
	if (typeof events === "string") return events;
	const requests = parseList<SessionRecordedModelCall>(
		`${label} extra.cline.replay.requests`,
		replay.requests ?? [],
		SessionRecordedModelCallSchema,
	);
	if (typeof requests === "string") return requests;
	const blobs = parseList<SessionReplayRequestBlob>(
		`${label} extra.cline.replay.blobs`,
		replay.blobs ?? [],
		SessionReplayRequestBlobSchema,
	);
	if (typeof blobs === "string") return blobs;
	if (entry.data.recording && replay.requests === undefined) {
		return `${label} is recorded but extra.cline.replay has no requests`;
	}
	let compaction: LoadedSessionReplaySession["compaction"];
	if (replay.compaction !== undefined) {
		const parsed = SessionReplayCompactionFileSchema.safeParse(
			replay.compaction,
		);
		if (!parsed.success) {
			return zodIssues(`${label} extra.cline.replay.compaction`, parsed.error);
		}
		compaction = parsed.data;
	}
	return {
		entry: entry.data,
		transcript: transcript.data,
		events,
		...(compaction ? { compaction } : {}),
		requests: [...requests].sort((a, b) => a.callIndex - b.callIndex),
		blobs: new Map(blobs.map((blob) => [blob.sha256, blob])),
	};
}

/** What a step says, without Cline's annotations or system notices. */
function stepFingerprints(steps: readonly AtifStep[]): string[] {
	return steps
		.filter((step) => step.source !== "system")
		.map((step) =>
			JSON.stringify([
				step.source,
				step.message,
				step.reasoning_content ?? null,
				(step.tool_calls ?? []).map((call) => [
					call.tool_call_id,
					call.function_name,
					call.arguments,
				]),
				(step.observation?.results ?? []).map((result) => [
					result.source_call_id ?? null,
					result.content ?? null,
				]),
			]),
		);
}

function firstTreeMismatch(
	file: AtifTrajectory,
	rebuilt: AtifTrajectory,
): string | undefined {
	const a = stepFingerprints(file.steps);
	const b = stepFingerprints(rebuilt.steps);
	const label = `trajectory ${trajectoryLabel(file)}`;
	if (a.length !== b.length) {
		return `${label} has ${a.length} user and agent steps, but its extra.cline.replay data gives ${b.length}`;
	}
	const index = a.findIndex((value, position) => value !== b[position]);
	if (index >= 0) {
		return `${label}: user or agent step ${index + 1} differs from its extra.cline.replay data`;
	}
	const fileChildren = file.subagent_trajectories ?? [];
	const rebuiltChildren = rebuilt.subagent_trajectories ?? [];
	if (fileChildren.length !== rebuiltChildren.length) {
		return `${label} embeds ${fileChildren.length} subagent trajectories, but its extra.cline.replay data gives ${rebuiltChildren.length}`;
	}
	for (const child of fileChildren) {
		const match = rebuiltChildren.find(
			(candidate) => candidate.trajectory_id === child.trajectory_id,
		);
		if (!match) {
			return `subagent trajectory ${trajectoryLabel(child)} is not reproduced by the extra.cline.replay data`;
		}
		const mismatch = firstTreeMismatch(child, match);
		if (mismatch) return mismatch;
	}
	return undefined;
}

function restoreFromClineExtra(trajectory: AtifTrajectory): Restored {
	const all = flatten(trajectory);
	if (!all.some((item) => isRecord(clineOf(item)?.replay))) {
		return { ok: false };
	}
	const fail = (reason: string): Restored => ({
		ok: false,
		reason: `The extra.cline replay data could not be restored: ${reason}.`,
	});
	const bundleData = clineOf(trajectory)?.bundle;
	if (!isRecord(bundleData)) {
		return fail("the root trajectory has no extra.cline.bundle");
	}
	const sessions: LoadedSessionReplaySession[] = [];
	for (const item of all) {
		const session = restoreSession(item);
		if (typeof session === "string") return fail(session);
		sessions.push(session);
	}
	const ids = sessions.map((session) => session.entry.sessionId);
	if (new Set(ids).size !== ids.length) {
		return fail("two trajectories carry the same session");
	}
	const rootSessionId = ids[0] ?? "";
	const order = bundleData.sessions;
	if (
		Array.isArray(order) &&
		order.length === ids.length &&
		order.every((id) => typeof id === "string" && ids.includes(id))
	) {
		sessions.sort(
			(a, b) =>
				order.indexOf(a.entry.sessionId) - order.indexOf(b.entry.sessionId),
		);
	}

	const redactionData = isRecord(bundleData.redaction)
		? bundleData.redaction
		: {};
	const redaction = SessionReplayRedactionReportSchema.safeParse({
		enabled: redactionData.enabled,
		ruleset: redactionData.ruleset,
		rules: redactionData.rules,
		covered: redactionData.covered,
		notCovered: redactionData.notCovered,
		redactions: redactionData.redactions,
	});
	if (!redaction.success) {
		return fail(zodIssues("extra.cline.bundle.redaction", redaction.error));
	}
	const producer = bundleData.producer;
	const createdAt = str(bundleData.createdAt);
	if (
		!createdAt ||
		!isRecord(producer) ||
		!str(producer.name) ||
		typeof producer.version !== "string"
	) {
		return fail("extra.cline.bundle has no createdAt or producer");
	}
	const manifestProducer: SessionReplayBundleManifest["producer"] = {
		name: producer.name as string,
		version: producer.version,
		...(str(producer.host) ? { host: producer.host as string } : {}),
		...(str(producer.hostVersion)
			? { hostVersion: producer.hostVersion as string }
			: {}),
	};
	const environment = isRecord(bundleData.environment)
		? bundleData.environment
		: undefined;

	const exportBundle: AtifExportBundle = {
		manifest: {
			format: SESSION_REPLAY_BUNDLE_FORMAT,
			schemaVersion: SESSION_REPLAY_BUNDLE_SCHEMA_VERSION,
			createdAt,
			producer: manifestProducer,
			rootSessionId,
			sessions: sessions.map((session) => session.entry),
			files: [],
			redaction: {
				enabled: redaction.data.enabled,
				removedCount: redaction.data.redactions.length,
				report: SESSION_REPLAY_REDACTION_FILE,
			},
			...(environment ? { environment } : {}),
		},
		sessions,
		redaction: redaction.data,
		sourceSchemaVersion:
			typeof bundleData.sourceSchemaVersion === "number"
				? bundleData.sourceSchemaVersion
				: SESSION_REPLAY_BUNDLE_SCHEMA_VERSION,
	};
	let rebuilt: AtifTrajectory;
	try {
		rebuilt = exportSessionReplayBundleToAtif(exportBundle, {
			includeReplayData: false,
		}).trajectory;
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
	const mismatch = firstTreeMismatch(trajectory, rebuilt);
	if (mismatch) return fail(mismatch);

	return {
		ok: true,
		bundle: {
			createdAt,
			producer: manifestProducer,
			rootSessionId,
			sessions: sessions.map(
				({ entry: { counts: _counts, ...entry }, blobs, ...session }) => ({
					...session,
					entry,
					blobs: [...blobs.values()],
				}),
			),
			redaction: redaction.data,
			...(environment ? { environment } : {}),
		},
	};
}

// ── Rebuilding sessions from steps ───────────────────────────────────────

interface StepsState {
	now: Date;
	usedIds: Set<string>;
	sessions: SessionReplayBundleSessionInput[];
	reportSessions: AtifImportReport["sessions"];
	unmapped: Map<string, AtifImportUnmapped>;
	assumptions: Map<string, AtifImportUnmapped>;
}

function note(
	state: StepsState,
	sessionId: string,
	field: string,
	reason: string,
	stepId?: number,
	list: "unmapped" | "assumptions" = "unmapped",
): void {
	const target = state[list];
	const key = `${sessionId}\u0000${field}`;
	const entry = target.get(key) ?? {
		sessionId,
		field,
		reason,
		count: 0,
	};
	entry.count += 1;
	if (stepId !== undefined) {
		const stepIds = entry.stepIds ?? [];
		if (stepIds.length < MAX_STEP_IDS && !stepIds.includes(stepId)) {
			stepIds.push(stepId);
		}
		entry.stepIds = stepIds;
	}
	target.set(key, entry);
}

function claimSessionId(
	state: StepsState,
	candidate: string | null | undefined,
	fallback: string,
): string {
	let base = (candidate?.trim() || fallback).slice(0, MAX_SESSION_ID_LENGTH);
	if (base === "." || base === "..") base = fallback;
	let id = base;
	for (let n = 2; state.usedIds.has(id); n += 1) id = `${base}__${n}`;
	state.usedIds.add(id);
	return id;
}

interface StepContext {
	state: StepsState;
	sessionId: string;
	stepId: number;
}

/** Text pieces of ATIF content; images become placeholders. */
function contentPieces(
	context: StepContext,
	content: AtifContent | null | undefined,
): string[] {
	if (content === null || content === undefined) return [];
	if (typeof content === "string") return [content];
	return content.map((part) => {
		if (part.type === "text") return part.text;
		note(
			context.state,
			context.sessionId,
			"image content",
			"Images are referenced by file path in ATIF; the bundle keeps a text placeholder.",
			context.stepId,
		);
		return `[image ${part.source.media_type}: ${part.source.path}]`;
	});
}

function textBlocks(pieces: readonly string[]): TextBlock[] {
	return pieces
		.filter((text) => text.length > 0)
		.map((text) => ({ type: "text", text }));
}

function isErrorResult(extra: AtifExtra | null | undefined): boolean {
	const cline = isRecord(extra?.cline) ? extra.cline : undefined;
	return (
		cline?.isError === true ||
		extra?.is_error === true ||
		extra?.isError === true
	);
}

function stepMetrics(
	context: StepContext,
	step: AtifStep,
): MessageWithMetadata["metrics"] | undefined {
	const metrics = step.metrics;
	if (!metrics) return undefined;
	const lost = (
		["prompt_token_ids", "completion_token_ids", "logprobs"] as const
	).filter((key) => (metrics[key]?.length ?? 0) > 0);
	for (const key of lost) {
		note(
			context.state,
			context.sessionId,
			`steps[].metrics.${key}`,
			"Token ids and log probabilities have no place in a bundle.",
			context.stepId,
		);
	}
	const number = (value: unknown) =>
		typeof value === "number" && Number.isFinite(value) ? value : undefined;
	return compact({
		inputTokens: number(metrics.prompt_tokens),
		outputTokens: number(metrics.completion_tokens),
		cacheReadTokens: number(metrics.cached_tokens),
		cacheWriteTokens: number(metrics.extra?.cache_creation_input_tokens),
		cost: number(metrics.cost_usd),
	});
}

function stepMetadata(
	step: AtifStep,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		atif: compact({
			stepId: step.step_id,
			source: step.source,
			...(step.reasoning_effort !== undefined && step.reasoning_effort !== null
				? { reasoningEffort: step.reasoning_effort }
				: {}),
			...(step.is_copied_context ? { copiedContext: true } : {}),
			...(step.extra ? { extra: step.extra } : {}),
			...extra,
		}),
	};
}

interface ChildRef {
	index: number;
	kind: MessageChildSessionLink["kind"];
}

function mapTrajectory(
	state: StepsState,
	trajectory: AtifTrajectory,
	sessionId: string,
	parent: { sessionId: string; kind: MessageChildSessionLink["kind"] } | null,
): void {
	const children = trajectory.subagent_trajectories ?? [];
	const childIds = children.map((child, index) =>
		claimSessionId(
			state,
			child.session_id ?? child.trajectory_id,
			`${sessionId}__subagent_${index + 1}`,
		),
	);
	const childKinds = new Map<number, MessageChildSessionLink["kind"]>();
	const resolveRef = (
		context: StepContext,
		ref: AtifSubagentTrajectoryRef,
	): ChildRef | undefined => {
		let index = ref.trajectory_id
			? children.findIndex((child) => child.trajectory_id === ref.trajectory_id)
			: -1;
		if (index < 0 && ref.session_id) {
			index = children.findIndex(
				(child) => child.session_id === ref.session_id,
			);
		}
		if (index < 0) {
			note(
				state,
				sessionId,
				ref.trajectory_path
					? "subagent_trajectory_ref[].trajectory_path"
					: "subagent_trajectory_ref[]",
				ref.trajectory_path
					? "Subagent trajectories in separate files are not loaded."
					: "The reference names no embedded subagent trajectory.",
				context.stepId,
			);
			return undefined;
		}
		const cline = isRecord(ref.extra?.cline) ? ref.extra.cline : undefined;
		const kind = cline?.kind === "teammate" ? "teammate" : "subagent";
		if (!childKinds.has(index)) childKinds.set(index, kind);
		return { index, kind: childKinds.get(index) ?? kind };
	};

	const startMs =
		trajectory.steps
			.map((step) => msFromIso(step.timestamp))
			.find((ms) => ms !== undefined) ?? state.now.getTime();
	let lastMs = startMs;
	let endMs: number | undefined;
	const systemPrompt: string[] = [];
	const messages: MessageWithMetadata[] = [];
	let conversationStarted = false;
	const agentCline = clineOf(trajectory.agent);
	const provider = str(agentCline?.provider) ?? "";
	const modelProvider = provider || trajectory.agent.name;
	let metricsSeen = false;

	for (const step of trajectory.steps) {
		const context: StepContext = { state, sessionId, stepId: step.step_id };
		const stepMs = msFromIso(step.timestamp);
		if (stepMs !== undefined) endMs = stepMs;
		const ts = stepMs ?? lastMs;
		lastMs = ts;
		const id = `${sessionId}:step-${step.step_id}`;
		const results = step.observation?.results ?? [];

		if (step.source === "system") {
			const isPrompt =
				clineOf(step)?.kind === "system-prompt" ||
				(!conversationStarted && results.length === 0);
			if (isPrompt) {
				systemPrompt.push(contentPieces(context, step.message).join("\n"));
				continue;
			}
			const pieces = [
				...contentPieces(context, step.message),
				...results.flatMap((result) => contentPieces(context, result.content)),
			];
			for (const result of results) {
				for (const ref of result.subagent_trajectory_ref ?? []) {
					resolveRef(context, ref);
				}
			}
			const blocks = textBlocks(pieces);
			if (blocks.length === 0) continue;
			messages.push({
				id,
				role: "user",
				content: blocks,
				ts,
				metadata: {
					kind: SYSTEM_STEP_KIND,
					userRunSpan: 0,
					...stepMetadata(step),
				},
			});
			continue;
		}

		conversationStarted = true;
		if (step.source === "user") {
			const pieces = [
				...contentPieces(context, step.message),
				...results.flatMap((result) => contentPieces(context, result.content)),
			];
			const blocks = textBlocks(pieces);
			messages.push({
				id,
				role: "user",
				content: blocks.length > 0 ? blocks : [{ type: "text", text: "" }],
				ts,
				metadata: stepMetadata(step),
			});
			continue;
		}

		if ((step.llm_call_count ?? 1) > 1) {
			note(
				state,
				sessionId,
				"steps[].llm_call_count",
				"A step that stands for several model calls becomes one assistant message.",
				step.step_id,
			);
		}
		const toolCalls = step.tool_calls ?? [];
		const toolUses: ToolUseBlock[] = toolCalls.map((call) => ({
			type: "tool_use",
			id: call.tool_call_id,
			name: call.function_name,
			input: call.arguments,
		}));
		const callsById = new Map(
			toolCalls.map((call) => [call.tool_call_id, call]),
		);
		const content: ContentBlock[] = [
			...(step.reasoning_content
				? [{ type: "thinking" as const, thinking: step.reasoning_content }]
				: []),
			...textBlocks(contentPieces(context, step.message)),
			...toolUses,
		];
		const childSessions: MessageChildSessionLink[] = [];
		const toolResults: ToolResultBlock[] = [];
		const resultTexts: TextBlock[] = [];
		const answered = new Set<string>();
		// Agents such as Terminus 2 leave `source_call_id` unset; a step with a
		// single tool call and no attributed result is read as that call's result.
		const onlyCall =
			toolCalls.length === 1 &&
			results.every((result) => !result.source_call_id)
				? toolCalls[0]
				: undefined;
		const unattributed = onlyCall
			? results.filter(
					(result) => result.content !== null && result.content !== undefined,
				)
			: [];
		if (onlyCall && unattributed.length > 0) {
			note(
				state,
				sessionId,
				"observation.results[] without source_call_id",
				"Attached to the step's only tool call as its result.",
				step.step_id,
				"assumptions",
			);
			answered.add(onlyCall.tool_call_id);
			toolResults.push({
				type: "tool_result",
				tool_use_id: onlyCall.tool_call_id,
				name: onlyCall.function_name,
				content: unattributed
					.map((result) => contentPieces(context, result.content).join("\n"))
					.join("\n"),
				...(unattributed.some((result) => isErrorResult(result.extra))
					? { is_error: true }
					: {}),
			});
		}
		for (const result of results) {
			if (onlyCall && unattributed.includes(result)) {
				for (const ref of result.subagent_trajectory_ref ?? []) {
					const child = resolveRef(context, ref);
					const childId = child ? childIds[child.index] : undefined;
					if (child && childId) {
						childSessions.push({
							toolCallId: onlyCall.tool_call_id,
							sessionId: childId,
							kind: child.kind,
						});
					}
				}
				continue;
			}
			const callId = result.source_call_id ?? undefined;
			const call = callId ? callsById.get(callId) : undefined;
			const text = contentPieces(context, result.content).join("\n");
			if (call && callId) {
				answered.add(callId);
				toolResults.push({
					type: "tool_result",
					tool_use_id: callId,
					name: call.function_name,
					content: text,
					...(isErrorResult(result.extra) ? { is_error: true } : {}),
				});
			} else if (result.content !== null && result.content !== undefined) {
				resultTexts.push(...textBlocks([text]));
			}
			for (const ref of result.subagent_trajectory_ref ?? []) {
				const child = resolveRef(context, ref);
				if (!child) continue;
				const childId = childIds[child.index];
				if (call && callId && childId) {
					childSessions.push({
						toolCallId: callId,
						sessionId: childId,
						kind: child.kind,
					});
				}
			}
		}
		for (const call of toolCalls) {
			if (!answered.has(call.tool_call_id)) {
				note(
					state,
					sessionId,
					"steps[].tool_calls (without a result)",
					"The tool call has no observation result; the transcript has no tool_result for it.",
					step.step_id,
				);
			}
		}
		const metrics = stepMetrics(context, step);
		if (metrics) metricsSeen = true;
		const modelId = str(step.model_name) ?? str(trajectory.agent.model_name);
		const callExtras = Object.fromEntries(
			toolCalls.flatMap((call) =>
				call.extra ? [[call.tool_call_id, call.extra]] : [],
			),
		);
		const resultExtras = results.flatMap((result) =>
			result.extra ? [result.extra] : [],
		);
		messages.push({
			id,
			role: "assistant",
			content: content.length > 0 ? content : [{ type: "text", text: "" }],
			ts,
			...(modelId
				? { modelInfo: { id: modelId, provider: modelProvider } }
				: {}),
			...(metrics ? { metrics } : {}),
			...(childSessions.length > 0 ? { childSessions } : {}),
			metadata: stepMetadata(step, {
				...(Object.keys(callExtras).length > 0
					? { toolCallExtra: callExtras }
					: {}),
				...(resultExtras.length > 0 ? { resultExtra: resultExtras } : {}),
			}),
		});
		if (toolResults.length > 0 || resultTexts.length > 0) {
			messages.push({
				id: `${id}:observation`,
				role: "user",
				content: [...toolResults, ...resultTexts],
				ts,
				metadata: {
					kind: OBSERVATION_KIND,
					userRunSpan: 0,
					atif: { stepId: step.step_id, observation: true },
				},
			});
		}
	}

	for (const [position, group] of groupSessionMessageIterations(
		messages,
	).entries()) {
		for (let index = group.start; index < group.end; index += 1) {
			const message = messages[index];
			if (message) message.iteration = position + 1;
		}
	}

	if ((trajectory.agent.tool_definitions?.length ?? 0) > 0) {
		note(
			state,
			sessionId,
			"agent.tool_definitions",
			"Tool definitions are part of recorded requests, which an import cannot create.",
		);
	}
	if (trajectory.continued_trajectory_ref) {
		note(
			state,
			sessionId,
			"continued_trajectory_ref",
			"Continuation trajectories in separate files are not loaded.",
		);
	}
	const totals = trajectory.final_metrics;
	if (
		!metricsSeen &&
		!children.some(hasStepMetrics) &&
		totals &&
		[
			totals.total_prompt_tokens,
			totals.total_completion_tokens,
			totals.total_cost_usd,
		].some((value) => typeof value === "number")
	) {
		note(
			state,
			sessionId,
			"final_metrics",
			"Totals without per-step metrics cannot be attributed to messages.",
		);
	}
	children.forEach((_child, index) => {
		if (!childKinds.has(index)) {
			note(
				state,
				sessionId,
				"subagent_trajectories (not referenced)",
				"No step references this subagent trajectory; it is linked to the session without a tool call.",
			);
		}
	});

	const model =
		str(trajectory.agent.model_name) ??
		trajectory.steps.map((step) => str(step.model_name)).find(Boolean) ??
		"";
	const trajectoryCline = clineOf(trajectory);
	const otherExtra = trajectory.extra
		? Object.fromEntries(
				Object.entries(trajectory.extra).filter(([key]) => key !== "cline"),
			)
		: {};
	const entry: Omit<SessionReplaySessionEntry, "counts"> = {
		sessionId,
		role: parent
			? parent.kind === "teammate"
				? "teammate"
				: "subagent"
			: "root",
		parentSessionId: parent?.sessionId ?? null,
		agentId: null,
		parentAgentId: null,
		conversationId: null,
		source: ATIF_IMPORT_SOURCE,
		status: "completed",
		exitCode: null,
		startedAt: new Date(startMs).toISOString(),
		endedAt: endMs !== undefined ? new Date(endMs).toISOString() : null,
		interactive: false,
		provider,
		model: model ?? "",
		cwd: "",
		workspaceRoot: "",
		team: null,
		checkpoints: [],
		metadata: {
			atif: compact({
				schemaVersion: trajectory.schema_version ?? undefined,
				sessionId: trajectory.session_id ?? undefined,
				trajectoryId: trajectory.trajectory_id ?? undefined,
				agent: compact({
					name: trajectory.agent.name,
					version: trajectory.agent.version,
					extra: trajectory.agent.extra ?? undefined,
				}),
				notes: trajectory.notes ?? undefined,
				extra: Object.keys(otherExtra).length > 0 ? otherExtra : undefined,
				clineSession: isRecord(trajectoryCline?.session)
					? trajectoryCline.session
					: undefined,
			}),
		},
		eventsSource: "none",
		recording: null,
	};
	state.sessions.push({
		entry,
		transcript: {
			sessionId,
			...(systemPrompt.length > 0
				? { systemPrompt: systemPrompt.join("\n\n") }
				: {}),
			messages,
		},
		events: [],
	});
	state.reportSessions.push({
		sessionId,
		trajectoryId: trajectory.trajectory_id ?? null,
		parentSessionId: parent?.sessionId ?? null,
		steps: trajectory.steps.length,
		messages: messages.length,
	});
	children.forEach((child, index) => {
		const childId = childIds[index];
		if (!childId) return;
		mapTrajectory(state, child, childId, {
			sessionId,
			kind: childKinds.get(index) ?? "subagent",
		});
	});
}

function importRedactionReport(
	trajectory: AtifTrajectory,
): SessionReplayRedactionReport {
	const bundle = clineOf(trajectory)?.bundle;
	const recorded =
		isRecord(bundle) && isRecord(bundle.redaction)
			? bundle.redaction
			: undefined;
	const strings = (value: unknown) =>
		Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string")
			: [];
	return {
		enabled: recorded?.enabled === true,
		ruleset: "vcr-sanitizer",
		rules: { keysExact: [], keySuffixes: [], valuePatterns: [] },
		covered: strings(recorded?.covered),
		notCovered: [
			...strings(recorded?.notCovered),
			"Imported from an ATIF trajectory: values are kept as they appear in the file; this import ran no redaction.",
		],
		redactions: [],
	};
}

/**
 * Converts an ATIF trajectory into the input of a schema v2 session replay
 * bundle. A trajectory exported by Cline with its replay data
 * (`extra.cline.replay`) is restored exactly, recording included, as long as
 * that data still reproduces the file's steps. Any other trajectory is
 * rebuilt from its steps: system steps before the conversation become the
 * system prompt, user steps and later system steps user messages, agent steps
 * assistant messages (text, `reasoning_content` as thinking, tool calls) with
 * their observation results as `tool_result` blocks, and embedded
 * `subagent_trajectories` child sessions. Such sessions have
 * `source: "atif-import"` and no recording; what could not be carried is
 * listed in the report.
 *
 * Throws {@link AtifImportError} when the input is not a valid ATIF trajectory.
 */
export function importAtifTrajectory(
	value: unknown,
	options: ImportAtifTrajectoryOptions = {},
): ImportAtifTrajectoryResult {
	const validation = validateAtifTrajectory(value);
	if (!validation.ok) {
		throw new AtifImportError(
			"The input is not a valid ATIF trajectory:",
			validation.errors,
		);
	}
	const trajectory = value as AtifTrajectory;
	const warnings: string[] = [];
	const base = {
		format: ATIF_IMPORT_REPORT_FORMAT,
		version: ATIF_IMPORT_REPORT_VERSION,
		schemaVersion: trajectory.schema_version ?? null,
		trajectoryId: trajectory.trajectory_id ?? null,
		agent: {
			name: trajectory.agent.name,
			version: trajectory.agent.version,
		},
	} as const;

	if (options.restore !== "steps") {
		const restored = restoreFromClineExtra(trajectory);
		if (restored.ok) {
			const stepsBySession = new Map(
				flatten(trajectory).map((item) => [
					str(clineOf(item)?.session && (clineOf(item)?.session as never)) ??
						(isRecord(clineOf(item)?.session)
							? String(
									(clineOf(item)?.session as Record<string, unknown>).sessionId,
								)
							: ""),
					item,
				]),
			);
			return {
				bundle: restored.bundle,
				report: {
					...base,
					rootSessionId: restored.bundle.rootSessionId,
					restored: "extra.cline",
					sessions: restored.bundle.sessions.map((session) => {
						const source = stepsBySession.get(session.entry.sessionId);
						return {
							sessionId: session.entry.sessionId,
							trajectoryId: source?.trajectory_id ?? null,
							parentSessionId: session.entry.parentSessionId,
							steps: source?.steps.length ?? 0,
							messages: session.transcript.messages.length,
						};
					}),
					unmapped: [],
					assumptions: [],
					warnings,
				},
			};
		}
		if (restored.reason) {
			warnings.push(
				`${restored.reason} The sessions were rebuilt from the steps.`,
			);
		}
	}

	const now = options.now?.() ?? new Date();
	const state: StepsState = {
		now,
		usedIds: new Set(),
		sessions: [],
		reportSessions: [],
		unmapped: new Map(),
		assumptions: new Map(),
	};
	const rootSessionId = claimSessionId(
		state,
		trajectory.session_id ?? trajectory.trajectory_id,
		"atif-session",
	);
	mapTrajectory(state, trajectory, rootSessionId, null);
	const unmapped = [...state.unmapped.values()];
	if (unmapped.length > 0) {
		warnings.push(
			`${unmapped.reduce((sum, item) => sum + item.count, 0)} ATIF value(s) could not be carried into the bundle; see the import report.`,
		);
	}
	return {
		bundle: {
			createdAt: now.toISOString(),
			producer: {
				name: "@cline/session",
				version: CORE_BUILD_VERSION,
				...(options.producer?.host ? { host: options.producer.host } : {}),
				...(options.producer?.hostVersion
					? { hostVersion: options.producer.hostVersion }
					: {}),
			},
			rootSessionId,
			sessions: state.sessions,
			redaction: importRedactionReport(trajectory),
		},
		report: {
			...base,
			rootSessionId,
			restored: "steps",
			sessions: state.reportSessions,
			unmapped,
			assumptions: [...state.assumptions.values()],
			warnings,
		},
	};
}

export interface ImportAtifTrajectoryToBundleResult {
	dir: string;
	manifest: SessionReplayBundleManifest;
	report: AtifImportReport;
	/** Report warnings, then bundle validation warnings. */
	warnings: string[];
}

/**
 * Imports an ATIF trajectory (see {@link importAtifTrajectory}) and writes it
 * as a bundle to `dir`, with the import report in `import-report.json` next
 * to the manifest. The written bundle is validated.
 */
export async function importAtifTrajectoryToBundle(
	value: unknown,
	dir: string,
	options: ImportAtifTrajectoryOptions & { overwrite?: boolean } = {},
): Promise<ImportAtifTrajectoryToBundleResult> {
	const { bundle, report } = importAtifTrajectory(value, options);
	const root = resolve(dir);
	const manifest = await writeSessionReplayBundle(root, bundle, {
		overwrite: options.overwrite === true,
	});
	await writeFile(
		join(root, ATIF_IMPORT_REPORT_FILE),
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8",
	);
	const validation = await validateSessionReplayBundle(root);
	if (!validation.ok) {
		throw new SessionReplayBundleError(
			"The imported bundle failed validation:",
			validation.errors,
		);
	}
	return {
		dir: root,
		manifest,
		report,
		warnings: [...report.warnings, ...validation.warnings],
	};
}
