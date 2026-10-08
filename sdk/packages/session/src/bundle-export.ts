import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CORE_BUILD_VERSION,
	parseSubSessionId,
	parseTeamTaskSubSessionId,
	type SessionCompactionState,
	type SessionRecord,
} from "@cline/core";
import {
	type MessageWithMetadata,
	SESSION_RECORDING_VERSION,
	SESSION_REPLAY_MANIFEST_FILE,
	type SessionReplayBundleManifest,
	type SessionReplayCheckpointRef,
	type SessionReplayIterationRestorePoint,
	type SessionReplaySessionEntry,
} from "@cline/shared";
import { resolveSessionDataDir } from "@cline/shared/storage";
import {
	isRootAgentHookEntry,
	type RawHookLogEntry,
	selectSessionHookLogEntries,
	toSessionReplayHookEvents,
} from "./bundle-hook-events";
import {
	computeSessionRecordingCoverage,
	type SessionReplayBundleSessionInput,
	type SessionReplayBundleValidationResult,
	validateSessionReplayBundle,
	writeSessionReplayBundle,
} from "./bundle-io";
import { sessionReplayIterationRunCounts } from "./bundle-iterations";
import { sessionReplayBundlePaths } from "./bundle-layout";
import { SessionReplayBundleError } from "./bundle-migrations";
import {
	type LoadedSessionRecording,
	mergeSessionReplayEvents,
	readSessionRecording,
	redactSessionRecording,
	toSessionReplayRecordedEvents,
} from "./bundle-recording";
import {
	createSessionReplayRedactor,
	type SessionReplayRedactor,
} from "./bundle-redaction";

/**
 * Read access to local session storage. `ClineCore` satisfies it through
 * `{ getSession: core.get, readMessages: core.readMessages, readSessionCompactionState: core.readSessionCompactionState }`.
 */
export interface SessionReplayExportSource {
	getSession(sessionId: string): Promise<SessionRecord | undefined>;
	readMessages(sessionId: string): Promise<MessageWithMetadata[]>;
	readSessionCompactionState?(
		sessionId: string,
	): Promise<SessionCompactionState | undefined>;
	/**
	 * Subagent and teammate sessions of a root session. Used with
	 * `includeChildSessions` to find children of sessions written before
	 * messages carried `childSessions` links.
	 */
	listChildSessions?(rootSessionId: string): Promise<SessionRecord[]>;
}

export interface ExportSessionReplayBundleOptions {
	sessionId: string;
	outputDir: string;
	source: SessionReplayExportSource;
	/** Run the redaction pass (default true). */
	redact?: boolean;
	overwrite?: boolean;
	/** Sessions directory holding per-session hook logs. */
	sessionsDir?: string;
	/** Global hook audit log used for sessions without a per-session log. */
	globalHookLogPath?: string;
	producer?: { host?: string; hostVersion?: string };
	now?: () => Date;
	/**
	 * Add the root's subagent and teammate sessions as further bundle
	 * sessions (default false).
	 */
	includeChildSessions?: boolean;
}

