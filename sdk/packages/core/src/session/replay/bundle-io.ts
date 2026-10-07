import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { SessionCompactionState } from "../models/session-compaction";
import {
	migrateSessionReplayBundleManifest,
	readSessionReplayBundleSchemaVersion,
	SessionReplayBundleError,
	SessionReplayBundleVersionError,
} from "./bundle-migrations";
import {
	SESSION_REPLAY_BUNDLE_FORMAT,
	SESSION_REPLAY_BUNDLE_SCHEMA_VERSION,
	SESSION_REPLAY_MANIFEST_FILE,
	SESSION_REPLAY_REDACTION_FILE,
	type SessionReplayBundleManifest,
	SessionReplayBundleManifestSchema,
	SessionReplayCompactionFileSchema,
	type SessionReplayEvent,
	SessionReplayEventSchema,
	type SessionReplayFileEntry,
	type SessionReplayFileKind,
	type SessionReplayRedactionReport,
	SessionReplayRedactionReportSchema,
	type SessionReplayRequestBlob,
	SessionReplayRequestBlobSchema,
	type SessionReplaySessionEntry,
	type SessionReplayTranscriptFile,
	SessionReplayTranscriptFileSchema,
	sessionReplayBundlePaths,
	sessionReplayFileMediaType,
} from "./bundle-schema";
import {
	resolveRecordedRequestMessages,
	type SessionRecordedModelCall,
	SessionRecordedModelCallSchema,
} from "./recording-schema";

export interface SessionReplayBundleSessionInput {
	entry: Omit<SessionReplaySessionEntry, "counts">;
	transcript: SessionReplayTranscriptFile;
	events: SessionReplayEvent[];
	compaction?: SessionCompactionState;
	/** Request records and blobs; written when `entry.recording` is set. */
	requests?: SessionRecordedModelCall[];
	blobs?: SessionReplayRequestBlob[];
}

export interface WriteSessionReplayBundleInput {
	createdAt: string;
	producer: SessionReplayBundleManifest["producer"];
	rootSessionId: string;
	sessions: SessionReplayBundleSessionInput[];
	redaction: SessionReplayRedactionReport;
	environment?: Record<string, unknown>;
}

export interface WriteSessionReplayBundleOptions {
	/**
	 * Replace an existing bundle at the target. Only directories that already
	 * hold a session replay bundle manifest are replaced; any other non-empty
	 * directory is refused.
	 */
	overwrite?: boolean;
}

export interface LoadedSessionReplaySession {
	entry: SessionReplaySessionEntry;
	transcript: SessionReplayTranscriptFile;
	events: SessionReplayEvent[];
	compaction?: SessionCompactionState;
	/** Request records in `callIndex` order; empty for unrecorded sessions. */
	requests: SessionRecordedModelCall[];
	/** Request blobs by sha256. */
	blobs: Map<string, SessionReplayRequestBlob>;
}

export interface LoadedSessionReplayBundle {
	dir: string;
	manifest: SessionReplayBundleManifest;
	sessions: LoadedSessionReplaySession[];
	redaction: SessionReplayRedactionReport;
	/** Schema version the bundle was written with, before migration. */
	sourceSchemaVersion: number;
}

export interface SessionReplayBundleValidationResult {
	ok: boolean;
	errors: string[];
	warnings: string[];
	sourceSchemaVersion?: number;
	manifest?: SessionReplayBundleManifest;
}

function sha256(contents: string): string {
	return createHash("sha256").update(contents, "utf8").digest("hex");
}

function countAssistantMessages(
	transcript: SessionReplayTranscriptFile,
): number {
	return transcript.messages.filter((message) => message.role === "assistant")
		.length;
}

function serializeJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function serializeJsonl(values: readonly unknown[]): string {
	return values.map((value) => `${JSON.stringify(value)}\n`).join("");
}

async function prepareTargetDir(
	dir: string,
	overwrite: boolean,
): Promise<void> {
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
		return;
	}
	const existing = await readdir(dir);
	if (existing.length === 0) {
		return;
	}
	const manifestPath = join(dir, SESSION_REPLAY_MANIFEST_FILE);
	if (!overwrite) {
		throw new SessionReplayBundleError(
			`Bundle directory ${dir} is not empty. Choose an empty directory or pass overwrite to replace an existing bundle.`,
		);
	}
	let isBundle = false;
	try {
		const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
		readSessionReplayBundleSchemaVersion(raw, Number.MAX_SAFE_INTEGER);
		isBundle = true;
	} catch {
		isBundle = false;
	}
	if (!isBundle) {
		throw new SessionReplayBundleError(
			`Refusing to overwrite ${dir}: it is not empty and does not contain a session replay bundle.`,
		);
	}
	await Promise.all(
		existing.map((name) => rm(join(dir, name), { recursive: true })),
	);
}

