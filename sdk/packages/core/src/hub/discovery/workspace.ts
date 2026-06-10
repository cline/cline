import { resolveClineBuildEnv } from "@cline/shared";
import { normalizeWorkspacePath } from "../../services/workspace/workspace-manifest";
import { type HubOwnerContext, resolveHubOwnerContext } from ".";

const SHARED_HUB_OWNER_LABEL_PREFIX = "shared:cline";

function resolveDefaultSharedHubOwnerLabel(): string {
	return `${SHARED_HUB_OWNER_LABEL_PREFIX}:${resolveClineBuildEnv()}`;
}

export function resolveWorkspaceHubOwnerContext(
	workspaceRoot: string,
): HubOwnerContext {
	const normalized = normalizeWorkspacePath(workspaceRoot.trim());
	return resolveHubOwnerContext(
		`workspace:${normalized || workspaceRoot.trim()}`,
	);
}

export function resolveSharedHubOwnerContext(
	label = resolveDefaultSharedHubOwnerLabel(),
): HubOwnerContext {
	return resolveHubOwnerContext(label);
}
