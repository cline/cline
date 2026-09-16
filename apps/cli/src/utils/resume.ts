import type { ClineCore } from "@cline/core";
import type { SessionHistoryEntry } from "@cline/shared";

export async function loadInteractiveResumeMessages(
	sessionManager: ClineCore,
	resumeSessionId?: string,
): Promise<SessionHistoryEntry[] | undefined> {
	const target = resumeSessionId?.trim();
	if (!target) {
		return undefined;
	}
	return await sessionManager.readMessages(target);
}
