import { isAbsolute, relative, resolve, sep } from "node:path";
import type { HubConnectionAuthority } from "./command-transport";

/** Directories a session would run in once the handler applied its defaults. */
export interface SessionWorkspaceRequest {
	workspaceRoot?: string;
	cwd?: string;
}

export function isPathInsideWorkspace(
	workspaceRoot: string,
	path: string,
): boolean {
	const relativePath = relative(resolve(workspaceRoot), resolve(path));
	return (
		relativePath !== ".." &&
		!relativePath.startsWith(`..${sep}`) &&
		!isAbsolute(relativePath)
	);
}

/**
 * Decides whether a connection may run an agent session in the requested
 * directories. Returns a denial message, or `undefined` when allowed.
 *
 * `authority` is `undefined` for trusted in-process callers, `null` for a
 * remote connection that has not registered yet, and otherwise the authority
 * granted at `client.register`: token-authenticated connections carry
 * `crossWorkspace: true`, while origin-only browser connections are confined
 * to the Hub's `workspaceContext.workspaceRoot` (which may be absent when the
 * Hub was started without a workspace).
 */
export function authorizeSessionWorkspace(
	authority: HubConnectionAuthority | null | undefined,
	request: SessionWorkspaceRequest,
): string | undefined {
	if (authority === undefined) return undefined;
	if (authority === null) {
		return "Register this connection before starting sessions";
	}
	if (authority.crossWorkspace) return undefined;
	const workspaceRoot = authority.workspaceContext?.workspaceRoot;
	if (!workspaceRoot) {
		return "This connection is not authorized for any workspace";
	}
	// Without an explicit directory the session would fall back to the
	// daemon's own cwd, which may lie outside the authorized workspace.
	const paths = [request.workspaceRoot, request.cwd].filter(
		(path): path is string => typeof path === "string",
	);
	if (paths.length === 0) {
		return "Sessions on this connection must name a directory in its workspace";
	}
	if (paths.some((path) => !isPathInsideWorkspace(workspaceRoot, path))) {
		return "Session directory is outside this connection's workspace";
	}
	return undefined;
}
