import type { WorkspaceContext } from "../extensions/context";
import type { WorkspaceInfo } from "../session/workspace";
import { DEFAULT_BEDROCK_CODER_SYSTEM_PROMPT } from "./system";

const WORKSPACE_CONFIGURATION_MARKER = "# Workspace Configuration";

/**
 * Explains the <user_input mode="..."> wrapper and <mode_notice> elements the
 * runtime stamps on user messages (prepareTurnInput / formatUserInputBlock).
 * Every host that sends through the SDK runtime produces those tags, so every
 * host's system prompt must explain them: without this section the model has
 * no idea what the attribute means, and a mid-conversation mode switch is an
 * invisible system-prompt swap it cannot diff. Included for BOTH modes, since
 * after a switch the transcript still contains messages tagged with the other
 * mode.
 */
export const MODE_TAG_INSTRUCTIONS = `# Plan / Act Modes

User messages arrive wrapped in a <user_input mode="..."> tag. The mode attribute is the interaction mode the user was in when they sent that message: "plan" means plan-mode constraints applied (explore, analyze, and align on a plan -- no edits or state-changing commands), while "act" means implementation was allowed. If the mode attribute changes between messages, the user switched modes -- the newest message's mode is what governs right now, regardless of what earlier messages allowed. A <mode_notice> block inside a message marks exactly when such a switch happened.`;

/**
 * Plan-mode behavioral contract, appended when the session mode is "plan".
 * Plan mode exposes only non-mutating tools. Terminal commands and every
 * state-changing operation belong in the plan for later execution in act mode.
 */
export const PLAN_MODE_INSTRUCTIONS = `# Plan Mode

You are in Plan mode. Your role is to explore, analyze, and plan -- not to execute.

- Read files, search the codebase, and gather context to understand the problem
- Ask clarifying questions when requirements are ambiguous
- Present your plan as a structured outline with clear steps
- Explain tradeoffs between different approaches when they exist
- Do NOT edit files, write code, run destructive commands, or make any changes
- Do NOT implement anything -- focus on understanding and alignment first

Terminal commands and state-changing tools are unavailable in plan mode. If the task requires a mutation, put it in the plan; it happens only after the user switches to act mode.

Once the user has reviewed your plan and explicitly approved it in a follow-up message, use the switch_to_act_mode tool to switch to act mode and begin implementation. Calling switch_to_act_mode immediately starts execution, so never call it in the same turn you present a plan and never treat the original task request as approval -- end your turn after presenting the plan and wait for the user's response.`;

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
 * Options for building the BedrockCoder system prompt.
 *
 * Extends WorkspaceContext so callers can spread an ExtensionContext.workspace
 * directly. `workspaceRoot` is accepted as an alias for `rootPath` to support
 * existing call sites that set it explicitly.
 */
export interface BedrockCoderSystemPromptOptions
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
	/** Provider ID — used to gate BedrockCoder-specific metadata injection */
}

export function buildBedrockCoderSystemPrompt(
	options: BedrockCoderSystemPromptOptions,
): string {
	const {
		ide = "Terminal Shell",
		mode,
		platform = "unknown",
		workspaceName,
		metadata,
		rules,
		overridePrompt,
	} = options;
	const workspaceRoot = options.workspaceRoot ?? options.rootPath ?? "";

	if (overridePrompt?.trim()) {
		const trimmed = overridePrompt.trim();
		if (metadata?.trim() && !trimmed.includes(WORKSPACE_CONFIGURATION_MARKER)) {
			return `${trimmed}\n\n${buildWorkspaceMetadata(workspaceRoot, workspaceName, metadata)}`.trim();
		}
		return trimmed;
	}

	const basePrompt = DEFAULT_BEDROCK_CODER_SYSTEM_PROMPT;

	// Mode semantics ride in the rules slot so every host emits them without
	// composing its own copy. Order matches what the CLI historically built by
	// hand (caller rules, then the mode-tag explanation, then the plan-mode
	// contract), keeping CLI output byte-identical after the promotion.
	const effectiveRules = [
		rules,
		MODE_TAG_INSTRUCTIONS,
		mode === "plan" ? PLAN_MODE_INSTRUCTIONS : undefined,
	]
		.filter(Boolean)
		.join("\n\n");

	return basePrompt
		.replace("{{PLATFORM_NAME}}", platform)
		.replace("{{CWD}}", workspaceRoot)
		.replace("{{CURRENT_DATE}}", new Date().toLocaleDateString())
		.replace("{{IDE_NAME}}", ide)
		.replace(
			"{{BEDROCK_CODER_METADATA}}",
			buildWorkspaceMetadata(workspaceRoot, workspaceName, metadata),
		)
		.replace("{{BEDROCK_CODER_RULES}}", effectiveRules)
		.trim();
}