/**
 * Writes a bundle to `dir`. Data files are written first and the manifest
 * last, so a directory with a manifest always has its indexed files.
 */
export async function writeSessionReplayBundle(
	dir: string,
	input: WriteSessionReplayBundleInput,
	options: WriteSessionReplayBundleOptions = {},
): Promise<SessionReplayBundleManifest> {
	const root = resolve(dir);
	await prepareTargetDir(root, options.overwrite === true);
	const files: SessionReplayFileEntry[] = [];

	const writeFileEntry = async (
		path: string,
		kind: SessionReplayFileKind,
		contents: string,
		extra: { sessionId?: string; entries?: number } = {},
	): Promise<void> => {
		const absolute = join(root, ...path.split("/"));
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, contents, "utf8");
		files.push({
			path,
			kind,
			...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
			mediaType: sessionReplayFileMediaType(kind),
			bytes: Buffer.byteLength(contents, "utf8"),
			sha256: sha256(contents),
			...(extra.entries !== undefined ? { entries: extra.entries } : {}),
		});
	};

	const sessions: SessionReplaySessionEntry[] = [];
	for (const session of input.sessions) {
		const { sessionId } = session.entry;
		await writeFileEntry(
			sessionReplayBundlePaths.transcript(sessionId),
			"transcript",
			serializeJson(session.transcript),
			{ sessionId, entries: session.transcript.messages.length },
		);
		await writeFileEntry(
			sessionReplayBundlePaths.events(sessionId),
			"events",
			serializeJsonl(session.events),
			{ sessionId, entries: session.events.length },
		);
		if (session.compaction) {
			await writeFileEntry(
				sessionReplayBundlePaths.compaction(sessionId),
				"compaction",
				serializeJson(session.compaction),
				{ sessionId },
			);
		}
		if (session.entry.recording) {
			const blobs = session.blobs ?? [];
			const requests = session.requests ?? [];
			await writeFileEntry(
				sessionReplayBundlePaths.requestBlobs(sessionId),
				"request-blobs",
				serializeJsonl(blobs),
				{ sessionId, entries: blobs.length },
			);
			await writeFileEntry(
				sessionReplayBundlePaths.requests(sessionId),
				"request",
				serializeJsonl(requests),
				{ sessionId, entries: requests.length },
			);
		}
		sessions.push({
			...session.entry,
			counts: {
				messages: session.transcript.messages.length,
				iterations: countAssistantMessages(session.transcript),
				events: session.events.length,
			},
		});
	}

	await writeFileEntry(
		SESSION_REPLAY_REDACTION_FILE,
		"redaction-report",
		serializeJson(input.redaction),
		{ entries: input.redaction.redactions.length },
	);

	const manifest = SessionReplayBundleManifestSchema.parse({
		format: SESSION_REPLAY_BUNDLE_FORMAT,
		schemaVersion: SESSION_REPLAY_BUNDLE_SCHEMA_VERSION,
		createdAt: input.createdAt,
		producer: input.producer,
		rootSessionId: input.rootSessionId,
		sessions,
		files,
		redaction: {
			enabled: input.redaction.enabled,
			removedCount: input.redaction.redactions.length,
			report: SESSION_REPLAY_REDACTION_FILE,
		},
		...(input.environment ? { environment: input.environment } : {}),
	} satisfies SessionReplayBundleManifest);
	await writeFile(
		join(root, SESSION_REPLAY_MANIFEST_FILE),
		serializeJson(manifest),
		"utf8",
	);
	return manifest;
}

function formatZodIssues(
	label: string,
	error: {
		issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
	},
): string[] {
	return error.issues.map((issue) => {
		const path = issue.path.map(String).join(".");
		return `${label}${path ? ` ${path}` : ""}: ${issue.message}`;
	});
}

interface BundleInspection {
	errors: string[];
	warnings: string[];
	sourceSchemaVersion?: number;
	manifest?: SessionReplayBundleManifest;
	sessions: LoadedSessionReplaySession[];
	redaction?: SessionReplayRedactionReport;
}

