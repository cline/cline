import { validateImageMedia } from "@cline/shared/browser";
import { toast } from "@/hooks/use-toast";
import type { CloudHandoffFollowUp } from "../../sidecar/cloud-handoff-follow-up";
import { desktopClient } from "./desktop-client";

export async function openWithCloudHandoffFollowUp(options: {
	targetSessionId: string;
	initialPromptDraft?: string;
	initialAttachments?: File[];
	canOpen: () => boolean;
	open: (draft?: string, attachments?: File[]) => void;
	delivered: (sourceSessionId: string) => void;
}): Promise<boolean> {
	let saved: CloudHandoffFollowUp | null = null;
	let attachments = options.initialAttachments;
	let restoreFailed = false;
	try {
		saved = await desktopClient.invoke<CloudHandoffFollowUp | null>(
			"get_cloud_handoff_follow_up",
			{ sessionId: options.targetSessionId },
		);
		attachments ??= saved?.unconfirmed
			? undefined
			: saved?.userImages.map((image, index) => {
					const media = validateImageMedia(undefined, image);
					if (!media.ok) throw new Error("Invalid saved image");
					const bytes = Uint8Array.from(atob(media.base64), (char) =>
						char.charCodeAt(0),
					);
					return new File([bytes], `handoff-image-${index + 1}`, {
						type: media.mediaType,
					});
				});
	} catch {
		saved = null;
		restoreFailed = true;
	}
	if (!options.canOpen()) return false;
	if (saved?.unconfirmed) {
		options.open(undefined, undefined);
		toast({
			title: "Follow-up delivery is unconfirmed",
			description:
				"Check the cloud conversation before resending. The recovery copy is still saved locally.",
			variant: "destructive",
		});
		return true;
	}
	options.open(options.initialPromptDraft ?? saved?.command, attachments);
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
