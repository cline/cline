import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { resolveSessionDataDir } from "@cline/shared/storage";
import { version as corePackageVersion } from "../../../package.json";
import type { SessionRecord } from "../../types/sessions";
import type { SessionCompactionState } from "../models/session-compaction";
import {
	parseSubSessionId,
	parseTeamTaskSubSessionId,
} from "../models/session-graph";
import {
	isRootAgentHookEntry,
	type RawHookLogEntry,
	selectSessionHookLogEntries,
	toSessionReplayHookEvents,
} from "./bundle-hook-events";
import {
	computeSessionRecordingCoverage,
	type SessionReplayBundleValidationResult,
	validateSessionReplayBundle,
	writeSessionReplayBundle,
} from "./bundle-io";
import { sessionReplayIterationRunCounts } from "./bundle-iterations";
import { SessionReplayBundleError } from "./bundle-migrations";
import {
	mergeSessionReplayEvents,
	readSessionRecording,
	redactSessionRecording,
	toSessionReplayRecordedEvents,
} from "./bundle-recording";
import {
	createSessionReplayRedactor,
	type SessionReplayRedactor,
} from "./bundle-redaction";
import {
	SESSION_REPLAY_MANIFEST_FILE,
	type SessionReplayBundleManifest,
	type SessionReplayCheckpointRef,
	type SessionReplayIterationRestorePoint,
	type SessionReplaySessionEntry,
	sessionReplayBundlePaths,
} from "./bundle-schema";
import { SESSION_RECORDING_VERSION } from "./recording-schema";

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
}): Omit<SessionReplaySessionEntry, "counts" | "recording"> {
	const { record, redactor } = input;
	const manifestPath = (field: string) => `sessions[0].${field}`;
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
		parentSessionId: record.parentSessionId ?? null,
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

/**
 * Builds a session replay bundle for one session from local session storage.
 *
 * The session becomes the bundle root. Subagent and teammate sessions are not
 * exported yet; the format can carry them as additional `sessions[]` entries.
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
	const [messages, compaction, systemPrompt, hookLog, recording] =
		await Promise.all([
			options.source.readMessages(sessionId),
			options.source.readSessionCompactionState?.(sessionId),
			readPersistedSystemPrompt(record),
			selectSessionHookLogEntries({
				rootSessionId: sessionId,
				sessionsDir,
				globalLogPath: options.globalHookLogPath,
			}),
			readSessionRecording(join(sessionsDir, sessionId)),
		]);
	const warnings: string[] = [];
	if (messages.length === 0) {
		warnings.push(`Session ${sessionId} has no persisted messages.`);
	}
	if (hookLog.source === "none" && !recording) {
		warnings.push(
			"No hook audit log was found for this session; events.jsonl is empty.",
		);
	}
	const leadAgentIds = new Set(
		(recording?.header.segments ?? [])
			.map((segment) => segment.leadAgentId)
			.filter((id): id is string => typeof id === "string"),
	);
	const hookEntries = partitionHookEntries(
		[...hookLog.rootEntries, ...hookLog.descendantEntries],
		leadAgentIds,
	);
	if (hookEntries.descendants.length > 0) {
		warnings.push(
			`${hookEntries.descendants.length} hook event(s) from subagents or teammates were not exported; this bundle contains the root session only.`,
		);
	}
	if (recording && recording.skippedLines > 0) {
		warnings.push(
			`${recording.skippedLines} unreadable recording line(s) were skipped.`,
		);
	}

	const redactor = createSessionReplayRedactor({
		enabled: options.redact !== false,
		recorded: recording !== undefined,
	});
	const transcriptPath = sessionReplayBundlePaths.transcript(sessionId);
	const eventsPath = sessionReplayBundlePaths.events(sessionId);
	const compactionPath = sessionReplayBundlePaths.compaction(sessionId);

	const baseEntry = buildSessionEntry({
		record,
		messages,
		redactor,
		eventsSource: hookLog.source,
		isBundleRoot: true,
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
			entries: hookEntries.root,
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
		warnings.push(
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

	const now = options.now?.() ?? new Date();
	const manifest = await writeSessionReplayBundle(
		options.outputDir,
		{
			createdAt: now.toISOString(),
			producer: {
				name: "@cline/core",
				version: corePackageVersion,
				...(options.producer?.host ? { host: options.producer.host } : {}),
				...(options.producer?.hostVersion
					? { hostVersion: options.producer.hostVersion }
					: {}),
			},
			rootSessionId: sessionId,
			sessions: [
				{
					entry,
					transcript,
					events,
					...(redactedCompaction ? { compaction: redactedCompaction } : {}),
					...(recorded
						? { requests: recorded.requests, blobs: recorded.blobs }
						: {}),
				},
			],
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
