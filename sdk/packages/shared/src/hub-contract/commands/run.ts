import { z } from "zod";
import {
	defineHubCommands,
	hubEmptyInput,
	hubObject,
	hubRecord,
} from "../define";

/**
 * Payload-level session id. Handlers read `payload.sessionId` when it is a
 * string and otherwise fall back to `envelope.sessionId` (extractSessionId).
 */
const payloadSessionId = z.string().nullish();

/**
 * Shared input of `run.start`, `session.send_input`, and `run.enqueue`
 * (the run queue stores this payload and replays it through
 * handleSessionInput).
 *
 * The handler rejects the command unless `prompt`/`input` is a non-empty
 * string or `attachments` carries userImages/userFiles; that cross-field rule
 * is enforced by the handler, not here.
 * TODO(contract): consider a refinement for the prompt-or-attachment rule.
 */
const sessionInputFields = {
	sessionId: payloadSessionId,
	/** Prompt text (preferred key). */
	prompt: z.string().nullish(),
	/** Legacy alias for `prompt` (sent by HubRuntimeHost.runTurn). */
	input: z.string().nullish(),
	// Any truthy value flows through as the agent mode.
	// TODO(contract): narrow to AgentMode once non-string senders are ruled out.
	mode: z.string().nullish(),
	// { userImages?: string[]; userFiles?: string[] }; non-objects are ignored.
	attachments: hubRecord.nullish(),
	// Only "queue" | "steer" are honored; other values are ignored.
	delivery: z.string().nullish(),
	// Non-number values are ignored by parseRunTimeoutMs.
	timeoutMs: z.number().nullish(),
	timeout_ms: z.number().nullish(),
	timeoutSeconds: z.number().nullish(),
	timeout_seconds: z.number().nullish(),
};

const sessionInput = hubObject(sessionInputFields);

const sessionInputOutput = hubObject({
	result: hubRecord.optional(),
	snapshot: hubRecord.optional(),
});

/**
 * No Hub handler exists for these commands: they fall through the dispatch
 * switch to the schedule/task command service, which replies
 * `unsupported_command`. No sender exists in the repo either.
 * TODO(contract): define once the command is implemented.
 */
const unimplementedInput = hubEmptyInput;

export const runCommands = defineHubCommands({
	"run.start": {
		description:
			"Run one agent turn in a session and reply when the turn settles.",
		input: sessionInput,
		output: sessionInputOutput,
	},
	"session.send_input": {
		description:
			"Send user input to a session, running a turn (alias of run.start).",
		input: sessionInput,
		output: sessionInputOutput,
	},
	"run.enqueue": {
		description:
			"Durably queue a turn for a session and ack immediately with its run id.",
		// Handler additionally requires a session id (payload or envelope) and a
		// non-empty `prompt`/`input` string; attachments alone are not enough.
		input: sessionInput,
		output: hubObject({
			runId: z.string().optional(),
			acceptedAt: z.number().optional(),
			queuePosition: z.number().optional(),
		}),
	},
	"run.list": {
		description: "List durable run queue records, optionally for one session.",
		input: hubObject({
			sessionId: payloadSessionId,
			// Non-positive / non-number values are ignored.
			limit: z.number().nullish(),
		}),
		output: hubObject({
			runs: z.array(hubRecord).optional(),
		}),
	},
	"run.abort": {
		description:
			"Abort the session's active run and cancel its pending approvals and capability requests.",
		input: hubObject({
			sessionId: payloadSessionId,
			// Only strings are used as the cancel reason; anything else falls back
			// to a default and is forwarded to sessionHost.abort as-is.
			reason: z.unknown().optional(),
		}),
		output: hubObject({
			applied: z.boolean().optional(),
		}),
	},
	"run.proceed_while_running": {
		description:
			"Detach running foreground commands so the agent can continue the turn.",
		// Session id is required but may come from the envelope instead.
		input: hubObject({
			sessionId: payloadSessionId,
			// Blank / non-string values mean "all running commands".
			toolCallId: z.string().nullish(),
		}),
		output: hubObject({
			detachedCount: z.number().optional(),
		}),
	},
	"approval.request": {
		description:
			"Reserved: request a tool approval (approvals are raised by the Hub as approval.requested events).",
		input: unimplementedInput,
	},
	"approval.respond": {
		description: "Resolve a pending tool approval as approved or denied.",
		input: hubObject({
			// Unknown or missing ids reply approval_not_found.
			approvalId: z.string(),
			// Anything other than `true` is a denial.
			approved: z.boolean().nullish(),
			reason: z.string().nullish(),
			// Legacy carrier of `reason` (sent by HubSessionClient).
			payload: hubObject({ reason: z.string().nullish() }).nullish(),
			// Sent by HubSessionClient.respondToolApproval; not read by the handler.
			responderClientId: z.string().nullish(),
		}),
		output: hubObject({
			approvalId: z.string().optional(),
			approved: z.boolean().optional(),
		}),
	},
	"capability.request": {
		description:
			"Ask a target client to execute a capability for a session and reply with its result.",
		input: hubObject({
			// Required, but may come from the envelope instead.
			sessionId: payloadSessionId,
			capabilityName: z.string(),
			targetClientId: z.string(),
			// Capability request body; non-objects are replaced with {}.
			payload: hubRecord.nullish(),
		}),
		// Reply payload is the capability's response body, whatever it is.
		output: hubRecord.optional(),
	},
	"capability.progress": {
		description:
			"Report progress for a pending capability request owned by the sending client.",
		input: hubObject({
			// Missing / unknown ids are acked with { ignored: true }.
			requestId: z.string().nullish(),
			// Progress body; non-objects are replaced with {}.
			payload: hubRecord.nullish(),
		}),
		output: hubObject({
			requestId: z.string().optional(),
			ignored: z.boolean().optional(),
		}),
	},
	"capability.respond": {
		description:
			"Resolve a pending capability request owned by the sending client.",
		input: hubObject({
			// Missing / unknown ids are acked with { ignored: true }.
			requestId: z.string().nullish(),
			// Anything other than `true` is a failure.
			ok: z.boolean().nullish(),
			// Response body; non-objects are treated as absent.
			payload: hubRecord.nullish(),
			error: z.string().nullish(),
		}),
		output: hubObject({
			requestId: z.string().optional(),
			ok: z.boolean().optional(),
			ignored: z.boolean().optional(),
		}),
	},
	"peer.register": {
		description: "Reserved: register a peer hub (not implemented).",
		input: unimplementedInput,
	},
	"peer.list_sessions": {
		description: "Reserved: list a peer hub's sessions (not implemented).",
		input: unimplementedInput,
	},
	"peer.attach_session": {
		description: "Reserved: attach to a peer hub's session (not implemented).",
		input: unimplementedInput,
	},
	"peer.detach_session": {
		description:
			"Reserved: detach from a peer hub's session (not implemented).",
		input: unimplementedInput,
	},
	"peer.proxy_command": {
		description: "Reserved: proxy a command to a peer hub (not implemented).",
		input: unimplementedInput,
	},
});
