import {
	cloudImageAttachmentError,
	isSupportedImageAttachment,
} from "@/lib/image-attachments";

type ParsedHandoffCommand = {
	nextCommand: string;
};

export type HandoffPreflight = {
	gitPreparationId: string;
	repoUrl: string;
	branch: string;
	headSha: string;
	modelId: string;
};

export type HandoffResult = {
	sourceSessionId: string;
	sessionId: string;
	dashboardUrl: string;
	destination: "in_app" | "external";
	warning?: string;
	warningKind?: "unqueued" | "unconfirmed";
	undeliveredCommand?: string;
};

export type HandoffProgressPhase =
	| "checking"
	| "summarizing"
	| "creating"
	| "provisioning"
	| "sending"
	| "complete";

export const HANDOFF_PROGRESS_LABELS: Record<HandoffProgressPhase, string> = {
	checking: "Checking the local session...",
	creating: "Creating the cloud session...",
	provisioning: "Preparing the cloud workspace...",
	summarizing: "Summarizing the local conversation...",
	sending: "Sending the cloud task...",
	complete: "Cloud handoff complete.",
};

/** Returns null for ordinary prompts and slash-command lookalikes. */
export function parseHandoffCommand(
	input: string,
): ParsedHandoffCommand | null {
	const match = input.trim().match(/^\/cloud(?:\s+([\s\S]*))?$/i);
	if (!match) {
		return null;
	}
	return { nextCommand: (match[1] ?? "").trim() };
}

export function validateHandoffAttachments(
	files: readonly File[],
): string | null {
	const nonImage = files.find((file) => !isSupportedImageAttachment(file));
	if (nonImage) {
		return `Cloud handoff only supports image attachments. Remove ${nonImage.name} and try again.`;
	}
	return cloudImageAttachmentError([...files]) ?? null;
}

export function isExpectedHandoffSourceActive(
	expectedThreadId: string | undefined,
	activeThreadId: string,
	view: string,
): boolean {
	return (
		!expectedThreadId ||
		(expectedThreadId === activeThreadId && view === "chat")
	);
}

type HandoffWarningToast = {
	title: string;
	description: string;
	variant?: "destructive";
};

/**
 * Do not offer an unconfirmed command for resending. It may already be queued.
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
			? `${warning} The prepared prompt was kept in the cloud session.`
			: warning,
		...(unconfirmed ? { variant: "destructive" as const } : {}),
	};
}
