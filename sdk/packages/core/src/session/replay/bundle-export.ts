import { readFile } from "node:fs/promises";
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
	selectSessionHookLogEntries,
	toSessionReplayHookEvents,
} from "./bundle-hook-events";
import {
	type SessionReplayBundleValidationResult,
	validateSessionReplayBundle,
	writeSessionReplayBundle,
} from "./bundle-io";
import { SessionReplayBundleError } from "./bundle-migrations";
import {
	createSessionReplayRedactor,
	type SessionReplayRedactor,
} from "./bundle-redaction";
import {
	SESSION_REPLAY_MANIFEST_FILE,
	type SessionReplayBundleManifest,
	type SessionReplayCheckpointRef,
	type SessionReplaySessionEntry,
	sessionReplayBundlePaths,
} from "./bundle-schema";

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

function buildSessionEntry(input: {
	record: SessionRecord;
	redactor: SessionReplayRedactor;
	eventsSource: SessionReplaySessionEntry["eventsSource"];
	isBundleRoot: boolean;
}): Omit<SessionReplaySessionEntry, "counts"> {
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
		checkpoints: readCheckpointRefs(record.metadata),
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
	const [messages, compaction, systemPrompt, hookLog] = await Promise.all([
		options.source.readMessages(sessionId),
		options.source.readSessionCompactionState?.(sessionId),
		readPersistedSystemPrompt(record),
		selectSessionHookLogEntries({
			rootSessionId: sessionId,
			sessionsDir: options.sessionsDir ?? resolveSessionDataDir(),
			globalLogPath: options.globalHookLogPath,
		}),
	]);
	const warnings: string[] = [];
	if (messages.length === 0) {
		warnings.push(`Session ${sessionId} has no persisted messages.`);
	}
	if (hookLog.source === "none") {
		warnings.push(
			"No hook audit log was found for this session; events.jsonl is empty.",
		);
	}
	if (hookLog.descendantEntries.length > 0) {
		warnings.push(
			`${hookLog.descendantEntries.length} hook event(s) from subagents or teammates were not exported; this bundle contains the root session only.`,
		);
	}

	const redactor = createSessionReplayRedactor({
		enabled: options.redact !== false,
	});
	const transcriptPath = sessionReplayBundlePaths.transcript(sessionId);
	const eventsPath = sessionReplayBundlePaths.events(sessionId);
	const compactionPath = sessionReplayBundlePaths.compaction(sessionId);

	const entry = buildSessionEntry({
		record,
		redactor,
		eventsSource: hookLog.source,
		isBundleRoot: true,
	});
	const transcript = {
		sessionId,
		...(systemPrompt ? { systemPrompt } : {}),
		messages: redactMessageMetadata(messages, redactor, transcriptPath),
	};
	const events = toSessionReplayHookEvents({
		sessionId,
		entries: hookLog.rootEntries,
		redactor,
		file: eventsPath,
	});
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
