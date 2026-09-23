import type { HubEventEnvelope, MessageWithMetadata } from "@cline/shared";
import type { CloudSessionRecord, CreateCloudSessionInput } from "./api";

export type JsonRecord = Record<string, unknown>;
export type CloudCreationOptions = Pick<
	CreateCloudSessionInput,
	"autoApproveTools" | "thinking" | "reasoningEffort"
>;
export type CloudQueuedPrompt = {
	id: string;
	prompt: string;
	steer: boolean;
	attachmentCount?: number;
	userImages?: string[];
};
export type CloudApproval = {
	requestId: string;
	sessionId: string;
	approvalId: string;
	createdAt: string;
	toolCallId: string;
	toolName: string;
	input?: unknown;
	iteration?: number;
	agentId?: string;
	conversationId?: string;
};
/** Internal mutable state; snapshots returned to hosts are deep copied and frozen. */
export type CloudSessionState = {
	config: JsonRecord;
	messages: MessageWithMetadata[];
	promptsInQueue: CloudQueuedPrompt[];
	busy: boolean;
	startedAt: number;
	endedAt?: number;
	status: string;
	prompt?: string;
	title?: string;
	attachedViaHub?: boolean;
	lastHubStatusSequence?: number;
	lastQueuedPromptStartId?: string;
	usage?: JsonRecord;
};
export type CloudConnectionState =
	| "detached"
	| "connecting"
	| "connected"
	| "reconnecting";
export type CloudSessionSnapshot = Readonly<
	CloudSessionState & {
		sessionId: string;
		record?: CloudSessionRecord;
		approvals: CloudApproval[];
		connectionState: CloudConnectionState;
		transcriptKnown: boolean;
	}
>;
export type CloudSessionEvent =
	| {
			type: "prompt_accepted";
			sessionId: string;
			prompt: string;
			delivery?: "queue" | "steer";
	  }
	| {
			type: "snapshot";
			sessionId: string;
			snapshot: CloudSessionSnapshot;
			replace: boolean;
			cause?: "status" | "ended" | "queue" | "approvals";
	  }
	| { type: "hub_event"; sessionId: string; event: HubEventEnvelope }
	| { type: "sync_failed"; sessionId: string; message: string }
	| { type: "removed"; sessionId: string };

export type CloudSessionAttachment = JsonRecord & {
	sessionId: string;
	status: string;
};
