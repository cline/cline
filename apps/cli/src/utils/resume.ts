import type { ClineCore } from "@cline/core";
import type { MessageWithMetadata } from "@cline/shared";

export async function loadInteractiveResumeMessages(
	sessionManager: ClineCore,
	resumeSessionId?: string,
): Promise<MessageWithMetadata[] | undefined> {
	const target = resumeSessionId?.trim();
	if (!target) {
		return undefined;
	}
	return await sessionManager.readMessages(target);
}