function resolveInside(root: string, relativePath: string): string | undefined {
	const absolute = resolve(root, ...relativePath.split("/"));
	return absolute.startsWith(`${root}${sep}`) ? absolute : undefined;
}

async function inspectSessionReplayBundle(
	dir: string,
): Promise<BundleInspection> {
	const root = resolve(dir);
	const inspection: BundleInspection = {
		errors: [],
		warnings: [],
		sessions: [],
	};
	const { errors, warnings } = inspection;

	let rawManifest: unknown;
	try {
		rawManifest = JSON.parse(
			await readFile(join(root, SESSION_REPLAY_MANIFEST_FILE), "utf8"),
		);
	} catch (error) {
		const code = (error as { code?: unknown }).code;
		errors.push(
			code === "ENOENT"
				? `No ${SESSION_REPLAY_MANIFEST_FILE} in ${root}: not a session replay bundle.`
				: `Could not read ${SESSION_REPLAY_MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return inspection;
	}

	// Version refusals propagate as SessionReplayBundleVersionError so hosts
	// can surface the upgrade message verbatim.
	let migrated: ReturnType<typeof migrateSessionReplayBundleManifest>;
	try {
		migrated = migrateSessionReplayBundleManifest(rawManifest);
	} catch (error) {
		if (
			error instanceof SessionReplayBundleVersionError ||
			!(error instanceof SessionReplayBundleError)
		) {
			throw error;
		}
		errors.push(error.message);
		return inspection;
	}
	inspection.sourceSchemaVersion = migrated.fromVersion;
	const parsedManifest = SessionReplayBundleManifestSchema.safeParse(
		migrated.manifest,
	);
	if (!parsedManifest.success) {
		errors.push(...formatZodIssues("manifest", parsedManifest.error));
		return inspection;
	}
	const manifest = parsedManifest.data;
	inspection.manifest = manifest;

	const sessionIds = new Set<string>();
	for (const session of manifest.sessions) {
		if (sessionIds.has(session.sessionId)) {
			errors.push(`manifest: duplicate session ${session.sessionId}`);
		}
		sessionIds.add(session.sessionId);
	}
	const rootEntry = manifest.sessions.find(
		(session) => session.sessionId === manifest.rootSessionId,
	);
	if (!rootEntry) {
		errors.push(
			`manifest: rootSessionId ${manifest.rootSessionId} is not listed in sessions`,
		);
	}
	for (const session of manifest.sessions) {
		if (session.sessionId === manifest.rootSessionId) {
			continue;
		}
		if (!session.parentSessionId || !sessionIds.has(session.parentSessionId)) {
			errors.push(
				`manifest: session ${session.sessionId} must have a parentSessionId listed in the bundle`,
			);
		}
	}

	const contentsByPath = new Map<string, string>();
	const seenPaths = new Set<string>();
	for (const file of manifest.files) {
		if (seenPaths.has(file.path)) {
			errors.push(`files: duplicate entry ${file.path}`);
			continue;
		}
		seenPaths.add(file.path);
		if (file.sessionId && !sessionIds.has(file.sessionId)) {
			errors.push(
				`files: ${file.path} references unknown session ${file.sessionId}`,
			);
		}
		const absolute = resolveInside(root, file.path);
		if (!absolute) {
			errors.push(`files: ${file.path} resolves outside the bundle`);
			continue;
		}
		let contents: string;
		try {
			contents = await readFile(absolute, "utf8");
		} catch {
			errors.push(`files: ${file.path} is missing`);
			continue;
		}
		if (Buffer.byteLength(contents, "utf8") !== file.bytes) {
			errors.push(`files: ${file.path} size does not match the manifest`);
		}
		if (sha256(contents) !== file.sha256) {
			errors.push(`files: ${file.path} sha256 does not match the manifest`);
		}
		contentsByPath.set(file.path, contents);
	}

	const parseJsonFile = (path: string): unknown => {
		try {
			return JSON.parse(contentsByPath.get(path) ?? "");
		} catch (error) {
			errors.push(
				`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
			);
			return undefined;
		}
	};

	const reportFile = manifest.files.find(
		(file) => file.path === manifest.redaction.report,
	);
	if (!reportFile || reportFile.kind !== "redaction-report") {
		errors.push(
			`manifest: redaction report ${manifest.redaction.report} is not indexed as a redaction-report file`,
		);
	} else if (contentsByPath.has(reportFile.path)) {
		const parsed = SessionReplayRedactionReportSchema.safeParse(
			parseJsonFile(reportFile.path),
		);
		if (parsed.success) {
			inspection.redaction = parsed.data;
			if (parsed.data.enabled !== manifest.redaction.enabled) {
				errors.push(
					`${reportFile.path}: enabled does not match manifest.redaction.enabled`,
				);
			}
			if (parsed.data.redactions.length !== manifest.redaction.removedCount) {
				errors.push(
					`${reportFile.path}: redaction count does not match manifest.redaction.removedCount`,
				);
			}
		} else {
			errors.push(...formatZodIssues(reportFile.path, parsed.error));
		}
	}

	for (const entry of manifest.sessions) {
		const sessionFiles = manifest.files.filter(
			(file) => file.sessionId === entry.sessionId,
		);
		const byKind = (kind: SessionReplayFileKind) =>
			sessionFiles.filter((file) => file.kind === kind);
		const transcripts = byKind("transcript");
		const eventFiles = byKind("events");
		const compactions = byKind("compaction");
		if (transcripts.length !== 1) {
			errors.push(
				`session ${entry.sessionId}: expected exactly one transcript file, found ${transcripts.length}`,
			);
		}
		if (eventFiles.length > 1) {
			errors.push(
				`session ${entry.sessionId}: expected at most one events file, found ${eventFiles.length}`,
			);
		}
		if (compactions.length > 1) {
			errors.push(
				`session ${entry.sessionId}: expected at most one compaction file, found ${compactions.length}`,
			);
		}

		const transcriptFile = transcripts[0];
		if (!transcriptFile || !contentsByPath.has(transcriptFile.path)) {
			continue;
		}
		const transcript = SessionReplayTranscriptFileSchema.safeParse(
			parseJsonFile(transcriptFile.path),
		);
		if (!transcript.success) {
			errors.push(...formatZodIssues(transcriptFile.path, transcript.error));
			continue;
		}
		if (transcript.data.sessionId !== entry.sessionId) {
			errors.push(
				`${transcriptFile.path}: sessionId ${transcript.data.sessionId} does not match session ${entry.sessionId}`,
			);
		}

		const events: SessionReplayEvent[] = [];
		const eventFile = eventFiles[0];
		if (eventFile && contentsByPath.has(eventFile.path)) {
			const lines = (contentsByPath.get(eventFile.path) ?? "")
				.split("\n")
				.filter((line) => line.trim().length > 0);
			for (const [lineIndex, line] of lines.entries()) {
				let raw: unknown;
				try {
					raw = JSON.parse(line);
				} catch {
					errors.push(`${eventFile.path}:${lineIndex + 1}: invalid JSON`);
					continue;
				}
				const parsed = SessionReplayEventSchema.safeParse(raw);
				if (!parsed.success) {
					errors.push(
						...formatZodIssues(
							`${eventFile.path}:${lineIndex + 1}`,
							parsed.error,
						),
					);
					continue;
				}
				if (parsed.data.sessionId !== entry.sessionId) {
					errors.push(
						`${eventFile.path}:${lineIndex + 1}: event belongs to session ${parsed.data.sessionId}`,
					);
				}
				events.push(parsed.data);
			}
		} else if (!eventFile) {
			warnings.push(`session ${entry.sessionId}: no events file`);
		}

		let compaction: SessionCompactionState | undefined;
		const compactionFile = compactions[0];
		if (compactionFile && contentsByPath.has(compactionFile.path)) {
			const parsed = SessionReplayCompactionFileSchema.safeParse(
				parseJsonFile(compactionFile.path),
			);
			if (parsed.success) {
				compaction = parsed.data;
			} else {
				errors.push(...formatZodIssues(compactionFile.path, parsed.error));
			}
		}

		const parseJsonl = <T>(
			file: SessionReplayFileEntry | undefined,
			schema: {
				safeParse(value: unknown):
					| { success: true; data: T }
					| {
							success: false;
							error: {
								issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
							};
					  };
			},
		): T[] => {
			if (!file || !contentsByPath.has(file.path)) return [];
			const out: T[] = [];
			const lines = (contentsByPath.get(file.path) ?? "")
				.split("\n")
				.filter((line) => line.trim().length > 0);
			for (const [lineIndex, line] of lines.entries()) {
				let raw: unknown;
				try {
					raw = JSON.parse(line);
				} catch {
					errors.push(`${file.path}:${lineIndex + 1}: invalid JSON`);
					continue;
				}
				const parsed = schema.safeParse(raw);
				if (parsed.success) {
					out.push(parsed.data);
				} else {
					errors.push(
						...formatZodIssues(`${file.path}:${lineIndex + 1}`, parsed.error),
					);
				}
			}
			return out;
		};

		const requestFiles = byKind("request");
		const blobFiles = byKind("request-blobs");
		if (requestFiles.length > 1 || blobFiles.length > 1) {
			errors.push(
				`session ${entry.sessionId}: expected at most one request and one request-blobs file`,
			);
		}
		if (entry.recording && (!requestFiles[0] || !blobFiles[0])) {
			errors.push(
				`session ${entry.sessionId}: recorded session is missing its request or request-blobs file`,
			);
		}
		if (!entry.recording && (requestFiles[0] || blobFiles[0])) {
			errors.push(
				`session ${entry.sessionId}: request files present but sessions[].recording is null`,
			);
		}
		const requests = parseJsonl(
			requestFiles[0],
			SessionRecordedModelCallSchema,
		);
		const blobs = new Map<string, SessionReplayRequestBlob>();
		for (const blob of parseJsonl(
			blobFiles[0],
			SessionReplayRequestBlobSchema,
		)) {
			if (blobs.has(blob.sha256)) {
				errors.push(`${blobFiles[0]?.path}: duplicate blob ${blob.sha256}`);
			}
			if (
				!blob.redacted &&
				sha256(JSON.stringify(blob.value)) !== blob.sha256
			) {
				errors.push(
					`${blobFiles[0]?.path}: blob ${blob.sha256} does not match its value`,
				);
			}
			blobs.set(blob.sha256, blob);
		}
		if (entry.recording) {
			validateRecording({
				entry,
				transcript: transcript.data,
				events,
				requests,
				blobs,
				requestPath: requestFiles[0]?.path ?? "requests",
				errors,
				warnings,
			});
		}
		requests.sort((left, right) => left.callIndex - right.callIndex);

		inspection.sessions.push({
			entry,
			transcript: transcript.data,
			events,
			...(compaction ? { compaction } : {}),
			requests,
			blobs,
		});
	}

	return inspection;
}

