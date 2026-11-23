import { join } from "node:path";
import { normalizeWorkspacePath } from "../../services/workspace/workspace-manifest";
import {
	type HubOwnerContext,
	resolveClineDataDir,
	resolveHubBuildId,
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

/**
 * Development builds change on every compile, so a single shared owner record
 * puts every checkout and every rebuild in contention for one daemon - and the
 * loser of that contention gets shut down mid-session. Scoping the owner by
 * build id lets differing dev builds run their own Hub side by side instead of
 * arbitrating over one. Production keeps a single owner (see
 * {@link resolveProductionHubOwnerContext}), where the singleton matters and
 * builds are ordered.
 */
export function resolveSharedHubOwnerContext(
	label = DEFAULT_SHARED_HUB_OWNER_LABEL,
): HubOwnerContext {
	return resolveHubOwnerContext(`${label}@${resolveHubBuildId()}`);
}

export function resolveProductionHubOwnerContext(): HubOwnerContext {
	return {
		ownerId: PRODUCTION_HUB_OWNER_ID,
		discoveryPath:
			process.env[HUB_DISCOVERY_ENV]?.trim() ||
			join(resolveClineDataDir(), "locks", "hub", "production.json"),
	};
}
