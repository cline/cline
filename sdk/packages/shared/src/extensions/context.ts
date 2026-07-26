import type { BasicLogger } from "../logging/logger";
import type { WorkspaceInfo } from "../session/workspace";
import type { AgentExtensionSessionContext } from "./contribution-registry";

/**
 * The IDE or client surface the user is running BedrockCoder from.
 */
export type ClientName =
	| "bedrock-coder-vscode"
	| "bedrock-coder-jetbrains"
	| "bedrock-coder-cli"
	| "bedrock-coder-sdk"
	| "bedrock-coder-kanban"
	| "bedrock-coder-acp"
	| "bedrock-coder-platform"
	| (string & {});

/**
 * Identity of the calling client and host surface.
 */
export interface ClientContext {
	/** Client type emitted to BedrockCoder request headers, e.g. "VSCode Extension", "bedrock-coder-cli", "bedrock-coder-sdk" */
	name: ClientName;
	/** BedrockCoder client/extension semver string, e.g. "3.12.0" */
	version?: string;
	/** Host platform display name, e.g. "Visual Studio Code", "Cursor", "cli" */
	platform?: string;
	/** Host platform version, e.g. vscode.version or the CLI version */
	platformVersion?: string;
	/** Whether the host workspace currently has multiple roots. */
	isMultiRoot?: boolean;
}

/**
 * Everything needed to describe the workspace and build the system prompt.
 *
 * Extends WorkspaceInfo (rootPath + git fields) with the additional fields
 * required by buildBedrockCoderSystemPrompt, so callers can spread a WorkspaceInfo
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
	 * Pre-serialized workspace metadata block that replaces {{BEDROCK_CODER_METADATA}}
	 * in the system prompt template.
	 */
	metadata?: string;
	/** Agent mode: "act" | "plan" */
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
 * Captures the client surface, workspace, and local services that do not
 * belong in the LLM provider credential config.
 */
export interface ExtensionContext {
	client?: ClientContext;
	workspace?: WorkspaceContext;
	/** Core session metadata forwarded into plugin setup context. */
	session?: AgentExtensionSessionContext;
	logger?: BasicLogger;
}