/**
 * Cross-file checks for a recorded session: request records name existing
 * blobs, ordering keys are unique, each record has its `model_finished`
 * event, and every assistant message written while recording maps to
 * exactly one record.
 */
function validateRecording(input: {
	entry: SessionReplaySessionEntry;
	transcript: SessionReplayTranscriptFile;
	events: readonly SessionReplayEvent[];
	requests: readonly SessionRecordedModelCall[];
	blobs: ReadonlyMap<string, SessionReplayRequestBlob>;
	requestPath: string;
	errors: string[];
	warnings: string[];
}): void {
	const { entry, requests, blobs, requestPath, errors, warnings } = input;
	const recording = entry.recording;
	if (!recording) return;
	if (recording.counts.modelCalls !== requests.length) {
		errors.push(
			`session ${entry.sessionId}: recording.counts.modelCalls is ${recording.counts.modelCalls}, found ${requests.length} records`,
		);
	}
	const eventSeqs = new Set<number>();
	const modelFinished = new Map<number, SessionReplayEvent>();
	for (const event of input.events) {
		if (event.seq !== undefined) {
			if (eventSeqs.has(event.seq)) {
				errors.push(
					`session ${entry.sessionId}: duplicate event seq ${event.seq}`,
				);
			}
			eventSeqs.add(event.seq);
		}
		if (event.kind === "runtime" && event.name === "model_finished") {
			const callIndex = event.refs?.modelCallIndex;
			if (typeof callIndex === "number") modelFinished.set(callIndex, event);
		}
	}
	const callIndexes = new Set<number>();
	const recordsByMessageId = new Map<string, SessionRecordedModelCall[]>();
	for (const record of requests) {
		const label = `${requestPath} callIndex ${record.callIndex}`;
		if (record.sessionId !== entry.sessionId) {
			errors.push(`${label}: belongs to session ${record.sessionId}`);
		}
		if (callIndexes.has(record.callIndex)) {
			errors.push(`${label}: duplicate callIndex`);
		}
		callIndexes.add(record.callIndex);
		const refs = [
			record.request.systemPromptSha256,
			record.request.toolsSha256,
			record.request.modelToolsSha256,
			...record.request.messageSha256s,
		];
		for (const ref of refs) {
			if (ref && !blobs.has(ref)) {
				errors.push(`${label}: references missing blob ${ref}`);
			}
		}
		const finished = modelFinished.get(record.callIndex);
		if (!finished) {
			warnings.push(`${label}: no model_finished event`);
		} else if (finished.seq !== record.seq) {
			errors.push(
				`${label}: seq ${record.seq} does not match its model_finished event (${finished.seq})`,
			);
		}
		if (record.response.messageId) {
			const list = recordsByMessageId.get(record.response.messageId) ?? [];
			list.push(record);
			recordsByMessageId.set(record.response.messageId, list);
		}
	}
	for (const error of resolveRecordedRequestMessages(requests).errors) {
		errors.push(`${requestPath}: ${error}`);
	}

	const preRecording = recording.segments[0]?.initialMessageCount ?? 0;
	for (const [index, message] of input.transcript.messages.entries()) {
		if (message.role !== "assistant" || index < preRecording || !message.id) {
			continue;
		}
		const records = recordsByMessageId.get(message.id) ?? [];
		if (records.length > 1) {
			errors.push(
				`session ${entry.sessionId}: assistant message ${message.id} is claimed by ${records.length} request records`,
			);
		}
	}
	if (recording.coverage.unlinkedMessageIds.length > 0) {
		warnings.push(
			`session ${entry.sessionId}: ${recording.coverage.unlinkedMessageIds.length} assistant message(s) written while recording have no request record`,
		);
	}
}

