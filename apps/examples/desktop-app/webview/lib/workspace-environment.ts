import type { ProcessContext } from "@/hooks/chat-session/types";

export type RemoteWorkspaceEnvironment = {
	id: string;
	homeDir: string;
};

export function remoteWorkspaceEnvironmentFromContext(
	context: ProcessContext,
): RemoteWorkspaceEnvironment | null {
	const id = context.remoteEnvironment?.id?.trim();
	if (!id) return null;
	const homeDir = context.homeDir?.trim();
	if (!homeDir) return null;
	return { id, homeDir };
}
