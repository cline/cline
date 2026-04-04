import type { WorkspaceInfo } from "../index.browser";
import {
	DEFAULT_CLINE_SYSTEM_PROMPT,
	YOLO_CLINE_SYSTEM_PROMPT,
} from "./system";

const WORKSPACE_CONFIGURATION_MARKER = "# Workspace Configuration";

export function processWorkspaceInfo(info: WorkspaceInfo): string {
	const workspaceConfig = {
		workspaces: {
			[info.rootPath]: {
				hint: info.hint,
				associatedRemoteUrls: info.associatedRemoteUrls,
				latestGitCommitHash: info.latestGitCommitHash,
				latestGitBranchName: info.latestGitBranchName,
			},
		},
	};
	return JSON.stringify(workspaceConfig, null, 2);
}

function buildWorkspaceMetadata(
	rootPath: string,
	workspaceName?: string,
	metadata?: string,
): string {
	if (metadata?.trim() && metadata.includes(WORKSPACE_CONFIGURATION_MARKER)) {
		return metadata.trim();
	}
	return `\n${WORKSPACE_CONFIGURATION_MARKER}\n${
		metadata ||
		JSON.stringify(
			{
				workspaces: {
					[rootPath]: {
						hint: workspaceName || rootPath.split("/").slice(-1)[0] || rootPath, // Use the folder name as hint
					},
				},
			},
			null,
			2,
		)
	}`;
}

interface ClineSystemPromptOptions {
	ide: string;
	mode?: string;
	platform?: string;
	workspaceRoot: string;
	workspaceName?: string;
	metadata?: string;
	rules?: string;
	overridePrompt?: string;
	providerId?: string;
}

export function buildClineSystemPrompt(options: ClineSystemPromptOptions) {
	const {
		ide,
		mode,
		platform = "unknown",
		workspaceRoot,
		workspaceName,
		metadata,
		rules,
		overridePrompt,
		providerId,
	} = options;
	const isCline = providerId === "cline";
	const defaultPrompt =
		mode === "yolo" ? YOLO_CLINE_SYSTEM_PROMPT : DEFAULT_CLINE_SYSTEM_PROMPT;

	if (overridePrompt?.trim()) {
		const trimmedOverride = overridePrompt.trim();
		// overridePrompt is a raw string — {{CLINE_METADATA}} won't be present,
		// so append workspace metadata directly when it's missing.
		const workspaceMetadataBlock =
			isCline && metadata?.trim()
				? buildWorkspaceMetadata(workspaceRoot, workspaceName, metadata)
				: null;
		const needsMetadata =
			workspaceMetadataBlock &&
			!trimmedOverride.includes(WORKSPACE_CONFIGURATION_MARKER);
		const finalPrompt = needsMetadata
			? `${trimmedOverride}\n\n${workspaceMetadataBlock}`
			: trimmedOverride;
		return finalPrompt.trim();
	}

	return defaultPrompt
		.replace("{{PLATFORM_NAME}}", platform)
		.replace("{{CWD}}", workspaceRoot)
		.replace("{{CURRENT_DATE}}", new Date().toLocaleDateString())
		.replace("{{IDE_NAME}}", ide)
		.replace(
			"{{CLINE_METADATA}}",
			isCline
				? buildWorkspaceMetadata(workspaceRoot, workspaceName, metadata)
				: "",
		)
		.replace("{{CLINE_RULES}}", rules || "")
		.trim();
}
