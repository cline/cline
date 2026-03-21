import type { LlmsProviders } from "@clinebot/core";
import type { CliSessionManager } from "./session";

export async function loadInteractiveResumeMessages(
	sessionManager: CliSessionManager,
	resumeSessionId?: string,
): Promise<LlmsProviders.Message[] | undefined> {
	const target = resumeSessionId?.trim();
	if (!target) {
		return undefined;
	}
	return await sessionManager.readMessages(target);
}
