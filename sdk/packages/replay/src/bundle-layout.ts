import { SessionCompactionStateSchema } from "@cline/core";
import type {
	SessionReplayFileEntry,
	SessionReplayFileKind,
} from "@cline/shared";

export const SessionReplayCompactionFileSchema = SessionCompactionStateSchema;

const MEDIA_TYPES: Record<
	SessionReplayFileKind,
	SessionReplayFileEntry["mediaType"]
> = {
	transcript: "application/json",
	events: "application/x-ndjson",
	compaction: "application/json",
	"redaction-report": "application/json",
	request: "application/x-ndjson",
	"request-blobs": "application/x-ndjson",
	cassette: "application/json",
	environment: "application/json",
};

export function sessionReplayFileMediaType(
	kind: SessionReplayFileKind,
): SessionReplayFileEntry["mediaType"] {
	return MEDIA_TYPES[kind];
}

/** Directory of one session inside a bundle, relative to the bundle root. */
export function sessionReplaySessionDir(sessionId: string): string {
	return `sessions/${encodeURIComponent(sessionId)}`;
}

export const sessionReplayBundlePaths = {
	transcript: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/transcript.json`,
	events: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/events.jsonl`,
	compaction: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/compaction.json`,
	requestsDir: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/requests`,
	requests: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/requests/requests.jsonl`,
	requestBlobs: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/requests/blobs.jsonl`,
} as const;
