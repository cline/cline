import type { BasicLogger } from "../logging/logger";
import type { ITelemetryService } from "../services/telemetry";
import type { WorkspaceInfo } from "../session/workspace";

/**
 * The IDE or client surface the user is running Cline from.
 */
export type ClientName =
	| "cline-vscode"
	| "cline-jetbrains"
	| "cline-cli"
	| "cline-sdk"
	| "cline-kanban"
	| "cline-acp"
	| "cline-platform"
	| (string & {});

/**
 * Identity of the calling client (surface + version).
 */
export interface ClientContext {
	/** e.g. "cline-vscode", "cline-cli", "cline-sdk" */
	name: ClientName;
	/** Semver string, e.g. "3.12.0" */
	version?: string;
}

/**
 * Identity of the authenticated user.
 */
export interface UserContext {
	/** PostHog / analytics distinct ID */
	distinctId?: string;
	email?: string;
	organizationId?: string;
}

/**
 * Everything needed to describe the workspace and build the system prompt.
 *
 * Extends WorkspaceInfo (rootPath + git fields) with the additional fields
 * required by buildClineSystemPrompt, so callers can spread a WorkspaceInfo
 * and add only what they know.
 */
export interface WorkspaceContext extends WorkspaceInfo {
	/**
	 * Current working directory. May differ from rootPath in multi-root
	 * workspaces or when the user cd'd inside the workspace.
	 */
	cwd?: string;
	/** Human-readable workspace name shown in the system prompt */
	workspaceName?: string;
	/**
	 * Pre-serialized workspace metadata block that replaces {{CLINE_METADATA}}
	 * in the system prompt template.
	 */
	metadata?: string;
	/** Agent mode: "act" | "plan" | "yolo" */
	mode?: string;
	/** Additional rules/instructions injected into the system prompt */
	rules?: string;
	/** IDE display name, e.g. "VS Code", "JetBrains", "Terminal Shell" */
	ide?: string;
	/** Node process.platform string, e.g. "darwin", "win32", "linux" */
	platform?: string;
}

/**
 * Ambient runtime context carried alongside ProviderConfig.
 *
 * Captures who is calling (user + client), where they are (workspace),
 * and which services to use for logging and telemetry. None of these
 * belong in the LLM provider credential config.
 */
export interface ExtensionContext {
	user?: UserContext;
	client?: ClientContext;
	workspace?: WorkspaceContext;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}
