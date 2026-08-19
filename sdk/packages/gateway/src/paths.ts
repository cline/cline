/**
 * Canonical Gateway data directory layout (Gateway RFC, Phase 3).
 *
 * The singleton scope of a Gateway is its canonical data directory plus
 * an environment namespace — never a port. Two installations that want to
 * run side by side use two namespaces (or two data roots) and therefore
 * two data directories, two locks, and two discovery records.
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { BotId, SessionId } from "@cline/shared/gateway";

/** Env var overriding the data root (parent of per-namespace dirs). */
export const GATEWAY_DATA_ROOT_ENV = "CLINE_GATEWAY_DATA_ROOT";
/** Env var selecting the environment namespace. */
export const GATEWAY_NAMESPACE_ENV = "CLINE_GATEWAY_NAMESPACE";

export const DEFAULT_GATEWAY_NAMESPACE = "default";

const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface GatewayPathsOptions {
	/** Explicit data root; wins over the environment variable. */
	dataRoot?: string;
	/** Explicit namespace; wins over the environment variable. */
	namespace?: string;
	env?: Record<string, string | undefined>;
}

export interface GatewayPaths {
	/** Canonical (resolved) per-namespace data directory. */
	readonly dataDir: string;
	readonly namespace: string;
	/** OS-backed exclusive lock file (authority, not PID/heartbeat). */
	readonly lockFile: string;
	/** SQLite authority database. */
	readonly databaseFile: string;
	/** Atomic mode-0600 discovery record, written only after readiness. */
	readonly discoveryFile: string;
	readonly botsDir: string;
	readonly projectionsDir: string;
	/** Owner-only secret files (mode 0600, dir 0700). Never mounted. */
	readonly secretsDir: string;
	botDir(botId: BotId): string;
	workspacesDir(botId: BotId): string;
	sessionWorkspaceDir(botId: BotId, sessionId: SessionId): string;
	memoriesDir(botId: BotId): string;
	secretFile(name: string): string;
	sessionProjectionFile(sessionId: SessionId): string;
}

const SECRET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function defaultGatewayDataRoot(
	env: Record<string, string | undefined> = process.env,
): string {
	return env[GATEWAY_DATA_ROOT_ENV] ?? join(homedir(), ".cline", "gateway");
}

export function resolveGatewayNamespace(
	options: GatewayPathsOptions = {},
): string {
	const env = options.env ?? process.env;
	const namespace =
		options.namespace ??
		env[GATEWAY_NAMESPACE_ENV] ??
		DEFAULT_GATEWAY_NAMESPACE;
	if (!NAMESPACE_PATTERN.test(namespace)) {
		throw new Error(
			`Invalid gateway namespace "${namespace}": expected ${NAMESPACE_PATTERN}`,
		);
	}
	return namespace;
}

export function resolveGatewayPaths(
	options: GatewayPathsOptions = {},
): GatewayPaths {
	const env = options.env ?? process.env;
	const namespace = resolveGatewayNamespace(options);
	const dataRoot = options.dataRoot ?? defaultGatewayDataRoot(env);
	// The canonical directory identifies the singleton scope; resolve() so
	// two spellings of the same path cannot masquerade as two scopes.
	const dataDir = resolve(dataRoot, namespace);
	const botsDir = join(dataDir, "bots");
	const projectionsDir = join(dataDir, "projections");
	const secretsDir = join(dataDir, "secrets");
	return {
		dataDir,
		namespace,
		lockFile: join(dataDir, "gateway.lock"),
		databaseFile: join(dataDir, "gateway.db"),
		discoveryFile: join(dataDir, "gateway.json"),
		botsDir,
		projectionsDir,
		secretsDir,
		botDir: (botId) => join(botsDir, botId),
		workspacesDir: (botId) => join(botsDir, botId, "workspaces"),
		sessionWorkspaceDir: (botId, sessionId) =>
			join(botsDir, botId, "workspaces", sessionId),
		memoriesDir: (botId) => join(botsDir, botId, "memories"),
		secretFile: (name) => {
			if (!SECRET_NAME_PATTERN.test(name)) {
				throw new Error(`Invalid secret name "${name}"`);
			}
			return join(secretsDir, name);
		},
		sessionProjectionFile: (sessionId) =>
			join(projectionsDir, "sessions", `${sessionId}.json`),
	};
}

/** Create the data directory tree with owner-only permissions. */
export function ensureGatewayDataDir(paths: GatewayPaths): void {
	mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
	mkdirSync(paths.botsDir, { recursive: true, mode: 0o700 });
	mkdirSync(paths.projectionsDir, { recursive: true, mode: 0o700 });
	mkdirSync(paths.secretsDir, { recursive: true, mode: 0o700 });
}
