import type {
	CloudHandoffFingerprint,
	CloudHandoffProgressPhase,
	CloudHandoffResult,
} from "@cline/core";
import type { SessionMetadata } from "@/lib/session-history";

export type ParsedHandoffCommand = {
	nextCommand: string;
};

export type HandoffPreflight = {
	fingerprint: CloudHandoffFingerprint;
	repoUrl: string;
	branch: string;
	headSha?: string;
	modelId: string;
	modelFallback?: { from: string; to: string };
};

export type HandoffResult = CloudHandoffResult & {
	/** Backward-compatible alias used by early desktop spikes. */
	sessionId?: string;
};

export type HandoffReceipt = {
	targetSessionId: string;
	dashboardUrl: string;
};

export type HandoffProgressPhase = CloudHandoffProgressPhase;

export const HANDOFF_PROGRESS_LABELS: Record<HandoffProgressPhase, string> = {
	checking: "Checking the local session...",
	creating: "Creating the cloud session...",
	provisioning: "Preparing the cloud workspace...",
	connecting: "Connecting to the cloud agent...",
	seeding: "Transferring the conversation...",
	verifying: "Verifying the handoff...",
	starting: "Starting the cloud task...",
	complete: "Cloud handoff complete.",
};

/** Returns null for ordinary prompts and slash-command lookalikes. */
export function parseHandoffCommand(
	input: string,
): ParsedHandoffCommand | null {
	const match = input.trim().match(/^\/handoff(?:\s+([\s\S]*))?$/i);
	if (!match) {
		return null;
	}
	return { nextCommand: (match[1] ?? "").trim() };
}

export function validateHandoffAttachments(
	files: readonly File[],
	nextCommand: string,
): string | null {
	const nonImage = files.find((file) => !file.type.startsWith("image/"));
	if (nonImage) {
		return `Cloud handoff only supports image attachments. Remove ${nonImage.name} and try again.`;
	}
	if (files.length > 0 && !nextCommand.trim()) {
		return "Add a command after /handoff to send the attached images in cloud.";
	}
	return null;
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function readHandoffReceipt(
	metadata?: SessionMetadata,
): HandoffReceipt | null {
	const raw = metadata?.handoff;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return null;
	}
	const handoff = raw as Record<string, unknown>;
	if (handoff.status !== "complete") {
		return null;
	}
	const targetSessionId =
		stringField(handoff.toCloudSessionId) ||
		stringField(handoff.targetSessionId) ||
		stringField(handoff.cloudSessionId) ||
		stringField(handoff.sessionId);
	const dashboardUrl =
		stringField(handoff.dashboardUrl) || stringField(handoff.url);
	return targetSessionId && dashboardUrl
		? { targetSessionId, dashboardUrl }
		: null;
}

export function shouldOpenHandoffInApp(
	destination: HandoffResult["destination"],
	isSourceStillActive: boolean,
): boolean {
	return destination === "in_app" && isSourceStillActive;
}
