import { validateImageMedia } from "@cline/shared/browser";
import { toast } from "@/hooks/use-toast";
import type { CloudHandoffFollowUp } from "../../sidecar/cloud-handoff-follow-up";
import { desktopClient } from "./desktop-client";

export function shouldPreserveCloudComposer(
	prompt: string,
	attachmentCount: number,
	restoredDraftId?: string,
	incomingDraftId?: string,
): boolean {
	return Boolean(
		prompt.trim() ||
			attachmentCount ||
			(incomingDraftId && incomingDraftId === restoredDraftId),
	);
}

export function cloudHandoffFollowUpAttachments(
	saved: CloudHandoffFollowUp,
): File[] {
	return saved.userImages.map((image, index) => {
		const media = validateImageMedia(undefined, image);
		if (!media.ok) throw new Error("Invalid saved image");
		const bytes = Uint8Array.from(atob(media.base64), (char) =>
			char.charCodeAt(0),
		);
		return new File([bytes], `handoff-image-${index + 1}`, {
			type: media.mediaType,
		});
	});
}

export async function restoreCloudHandoffFollowUp(options: {
	targetSessionId: string;
	expected: CloudHandoffFollowUp;
	canRestore: () => boolean;
	restore: (draft: string, attachments: File[], draftId: string) => void;
}): Promise<void> {
	if (!options.canRestore())
		throw new Error(
			"Clear the current draft before restoring the saved follow-up.",
		);
	const attachments = cloudHandoffFollowUpAttachments(options.expected);
	await desktopClient.invoke("restore_cloud_handoff_follow_up", {
		sessionId: options.targetSessionId,
		expected: options.expected,
	});
	if (options.canRestore())
		options.restore(
			options.expected.command,
			attachments,
			options.expected.draftId,
		);
}

export async function openWithCloudHandoffFollowUp(options: {
	targetSessionId: string;
	initialPromptDraft?: string;
	initialAttachments?: File[];
	canOpen: () => boolean;
	open: (draft?: string, attachments?: File[], draftId?: string) => void;
	delivered: (sourceSessionId: string) => void;
}): Promise<boolean> {
	let saved: CloudHandoffFollowUp | null = null;
	const explicitRetry =
		options.initialPromptDraft !== undefined ||
		options.initialAttachments !== undefined;
	let attachments = options.initialAttachments;
	let restoreFailed = false;
	try {
		saved = await desktopClient.invoke<CloudHandoffFollowUp | null>(
			"get_cloud_handoff_follow_up",
			{ sessionId: options.targetSessionId },
		);
		if (!explicitRetry && saved && !saved.unconfirmed)
			attachments = cloudHandoffFollowUpAttachments(saved);
	} catch {
		saved = null;
		restoreFailed = true;
	}
	if (!options.canOpen()) return false;
	if (saved?.unconfirmed) {
		// A stale copy of the uncertain send stays behind explicit Restore; a newer edit is the user's own draft.
		const newerDraft =
			options.initialPromptDraft?.trim() &&
			options.initialPromptDraft.trim() !== saved.command.trim();
		options.open(
			newerDraft ? options.initialPromptDraft : undefined,
			newerDraft ? options.initialAttachments : undefined,
		);
		return true;
	}
	options.open(
		explicitRetry ? options.initialPromptDraft : saved?.command,
		attachments,
		saved?.draftId,
	);
	if (restoreFailed) {
		toast({
			title: "Cloud opened without the saved follow-up",
			description:
				"The recovery copy could not be read and has not been cleared. Try reopening the session to restore it.",
			variant: "destructive",
		});
	}
	if (saved) {
		options.delivered(saved.sourceSessionId);
	}
	return true;
}