export interface ExportSessionReplayBundleResult {
	outputDir: string;
	manifest: SessionReplayBundleManifest;
	validation: SessionReplayBundleValidationResult;
	/** Non-fatal notes about what the bundle could not include. */
	warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function readCheckpointRefs(
	metadata: Record<string, unknown> | undefined,
): SessionReplayCheckpointRef[] {
	const checkpoint = isRecord(metadata?.checkpoint)
		? metadata.checkpoint
		: undefined;
	if (!checkpoint) {
		return [];
	}
	const candidates = [
		...(Array.isArray(checkpoint.history) ? checkpoint.history : []),
		checkpoint.latest,
	];
	const refs = new Map<string, SessionReplayCheckpointRef>();
	for (const candidate of candidates) {
		if (
			!isRecord(candidate) ||
			typeof candidate.ref !== "string" ||
			!candidate.ref ||
			typeof candidate.runCount !== "number" ||
			typeof candidate.createdAt !== "number"
		) {
			continue;
		}
		const kind =
			candidate.kind === "stash" || candidate.kind === "commit"
				? candidate.kind
				: undefined;
		refs.set(`${candidate.runCount}:${candidate.ref}`, {
			ref: candidate.ref,
			runCount: Math.max(0, Math.trunc(candidate.runCount)),
			createdAt: candidate.createdAt,
			...(kind ? { kind } : {}),
		});
	}
	return [...refs.values()].sort((a, b) => a.runCount - b.runCount);
}

/**
 * Maps per-run checkpoints onto the iterations of each run. Only checkpoint
 * data that already exists is used; compaction states are not addressed per
 * iteration yet.
 */
function buildIterationRestorePoints(
	messages: readonly MessageWithMetadata[],
	checkpoints: readonly SessionReplayCheckpointRef[],
): SessionReplayIterationRestorePoint[] {
	const byRun = new Map<number, SessionReplayCheckpointRef>();
	for (const checkpoint of checkpoints) {
		const current = byRun.get(checkpoint.runCount);
		if (!current || checkpoint.createdAt >= current.createdAt) {
			byRun.set(checkpoint.runCount, checkpoint);
		}
	}
	const points: SessionReplayIterationRestorePoint[] = [];
	let previousRun: number | undefined;
	for (const [position, runCount] of sessionReplayIterationRunCounts(
		messages,
	).entries()) {
		const checkpoint = byRun.get(runCount);
		if (checkpoint) {
			points.push({
				index: position + 1,
				checkpoint: {
					...checkpoint,
					capture: runCount === previousRun ? "run-start" : "iteration-start",
				},
			});
		}
		previousRun = runCount;
	}
	return points;
}

function resolveRole(record: SessionRecord): SessionReplaySessionEntry["role"] {
	if (parseTeamTaskSubSessionId(record.sessionId)) {
		return "teammate";
	}
	if (record.isSubagent || parseSubSessionId(record.sessionId)) {
		return "subagent";
	}
	return "root";
}

async function readPersistedSystemPrompt(
	record: SessionRecord,
): Promise<string | undefined> {
	if (record.messagesPath) {
		try {
			const parsed = JSON.parse(
				await readFile(record.messagesPath, "utf8"),
			) as unknown;
			if (isRecord(parsed) && typeof parsed.system_prompt === "string") {
				return parsed.system_prompt;
			}
		} catch {
			// Fall back to session metadata below.
		}
	}
	const fromMetadata = record.metadata?.systemPrompt;
	return typeof fromMetadata === "string" ? fromMetadata : undefined;
}

function redactMessageMetadata(
	messages: readonly MessageWithMetadata[],
	redactor: SessionReplayRedactor,
	file: string,
): MessageWithMetadata[] {
	return messages.map((message, index) =>
		message.metadata
			? {
					...message,
					metadata: redactor.redact(
						message.metadata,
						file,
						`messages[${index}].metadata`,
					),
				}
			: message,
	);
}

/**
 * Splits hook lines into the root agent's and its descendants'. With a
 * recording, root lines are the ones whose agent id is a recorded lead
 * agent; the parent-id inference only applies to lines from unrecorded
 * periods (no `seq`), which predate explicit attribution.
 */
function partitionHookEntries(
	entries: readonly RawHookLogEntry[],
	leadAgentIds: ReadonlySet<string>,
): { root: RawHookLogEntry[]; descendants: RawHookLogEntry[] } {
	const root: RawHookLogEntry[] = [];
	const descendants: RawHookLogEntry[] = [];
	for (const entry of entries) {
		const agentId = typeof entry.agent_id === "string" ? entry.agent_id : "";
		const isRoot =
			leadAgentIds.size > 0 && agentId
				? leadAgentIds.has(agentId) ||
					(typeof entry.seq !== "number" && isRootAgentHookEntry(entry))
				: isRootAgentHookEntry(entry);
		(isRoot ? root : descendants).push(entry);
	}
	return { root, descendants };
}

function buildSessionEntry(input: {
	record: SessionRecord;
	messages: readonly MessageWithMetadata[];
	redactor: SessionReplayRedactor;
	eventsSource: SessionReplaySessionEntry["eventsSource"];
	isBundleRoot: boolean;
	sessionIndex: number;
	parentSessionId: string | null;
}): Omit<SessionReplaySessionEntry, "counts" | "recording"> {
	const { record, redactor } = input;
	const manifestPath = (field: string) =>
		`sessions[${input.sessionIndex}].${field}`;
	const { checkpoint: _checkpoint, title, ...rest } = record.metadata ?? {};
	const metadata =
		Object.keys(rest).length > 0
			? redactor.redact(
					rest,
					SESSION_REPLAY_MANIFEST_FILE,
					manifestPath("metadata"),
				)
			: undefined;
	const checkpoints = readCheckpointRefs(record.metadata);
	const iterations = buildIterationRestorePoints(input.messages, checkpoints);
	return {
		sessionId: record.sessionId,
		role: input.isBundleRoot ? "root" : resolveRole(record),
		parentSessionId: input.parentSessionId,
		agentId: record.agentId ?? null,
		parentAgentId: record.parentAgentId ?? null,
		conversationId: record.conversationId ?? null,
		source: record.source,
		status: record.status,
		exitCode: record.exitCode ?? null,
		startedAt: record.startedAt,
		endedAt: record.endedAt ?? null,
		interactive: record.interactive,
		provider: record.provider,
		model: record.model,
		cwd: redactor.redact(
			record.cwd,
			SESSION_REPLAY_MANIFEST_FILE,
			manifestPath("cwd"),
		),
		workspaceRoot: redactor.redact(
			record.workspaceRoot,
			SESSION_REPLAY_MANIFEST_FILE,
			manifestPath("workspaceRoot"),
		),
		team: record.teamName ? { name: record.teamName } : null,
		checkpoints,
		...(iterations.length > 0 ? { iterations } : {}),
		...(typeof title === "string" && title
			? {
					title: redactor.redact(
						title,
						SESSION_REPLAY_MANIFEST_FILE,
						manifestPath("title"),
					),
				}
			: {}),
		...(metadata ? { metadata } : {}),
		eventsSource: input.eventsSource,
	};
}

interface CollectedSession {
	record: SessionRecord;
	messages: MessageWithMetadata[];
	compaction?: SessionCompactionState;
	systemPrompt?: string;
	recording?: LoadedSessionRecording;
	hookEntries: RawHookLogEntry[];
}

async function collectSession(
	source: SessionReplayExportSource,
	record: SessionRecord,
	sessionsDir: string,
): Promise<CollectedSession> {
	const [messages, compaction, systemPrompt, recording] = await Promise.all([
		source.readMessages(record.sessionId),
		source.readSessionCompactionState?.(record.sessionId),
		readPersistedSystemPrompt(record),
		readSessionRecording(join(sessionsDir, record.sessionId)),
	]);
	return {
		record,
		messages,
		...(compaction ? { compaction } : {}),
		...(systemPrompt ? { systemPrompt } : {}),
		...(recording ? { recording } : {}),
		hookEntries: [],
	};
}

function linkedChildSessionIds(
	messages: readonly MessageWithMetadata[],
): string[] {
	return messages.flatMap(
		(message) => message.childSessions?.map((link) => link.sessionId) ?? [],
	);
}

/**
 * Finds the subagent and teammate sessions of a bundle root: the ones linked
 * from tool calls (`childSessions`, followed recursively) plus any the source
 * lists for the root. Linked sessions that no longer exist are reported.
 */
async function collectChildSessions(input: {
	source: SessionReplayExportSource;
	root: CollectedSession;
	sessionsDir: string;
	warnings: string[];
}): Promise<CollectedSession[]> {
	const { source, root } = input;
	const seen = new Set<string>([root.record.sessionId]);
	const children: CollectedSession[] = [];
	const listed =
		(await source.listChildSessions?.(root.record.sessionId)) ?? [];
	const pending: Array<{ sessionId: string; record?: SessionRecord }> = [
		...linkedChildSessionIds(root.messages).map((sessionId) => ({
			sessionId,
		})),
		...listed.map((record) => ({ sessionId: record.sessionId, record })),
	];
	while (pending.length > 0) {
		const next = pending.shift();
		if (!next || seen.has(next.sessionId)) {
			continue;
		}
		seen.add(next.sessionId);
		const record = next.record ?? (await source.getSession(next.sessionId));
		if (!record) {
			input.warnings.push(
				`Linked child session ${next.sessionId} was not found and is not in the bundle.`,
			);
			continue;
		}
		const child = await collectSession(source, record, input.sessionsDir);
		children.push(child);
		pending.push(
			...linkedChildSessionIds(child.messages).map((sessionId) => ({
				sessionId,
			})),
		);
	}
	return children.sort((a, b) =>
		a.record.startedAt < b.record.startedAt
			? -1
			: a.record.startedAt > b.record.startedAt
				? 1
				: 0,
	);
}

/**
 * Hands each descendant hook line to the child session of the same agent.
 * A teammate runs one session per task, so lines are matched to the task
 * session whose time window contains them.
 */
function assignDescendantHookEntries(
	entries: readonly RawHookLogEntry[],
	children: readonly CollectedSession[],
): RawHookLogEntry[] {
	const unassigned: RawHookLogEntry[] = [];
	for (const entry of entries) {
		const agentId = typeof entry.agent_id === "string" ? entry.agent_id : "";
		const candidates = children.filter(
			(child) => agentId && child.record.agentId === agentId,
		);
		const ts = typeof entry.ts === "string" ? entry.ts : "";
		const target =
			candidates.length <= 1
				? candidates[0]
				: (candidates.find(
						(child) =>
							child.record.startedAt <= ts &&
							(!child.record.endedAt || ts <= child.record.endedAt),
					) ??
					candidates.filter((child) => child.record.startedAt <= ts).at(-1) ??
					candidates[0]);
		if (target) {
			target.hookEntries.push(entry);
		} else {
			unassigned.push(entry);
		}
	}
	return unassigned;
}

function buildBundleSession(input: {
	session: CollectedSession;
	sessionIndex: number;
	isBundleRoot: boolean;
	parentSessionId: string | null;
	eventsSource: SessionReplaySessionEntry["eventsSource"];
	redactor: SessionReplayRedactor;
	warnings: string[];
}): SessionReplayBundleSessionInput {
	const { session, redactor } = input;
	const { record, messages, recording, compaction, systemPrompt } = session;
	const sessionId = record.sessionId;
	const transcriptPath = sessionReplayBundlePaths.transcript(sessionId);
	const eventsPath = sessionReplayBundlePaths.events(sessionId);
	const compactionPath = sessionReplayBundlePaths.compaction(sessionId);
	if (messages.length === 0) {
		input.warnings.push(`Session ${sessionId} has no persisted messages.`);
	}
	if (recording && recording.skippedLines > 0) {
		input.warnings.push(
			`${recording.skippedLines} unreadable recording line(s) were skipped.`,
		);
	}

	const baseEntry = buildSessionEntry({
		record,
		messages,
		redactor,
		eventsSource: input.eventsSource,
		isBundleRoot: input.isBundleRoot,
		sessionIndex: input.sessionIndex,
		parentSessionId: input.parentSessionId,
	});
	const transcript = {
		sessionId,
		...(systemPrompt ? { systemPrompt } : {}),
		messages: redactMessageMetadata(messages, redactor, transcriptPath),
	};
	const passThrough = createSessionReplayRedactor({ enabled: false });
	const events = mergeSessionReplayEvents(
		toSessionReplayHookEvents({
			sessionId,
			entries: session.hookEntries,
			redactor: passThrough,
			file: eventsPath,
		}),
		toSessionReplayRecordedEvents(recording?.events ?? []),
	).map((event) => ({
		...event,
		payload: redactor.redact(
			event.payload,
			eventsPath,
			`[${event.index}].payload`,
		),
	}));

	const recorded = recording
		? redactSessionRecording({
				recording,
				redactor,
				requestsFile: sessionReplayBundlePaths.requests(sessionId),
				blobsFile: sessionReplayBundlePaths.requestBlobs(sessionId),
				manifestFile: SESSION_REPLAY_MANIFEST_FILE,
				sessionIndex: input.sessionIndex,
			})
		: undefined;
	const entry: Omit<SessionReplaySessionEntry, "counts"> = {
		...baseEntry,
		recording:
			recording && recorded
				? {
						version: SESSION_RECORDING_VERSION,
						segments: recorded.segments,
						counts: {
							modelCalls: recorded.requests.length,
							blobs: recorded.blobs.length,
							decisions: recording.events.filter(
								(event) => event.kind === "decision",
							).length,
							runtimeEvents: recording.events.filter(
								(event) => event.kind === "runtime",
							).length,
						},
						coverage: computeSessionRecordingCoverage({
							transcript,
							requests: recorded.requests,
							initialMessageCount:
								recording.header.segments[0]?.initialMessageCount ?? 0,
						}),
					}
				: null,
	};
	if (
		entry.recording &&
		entry.recording.coverage.unlinkedMessageIds.length > 0
	) {
		input.warnings.push(
			`${entry.recording.coverage.unlinkedMessageIds.length} assistant message(s) written while recording have no request record.`,
		);
	}
	const redactedCompaction = compaction
		? {
				...compaction,
				messages: redactMessageMetadata(
					compaction.messages,
					redactor,
					compactionPath,
				),
			}
		: undefined;
	return {
		entry,
		transcript,
		events,
		...(redactedCompaction ? { compaction: redactedCompaction } : {}),
		...(recorded ? { requests: recorded.requests, blobs: recorded.blobs } : {}),
	};
}

/**
 * Builds a session replay bundle for one session from local session storage.
 *
 * The session becomes the bundle root. With `includeChildSessions`, its
 * subagent and teammate sessions are added as further `sessions[]` entries
 * with their hook events; otherwise those events are left out.
 */
export async function exportSessionReplayBundle(
	options: ExportSessionReplayBundleOptions,
): Promise<ExportSessionReplayBundleResult> {
	const sessionId = options.sessionId.trim();
	if (!sessionId) {
		throw new SessionReplayBundleError("A session id is required.");
	}
	const record = await options.source.getSession(sessionId);
	if (!record) {
		throw new SessionReplayBundleError(`Session ${sessionId} not found.`);
	}
	const sessionsDir = options.sessionsDir ?? resolveSessionDataDir();
	const [root, hookLog] = await Promise.all([
		collectSession(options.source, record, sessionsDir),
		selectSessionHookLogEntries({
			rootSessionId: sessionId,
			sessionsDir,
			globalLogPath: options.globalHookLogPath,
		}),
	]);
	const warnings: string[] = [];
	if (hookLog.source === "none" && !root.recording) {
		warnings.push(
			"No hook audit log was found for this session; events.jsonl is empty.",
		);
	}
	const leadAgentIds = new Set(
		(root.recording?.header.segments ?? [])
			.map((segment) => segment.leadAgentId)
			.filter((id): id is string => typeof id === "string"),
	);
	const hookEntries = partitionHookEntries(
		[...hookLog.rootEntries, ...hookLog.descendantEntries],
		leadAgentIds,
	);
	root.hookEntries = hookEntries.root;
	const children = options.includeChildSessions
		? await collectChildSessions({
				source: options.source,
				root,
				sessionsDir,
				warnings,
			})
		: [];
	const unassigned = assignDescendantHookEntries(
		hookEntries.descendants,
		children,
	);
	if (unassigned.length > 0) {
		warnings.push(
			options.includeChildSessions
				? `${unassigned.length} hook event(s) from subagents or teammates match no exported child session and were not exported.`
				: `${unassigned.length} hook event(s) from subagents or teammates were not exported; this bundle contains the root session only.`,
		);
	}

	const redactor = createSessionReplayRedactor({
		enabled: options.redact !== false,
		recorded: [root, ...children].some((session) => session.recording),
	});
	const sessions = [root, ...children].map((session, sessionIndex) =>
		buildBundleSession({
			session,
			sessionIndex,
			isBundleRoot: sessionIndex === 0,
			parentSessionId:
				sessionIndex === 0
					? (session.record.parentSessionId ?? null)
					: session.record.parentSessionId &&
							children.some(
								(child) =>
									child.record.sessionId === session.record.parentSessionId,
							)
						? session.record.parentSessionId
						: sessionId,
			eventsSource: hookLog.source,
			redactor,
			warnings,
		}),
	);

	const now = options.now?.() ?? new Date();
	const manifest = await writeSessionReplayBundle(
		options.outputDir,
		{
			createdAt: now.toISOString(),
			producer: {
				name: "@cline/core",
				version: CORE_BUILD_VERSION,
				...(options.producer?.host ? { host: options.producer.host } : {}),
				...(options.producer?.hostVersion
					? { hostVersion: options.producer.hostVersion }
					: {}),
			},
			rootSessionId: sessionId,
			sessions,
			redaction: redactor.report(),
		},
		{ overwrite: options.overwrite },
	);
	const validation = await validateSessionReplayBundle(options.outputDir);
	if (!validation.ok) {
		throw new SessionReplayBundleError(
			"The exported bundle failed validation:",
			validation.errors,
		);
	}
	return {
		outputDir: options.outputDir,
		manifest,
		validation,
		warnings,
	};
}
