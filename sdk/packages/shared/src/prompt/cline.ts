import type { WorkspaceContext } from "../extensions/context";
import type { WorkspaceInfo } from "../session/workspace";
import {
	AGENT_PERSONA_SLOT,
	composeClineSystemPrompt,
	YOLO_CLINE_SYSTEM_PROMPT,
} from "./system";

const WORKSPACE_CONFIGURATION_MARKER = "# Workspace Configuration";

export function processWorkspaceInfo(info: WorkspaceInfo): string {
	return JSON.stringify(
		{
			workspaces: {
				[info.rootPath]: {
					hint: info.hint,
					associatedRemoteUrls: info.associatedRemoteUrls,
					latestGitCommitHash: info.latestGitCommitHash,
					latestGitBranchName: info.latestGitBranchName,
				},
			},
		},
		null,
		2,
	);
}

function buildWorkspaceMetadata(
	rootPath: string,
	workspaceName?: string,
	metadata?: string,
): string {
	if (metadata?.trim()?.includes(WORKSPACE_CONFIGURATION_MARKER)) {
		return metadata.trim();
	}
	const body =
		metadata ||
		JSON.stringify(
			{
				workspaces: {
					[rootPath]: {
						hint: workspaceName || rootPath.split("/").at(-1) || rootPath,
					},
				},
			},
			null,
			2,
		);
	return `\n${WORKSPACE_CONFIGURATION_MARKER}\n${body}`;
}

/**
 * Options for building the Cline system prompt.
 *
 * Extends WorkspaceContext so callers can spread an ExtensionContext.workspace
 * directly. `workspaceRoot` is accepted as an alias for `rootPath` to support
 * existing call sites that set it explicitly.
 */
export interface ClineSystemPromptOptions
	extends Omit<WorkspaceContext, "rootPath"> {
	/**
	 * Workspace root path. Accepts either `rootPath` (from WorkspaceContext/WorkspaceInfo)
	 * or `workspaceRoot` (legacy alias) — whichever is provided will be used.
	 */
	rootPath?: string;
	/** Alias for rootPath — kept for backwards compatibility with existing call sites */
	workspaceRoot?: string;
	/** Per-request system prompt override */
	overridePrompt?: string;
	/**
	 * Agent-profile persona: replaces the default Cline persona and its
	 * working guidelines while keeping the agent harness. Ignored when
	 * `overridePrompt` is set or in yolo mode.
	 */
	personaPrompt?: string;
	/** Provider ID — used to gate Cline-specific metadata injection */
	providerId?: string;
}

export function buildClineSystemPrompt(
	options: ClineSystemPromptOptions,
): string {
	const {
		ide = "Terminal Shell",
		mode,
		platform = "unknown",
		workspaceName,
		metadata,
		rules,
		overridePrompt,
		personaPrompt,
		providerId,
	} = options;
	const workspaceRoot = options.workspaceRoot ?? options.rootPath ?? "";
	const isCline = providerId === "cline";

	if (overridePrompt?.trim()) {
		const trimmed = overridePrompt.trim();
		if (
			isCline &&
			metadata?.trim() &&
			!trimmed.includes(WORKSPACE_CONFIGURATION_MARKER)
		) {
			return `${trimmed}\n\n${buildWorkspaceMetadata(workspaceRoot, workspaceName, metadata)}`.trim();
		}
		return trimmed;
	}

	const persona = mode === "yolo" ? undefined : personaPrompt?.trim();
	// Keep the persona slot in place and fill it last, so `{{...}}` sequences
	// inside a persona body stay literal.
	const basePrompt =
		mode === "yolo"
			? YOLO_CLINE_SYSTEM_PROMPT
			: composeClineSystemPrompt(
					persona ? { persona: AGENT_PERSONA_SLOT } : {},
				);
	// Skip metadata injection when the persona already embeds a workspace
	// configuration block (e.g. spawn prompts composed by a parent agent).
	const includeMetadata =
		isCline && !persona?.includes(WORKSPACE_CONFIGURATION_MARKER);

	// Replacer functions (not replacement strings) so values containing
	// `$&`-style patterns are inserted literally.
	return basePrompt
		.replace("{{PLATFORM_NAME}}", () => platform)
		.replace("{{CWD}}", () => workspaceRoot)
		.replace("{{CURRENT_DATE}}", () => new Date().toLocaleDateString())
		.replace("{{IDE_NAME}}", () => ide)
		.replace("{{CLINE_METADATA}}", () =>
			includeMetadata
				? buildWorkspaceMetadata(workspaceRoot, workspaceName, metadata)
				: "",
		)
		.replace("{{CLINE_RULES}}", () => rules || "")
		.replace(AGENT_PERSONA_SLOT, () => persona ?? "")
		.trim();
}