/**
 * Maps the transcript's assistant messages onto request records by message
 * id. Used by the exporter to fill `sessions[].recording.coverage`.
 */
export function computeSessionRecordingCoverage(input: {
	transcript: SessionReplayTranscriptFile;
	requests: readonly SessionRecordedModelCall[];
	initialMessageCount: number;
}): NonNullable<SessionReplaySessionEntry["recording"]>["coverage"] {
	const recorded = new Set(
		input.requests
			.map((record) => record.response.messageId)
			.filter((id): id is string => typeof id === "string"),
	);
	let assistantMessages = 0;
	let preRecording = 0;
	let linked = 0;
	const unlinkedMessageIds: string[] = [];
	for (const [index, message] of input.transcript.messages.entries()) {
		if (message.role !== "assistant") continue;
		assistantMessages += 1;
		if (index < input.initialMessageCount) {
			preRecording += 1;
		} else if (message.id && recorded.has(message.id)) {
			linked += 1;
		} else {
			unlinkedMessageIds.push(message.id ?? `#${index}`);
		}
	}
	return { assistantMessages, preRecording, linked, unlinkedMessageIds };
}

/**
 * Checks a bundle against the schema: manifest shape and version, file
 * integrity (presence, size, sha256), per-file schemas, and session tree
 * links. Throws {@link SessionReplayBundleVersionError} for bundles newer
 * than this build; every other problem is reported in `errors`.
 */
