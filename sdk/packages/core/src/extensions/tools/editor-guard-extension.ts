/**
 * Plan-Mode Editor Guard Extension
 *
 * Runtime extension that hard-blocks file-editing tools (editor/apply_patch)
 * in plan mode via a `beforeTool` hook. Companion to the plan-mode command
 * guard (./command-guard-extension.ts): together they make "plan mode is
 * read-only" session policy enforced at execution time, so the plan and act
 * modes can expose an IDENTICAL serialized tool set (stable LLM prompt prefix
 * across mode switches) without relying on hiding tools from the model.
 *
 * The runtime builder registers this extension for plan-mode sessions. Because
 * `beforeTool` hooks run before tool policies and user approval, a blocked
 * call is rejected up front: the user is never asked to approve an edit that
 * would only fail, and the model receives the plan-mode error as the tool
 * result (`skip`, not `stop`, so the run continues).
 */

import type {
	AgentBeforeToolContext,
	AgentBeforeToolResult,
	AgentExtension,
	ITelemetryService,
} from "@cline/shared";
import { capturePlanModeToolBlocked } from "../../services/telemetry/core-events";
import { DefaultToolNames } from "./constants";

export const PLAN_MODE_EDITOR_GUARD_EXTENSION_NAME =
	"core.plan-mode-editor-guard";

/**
 * Tool names that mutate the filesystem. Covers both headless names the
 * editor catalog entry can expose ("editor", or "apply_patch" when the preset
 * prefers apply-patch).
 */
const EDITOR_TOOL_NAMES: ReadonlySet<string> = new Set([
	DefaultToolNames.EDITOR,
	DefaultToolNames.APPLY_PATCH,
]);

export interface PlanModeEditorGuardOptions {
	telemetry?: ITelemetryService;
}

function formatPlanModeBlockedEditorError(toolName: string): string {
	return `PLAN MODE: The ${toolName} tool is disabled in plan mode. You are in Plan mode, which is read-only -- do not edit or create files. Present your plan instead; the changes will be made once the user switches to act mode.`;
}

export function createPlanModeEditorGuardExtension(
	options: PlanModeEditorGuardOptions = {},
): AgentExtension {
	const beforeTool = (
		context: AgentBeforeToolContext,
	): AgentBeforeToolResult | undefined => {
		if (!EDITOR_TOOL_NAMES.has(context.tool.name)) {
			return undefined;
		}

		capturePlanModeToolBlocked(options.telemetry, {
			tool_name: context.tool.name,
			agent_id: context.snapshot.agentId,
			conversation_id: context.snapshot.conversationId,
			run_id: context.snapshot.runId,
			iteration: context.snapshot.iteration,
			tool_call_id: context.toolCall.toolCallId,
		});
		return {
			skip: true,
			reason: formatPlanModeBlockedEditorError(context.tool.name),
		};
	};

	return {
		name: PLAN_MODE_EDITOR_GUARD_EXTENSION_NAME,
		manifest: {
			capabilities: ["hooks"],
		},
		hooks: {
			beforeTool,
		},
	};
}
