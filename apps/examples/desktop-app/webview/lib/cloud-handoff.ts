import {
	cloudImageAttachmentError,
	isSupportedImageAttachment,
} from "@/lib/image-attachments";

type ParsedHandoffCommand = {
	nextCommand: string;
};

export type { HandoffResult } from "../../sidecar/cloud-handoff";

export type HandoffProgressPhase = "checking" | "provisioning" | "complete";

export const HANDOFF_PROGRESS_LABELS: Record<HandoffProgressPhase, string> = {
	checking: "Preparing cloud handoff…",
	provisioning: "Preparing the cloud workspace...",
	complete: "Cloud handoff complete.",
};

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