export async function validateSessionReplayBundle(
	dir: string,
): Promise<SessionReplayBundleValidationResult> {
	const inspection = await inspectSessionReplayBundle(dir);
	return {
		ok: inspection.errors.length === 0,
		errors: inspection.errors,
		warnings: inspection.warnings,
		...(inspection.sourceSchemaVersion !== undefined
			? { sourceSchemaVersion: inspection.sourceSchemaVersion }
			: {}),
		...(inspection.manifest ? { manifest: inspection.manifest } : {}),
	};
}

/** Reads and validates a bundle, throwing when it is not valid. */
export async function readSessionReplayBundle(
	dir: string,
): Promise<LoadedSessionReplayBundle> {
	const inspection = await inspectSessionReplayBundle(dir);
	if (
		inspection.errors.length > 0 ||
		!inspection.manifest ||
		!inspection.redaction ||
		inspection.sourceSchemaVersion === undefined
	) {
		throw new SessionReplayBundleError(
			`Invalid session replay bundle at ${resolve(dir)}:`,
			inspection.errors,
		);
	}
	return {
		dir: resolve(dir),
		manifest: inspection.manifest,
		sessions: inspection.sessions,
		redaction: inspection.redaction,
		sourceSchemaVersion: inspection.sourceSchemaVersion,
	};
}
