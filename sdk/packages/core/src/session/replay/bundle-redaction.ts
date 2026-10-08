import {
	redactSensitiveData,
	SENSITIVE_KEY_SUFFIXES,
	SENSITIVE_KEYS_EXACT,
	SENSITIVE_VALUE_PATTERNS,
} from "@cline/shared";
import type { SessionReplayRedactionReport } from "./bundle-schema";

/**
 * Bundle locations the redaction pass covers. Structural identifiers the
 * bundle needs to stay coherent (session ids, message ids, tool call ids,
 * event envelopes) are not redacted even though the VCR key rules would
 * match their names.
 */
const COVERED_LOCATIONS = [
	"manifest.json sessions[].metadata (key and value rules)",
	"manifest.json sessions[].cwd, sessions[].workspaceRoot, sessions[].title (value rules)",
	"transcript.json messages[].metadata (key and value rules)",
	"compaction.json messages[].metadata (key and value rules)",
	"events.jsonl payload (key and value rules)",
];

const NOT_COVERED_LOCATIONS = [
	"transcript.json messages[].content (conversation content, kept verbatim for replay)",
	"transcript.json systemPrompt",
	"compaction.json messages[].content and system_prompt",
];

const RECORDING_COVERED_LOCATIONS = [
	"manifest.json sessions[].recording.segments[].env, cwd, toolPolicies (key and value rules)",
	"requests/requests.jsonl request.options, request.provider (key and value rules; credentials and header values are never recorded)",
	"requests/requests.jsonl response.error, response.usage and usage/finish stream events (key and value rules)",
	"requests/blobs.jsonl message metadata (key and value rules; such blobs are marked redacted)",
];

const RECORDING_NOT_COVERED_LOCATIONS = [
	"requests/blobs.jsonl system prompts, tool definitions and message content (the request as sent, kept verbatim for replay)",
	"requests/requests.jsonl response text, reasoning and tool-call stream events (model output, kept verbatim for replay)",
	"events.jsonl refs (correlation ids)",
];

export interface SessionReplayRedactor {
	readonly enabled: boolean;
	/** Redacts `value`, recording each removal against `file` and `path`. */
	redact<T>(value: T, file: string, path: string): T;
	report(): SessionReplayRedactionReport;
}

export function createSessionReplayRedactor(options: {
	enabled: boolean;
	/** Whether the bundle carries a recording; extends the reported locations. */
	recorded?: boolean;
}): SessionReplayRedactor {
	const redactions: SessionReplayRedactionReport["redactions"] = [];
	return {
		enabled: options.enabled,
		redact<T>(value: T, file: string, path: string): T {
			if (!options.enabled || value === undefined || value === null) {
				return value;
			}
			return redactSensitiveData(value, {
				path,
				onRedaction: (redaction) => {
					redactions.push({
						file,
						path: redaction.path,
						rule: redaction.rule,
					});
				},
			});
		},
		report(): SessionReplayRedactionReport {
			return {
				enabled: options.enabled,
				ruleset: "vcr-sanitizer",
				rules: {
					keysExact: [...SENSITIVE_KEYS_EXACT],
					keySuffixes: [...SENSITIVE_KEY_SUFFIXES],
					valuePatterns: SENSITIVE_VALUE_PATTERNS.map(({ name }) => name),
				},
				covered: options.enabled
					? [
							...COVERED_LOCATIONS,
							...(options.recorded ? RECORDING_COVERED_LOCATIONS : []),
						]
					: [],
				notCovered: options.enabled
					? [
							...NOT_COVERED_LOCATIONS,
							...(options.recorded ? RECORDING_NOT_COVERED_LOCATIONS : []),
						]
					: ["redaction disabled at export: every file is verbatim"],
				redactions: [...redactions],
			};
		},
	};
}
