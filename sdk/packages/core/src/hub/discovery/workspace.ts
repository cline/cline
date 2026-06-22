import { join } from "node:path";
import { resolveClineBuildEnv } from "@cline/shared";
import { normalizeWorkspacePath } from "../../services/workspace/workspace-manifest";
import {
	type HubOwnerContext,
	resolveClineDataDir,
	resolveHubOwnerContext,
} from ".";

const DEFAULT_SHARED_HUB_OWNER_LABEL = "shared:cline";
const HUB_DISCOVERY_ENV = "CLINE_HUB_DISCOVERY_PATH";
const PRODUCTION_HUB_OWNER_ID = "hub-production";

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

export function resolveProductionHubOwnerContext(): HubOwnerContext {
	return {
		ownerId: PRODUCTION_HUB_OWNER_ID,
		discoveryPath:
			process.env[HUB_DISCOVERY_ENV]?.trim() ||
			join(resolveClineDataDir(), "locks", "hub", "production.json"),
	};
}

export function resolveDefaultHubOwnerContext(): HubOwnerContext {
	return resolveClineBuildEnv() === "production"
		? resolveProductionHubOwnerContext()
		: resolveSharedHubOwnerContext();
}
