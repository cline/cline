import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionReplayRedactor } from "./bundle-redaction";
import type {
	SessionReplayEvent,
	SessionReplayRequestBlob,
	SessionReplaySessionRecording,
} from "./bundle-schema";
import {
	SESSION_RECORDING_DIR,
	SESSION_RECORDING_FILES,
	type SessionRecordedBlob,
	SessionRecordedBlobSchema,
	type SessionRecordedEvent,
	SessionRecordedEventSchema,
	type SessionRecordedModelCall,
	SessionRecordedModelCallSchema,
	type SessionRecordingHeader,
	SessionRecordingHeaderSchema,
} from "./recording-schema";

export interface LoadedSessionRecording {
	header: SessionRecordingHeader;
	requests: SessionRecordedModelCall[];
	blobs: SessionRecordedBlob[];
	events: SessionRecordedEvent[];
	/** Lines that did not parse (e.g. a torn last line after a crash). */
	skippedLines: number;
}

async function readJsonl<T>(
	path: string,
	schema: {
		safeParse(value: unknown): { success: true; data: T } | { success: false };
	},
): Promise<{ values: T[]; skipped: number }> {
	if (!existsSync(path)) return { values: [], skipped: 0 };
	const values: T[] = [];
	let skipped = 0;
	for (const line of (await readFile(path, "utf8")).split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed = schema.safeParse(JSON.parse(line));
			if (parsed.success) values.push(parsed.data);
			else skipped += 1;
		} catch {
			skipped += 1;
		}
	}
	return { values, skipped };
}

/** Reads `<session-dir>/recording/`; undefined when the session was not recorded. */
export async function readSessionRecording(
	sessionDir: string,
): Promise<LoadedSessionRecording | undefined> {
	const dir = join(sessionDir, SESSION_RECORDING_DIR);
	const headerPath = join(dir, SESSION_RECORDING_FILES.header);
	if (!existsSync(headerPath)) return undefined;
	let header: SessionRecordingHeader;
	try {
		const parsed = SessionRecordingHeaderSchema.safeParse(
			JSON.parse(await readFile(headerPath, "utf8")),
		);
		if (!parsed.success) return undefined;
		header = parsed.data;
	} catch {
		return undefined;
	}
	const [requests, blobs, events] = await Promise.all([
		readJsonl(
			join(dir, SESSION_RECORDING_FILES.requests),
			SessionRecordedModelCallSchema,
		),
		readJsonl(
			join(dir, SESSION_RECORDING_FILES.blobs),
			SessionRecordedBlobSchema,
		),
		readJsonl(
			join(dir, SESSION_RECORDING_FILES.events),
			SessionRecordedEventSchema,
		),
	]);
	return {
		header,
		requests: requests.values.sort((a, b) => a.callIndex - b.callIndex),
		blobs: blobs.values,
		events: events.values,
		skippedLines: requests.skipped + blobs.skipped + events.skipped,
	};
}

/** Recorded events as bundle events; payloads are redacted later, by final index. */
export function toSessionReplayRecordedEvents(
	events: readonly SessionRecordedEvent[],
): SessionReplayEvent[] {
	return events.map((event) => ({
		index: 0,
		seq: event.seq,
		ts: event.ts,
		kind: event.kind,
		name: event.name,
		sessionId: event.sessionId,
		agentId: event.agentId,
		...(event.iteration !== undefined ? { iteration: event.iteration } : {}),
		...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
		...(event.refs ? { refs: event.refs } : {}),
		payload: event.payload,
	}));
}

/**
 * Merges hook and recorded events into one timeline and assigns `index`.
 * Events carrying `seq` keep their recorded order; events from unrecorded
 * periods (no `seq`) are placed by timestamp around them.
 */
export function mergeSessionReplayEvents(
	...streams: ReadonlyArray<readonly SessionReplayEvent[]>
): SessionReplayEvent[] {
	const all = streams.flat();
	const sequenced = all
		.filter((event) => event.seq !== undefined)
		.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
	const unsequenced = all
		.filter((event) => event.seq === undefined)
		.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
	const merged: SessionReplayEvent[] = [];
	let i = 0;
	let j = 0;
	while (i < sequenced.length || j < unsequenced.length) {
		const next = sequenced[i];
		const loose = unsequenced[j];
		if (!loose || (next && next.ts <= loose.ts)) {
			if (next) merged.push(next);
			i += 1;
		} else {
			merged.push(loose);
			j += 1;
		}
	}
	return merged.map((event, index) => ({ ...event, index }));
}

/**
 * Applies export redaction to a recording. Message content, tool definitions
 * and the model's streamed output stay verbatim (they are the conversation,
 * like transcript content); request options, provider settings, usage,
 * finish/usage stream events, message metadata and segment env are redacted.
 */
export function redactSessionRecording(input: {
	recording: LoadedSessionRecording;
	redactor: SessionReplayRedactor;
	requestsFile: string;
	blobsFile: string;
	manifestFile: string;
}): {
	segments: SessionReplaySessionRecording["segments"];
	requests: SessionRecordedModelCall[];
	blobs: SessionReplayRequestBlob[];
} {
	const { recording, redactor } = input;
	const segments = recording.header.segments.map((segment, index) => ({
		...segment,
		cwd: redactor.redact(
			segment.cwd,
			input.manifestFile,
			`sessions[0].recording.segments[${index}].cwd`,
		),
		env: redactor.redact(
			segment.env,
			input.manifestFile,
			`sessions[0].recording.segments[${index}].env`,
		),
		...(segment.toolPolicies
			? {
					toolPolicies: redactor.redact(
						segment.toolPolicies,
						input.manifestFile,
						`sessions[0].recording.segments[${index}].toolPolicies`,
					),
				}
			: {}),
	}));
	const requests = recording.requests.map((record, index) => {
		const path = `[${index}]`;
		return {
			...record,
			request: {
				...record.request,
				options: redactor.redact(
					record.request.options,
					input.requestsFile,
					`${path}.request.options`,
				),
				provider: redactor.redact(
					record.request.provider,
					input.requestsFile,
					`${path}.request.provider`,
				),
			},
			response: {
				...record.response,
				error: redactor.redact(
					record.response.error,
					input.requestsFile,
					`${path}.response.error`,
				),
				usage: redactor.redact(
					record.response.usage,
					input.requestsFile,
					`${path}.response.usage`,
				),
				events: record.response.events.map((entry, eventIndex) =>
					entry.event.type === "usage" || entry.event.type === "finish"
						? {
								...entry,
								event: redactor.redact(
									entry.event,
									input.requestsFile,
									`${path}.response.events[${eventIndex}].event`,
								),
							}
						: entry,
				),
			},
		};
	});
	const blobs = recording.blobs.map((blob, index): SessionReplayRequestBlob => {
		if (
			blob.kind !== "message" ||
			!blob.value ||
			typeof blob.value !== "object" ||
			!("metadata" in blob.value)
		) {
			return blob;
		}
		const value = blob.value as Record<string, unknown>;
		const metadata = redactor.redact(
			value.metadata,
			input.blobsFile,
			`[${index}].value.metadata`,
		);
		if (JSON.stringify(metadata) === JSON.stringify(value.metadata)) {
			return blob;
		}
		return { ...blob, value: { ...value, metadata }, redacted: true };
	});
	return { segments, requests, blobs };
}
