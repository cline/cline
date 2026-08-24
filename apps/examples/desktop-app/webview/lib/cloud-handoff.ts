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

export function formatHandoffModelFallback(
	fallback?: HandoffPreflight["modelFallback"],
): string | null {
	if (!fallback?.from.trim() || !fallback.to.trim()) return null;
	return `${fallback.from} isn’t available in Cline Cloud. Continuing with ${fallback.to}.`;
}

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

export function readPendingHandoffRecovery(
	metadata?: SessionMetadata,
): HandoffReceipt | null {
	const raw = metadata?.handoff;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return null;
	}
	const handoff = raw as Record<string, unknown>;
	if (handoff.status !== "pending") {
		return null;
	}
	const targetSessionId = stringField(handoff.toCloudSessionId);
	const dashboardUrl = stringField(handoff.dashboardUrl);
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

export type HandoffWarningToast = {
	title: string;
	description: string;
	variant?: "destructive";
};

/**
 * The single source of truth for how a handoff completion warning is shown,
 * shared by the RPC result path and the `cloud_handoff_progress` complete
 * event path so both surface the identical toast. Returns null when the
 * payload carries no warning. An unconfirmed follow-up must never quote the
 * command for resending — it may already be durably queued.
 */
export function buildHandoffWarningToast(fields: {
	warning?: unknown;
	warningKind?: unknown;
	undeliveredCommand?: unknown;
}): HandoffWarningToast | null {
	const warning =
		typeof fields.warning === "string" ? fields.warning.trim() : "";
	if (!warning) {
		return null;
	}
	const unconfirmed = fields.warningKind === "unconfirmed";
	const undeliveredCommand =
		!unconfirmed && typeof fields.undeliveredCommand === "string"
			? fields.undeliveredCommand.trim()
			: "";
	return {
		title: "Handoff completed with a warning",
		description: undeliveredCommand
			? `${warning} Your command was kept: "${undeliveredCommand}" — send it from the cloud session.`
			: warning,
		...(unconfirmed ? { variant: "destructive" as const } : {}),
	};
}

/**
 * Both the completion event and the RPC result can report the same warning;
 * whichever lands first claims the toast and the other stays silent. Returns
 * true when this caller should surface the warning for the source session.
 */
export function claimHandoffWarningSurface(
	surfaced: Set<string>,
	sourceSessionId: string,
): boolean {
	if (surfaced.has(sourceSessionId)) {
		return false;
	}
	surfaced.add(sourceSessionId);
	return true;
}
