import { normalizeWorkspacePath } from "../services/workspace-manifest";
import { type HubOwnerContext, resolveHubOwnerContext } from "./discovery";

const DEFAULT_SHARED_HUB_OWNER_LABEL = "shared:cline";

export function resolveWorkspaceHubOwnerContext(
	workspaceRoot: string,
): HubOwnerContext {
	const normalized = normalizeWorkspacePath(workspaceRoot.trim());
	return resolveHubOwnerContext(
		`workspace:${normalized || workspaceRoot.trim()}`,
	);
}

export function resolveSharedHubOwnerContext(
	label = DEFAULT_SHARED_HUB_OWNER_LABEL,
): HubOwnerContext {
	return resolveHubOwnerContext(label);
}
