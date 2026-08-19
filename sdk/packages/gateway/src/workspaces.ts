/**
 * Logical bot workspace storage (Gateway RFC, Phase 4).
 *
 * Every bot's logical workspaces live under
 * `~/.cline/bots/<botId>/workspaces/` (via the Gateway data dir). The
 * mount policy a worker receives is derived from that fixed per-bot root
 * — never from individual child workspaces — so adding a child workspace
 * neither widens the mount policy nor requires a worker restart.
 *
 * Paths are validated hard: no absolute segments, no `..`, and the
 * link-resolved result must stay inside the bot's workspaces root
 * (symlinks that escape are rejected).
 */

import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { BotId } from "@cline/shared/gateway";
import type { GatewayPaths } from "./paths";

export class WorkspacePathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkspacePathError";
	}
}

/**
 * The mount policy a worker gets for one bot. Derived exclusively from
 * the bot's fixed workspaces root: stable across child workspace
 * creation, so policy identity can be compared by value.
 */
export interface BotMountPolicy {
	readonly botId: BotId;
	/** The single writable mount: the bot's workspaces root. */
	readonly writeRoots: readonly string[];
	/** Read-only mounts (none by default beyond the write roots). */
	readonly readRoots: readonly string[];
}

const WORKSPACE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class BotWorkspaceManager {
	private readonly paths: GatewayPaths;
	private readonly policies = new Map<BotId, BotMountPolicy>();

	constructor(paths: GatewayPaths) {
		this.paths = paths;
	}

	/** The bot's fixed workspaces root (created on demand, mode 0700). */
	workspacesRoot(botId: BotId): string {
		const root = this.paths.workspacesDir(botId);
		mkdirSync(root, { recursive: true, mode: 0o700 });
		return root;
	}

	/**
	 * Mount policy for a bot's worker. The same (frozen) object is
	 * returned for the lifetime of the manager: adding child workspaces
	 * must not change it, which also means it can never force a restart.
	 */
	mountPolicy(botId: BotId): BotMountPolicy {
		const existing = this.policies.get(botId);
		if (existing) {
			return existing;
		}
		const policy: BotMountPolicy = Object.freeze({
			botId,
			writeRoots: Object.freeze([
				this.workspacesRoot(botId),
			]) as readonly string[],
			readRoots: Object.freeze([]) as readonly string[],
		});
		this.policies.set(botId, policy);
		return policy;
	}

	/**
	 * Resolve a logical workspace path (one or more validated segments)
	 * against the bot's workspaces root. Rejects absolute paths, `..`,
	 * empty or otherwise malformed segments.
	 */
	resolveWorkspacePath(botId: BotId, logicalPath: string): string {
		if (typeof logicalPath !== "string" || logicalPath.length === 0) {
			throw new WorkspacePathError("Workspace path must be a non-empty string");
		}
		const segments = logicalPath.split(/[\\/]/);
		for (const segment of segments) {
			if (
				!WORKSPACE_SEGMENT.test(segment) ||
				segment === ".." ||
				segment === "."
			) {
				throw new WorkspacePathError(
					`Invalid workspace path segment "${segment}" in "${logicalPath}"`,
				);
			}
		}
		const root = this.workspacesRoot(botId);
		const candidate = resolve(join(root, ...segments));
		if (candidate !== root && !candidate.startsWith(root + sep)) {
			throw new WorkspacePathError(
				`Workspace path "${logicalPath}" escapes the bot workspaces root`,
			);
		}
		return candidate;
	}

	/**
	 * Materialize a workspace directory and verify — after resolving
	 * links — that it is still inside the bot root. A symlinked child
	 * pointing outside the root is rejected, not followed.
	 */
	materializeWorkspace(botId: BotId, logicalPath: string): string {
		const candidate = this.resolveWorkspacePath(botId, logicalPath);
		mkdirSync(candidate, { recursive: true, mode: 0o700 });
		this.assertInsideBotRoot(botId, candidate);
		return candidate;
	}

	/**
	 * Assert an existing path resolves (links followed) inside the bot's
	 * workspaces root.
	 */
	assertInsideBotRoot(botId: BotId, path: string): string {
		const root = realpathSync(this.workspacesRoot(botId));
		let real: string;
		try {
			real = realpathSync(path);
		} catch (error) {
			throw new WorkspacePathError(
				`Workspace path ${path} cannot be resolved: ${String(error)}`,
			);
		}
		if (real !== root && !real.startsWith(root + sep)) {
			throw new WorkspacePathError(
				`Workspace path ${path} resolves outside the bot workspaces root (symlink escape?)`,
			);
		}
		return real;
	}
}
