/**
 * Plan-Mode Command Guard Extension
 *
 * Runtime extension that enforces the plan-mode command blacklist
 * (./command-guard.ts) as a `beforeTool` hook. The runtime builder registers
 * it for plan-mode sessions, making command blocking session policy in one
 * shared place: the hook fires for every `run_commands` tool in the runtime —
 * the SDK built-in and host-provided replacements like the VS Code
 * extension's terminal-backed tool — without threading a flag through each
 * layer.
 *
 * Because `beforeTool` hooks run before tool policies and user approval,
 * a blocked call is rejected up front: the user is never asked to approve a
 * command that would only fail, and the model receives the plan-mode error
 * as the tool result (`skip`, not `stop`, so the run continues).
 *
 * The extension also registers an `onUnknownTool` hook: plan mode removes the
 * file-editing tools from the runtime, so a model that calls `editor` /
 * `write_to_file` / etc. anyway produces an unknown tool call. The hook
 * replaces the generic `Unknown tool` error with the explicit plan-mode
 * contract so the model plans the edit instead of hunting for workarounds.
 */

import type {
	AgentBeforeToolContext,
	AgentBeforeToolResult,
	AgentExtension,
	AgentUnknownToolContext,
	AgentUnknownToolResult,
	ITelemetryService,
} from "@cline/shared";
import {
	capturePlanModeCommandBlocked,
	capturePlanModeEditToolBlocked,
} from "../../services/telemetry/core-events";
import {
	findBlockedEditToolName,
	findFileEditingCommand,
	formatPlanModeBlockedCommandError,
	formatPlanModeBlockedEditToolError,
} from "./command-guard";
import { DefaultToolNames } from "./constants";
import { normalizeRunCommandsInput } from "./helpers";

export const PLAN_MODE_COMMAND_GUARD_EXTENSION_NAME =
	"core.plan-mode-command-guard";

export interface PlanModeCommandGuardOptions {
	telemetry?: ITelemetryService;
}

export function createPlanModeCommandGuardExtension(
	options: PlanModeCommandGuardOptions = {},
): AgentExtension {
	const beforeTool = (
		context: AgentBeforeToolContext,
	): AgentBeforeToolResult | undefined => {
		if (context.tool.name !== DefaultToolNames.RUN_COMMANDS) {
			return undefined;
		}

		let commands: ReturnType<typeof normalizeRunCommandsInput>;
		try {
			commands = normalizeRunCommandsInput(context.input);
		} catch {
			// Unparseable input: let the tool produce its own validation error.
			return undefined;
		}

		for (const command of commands) {
			const blocked = findFileEditingCommand(command);
			if (blocked) {
				capturePlanModeCommandBlocked(options.telemetry, {
					tool_name: "run_commands",
					blocked_construct: blocked,
					command_count: commands.length,
					agent_id: context.snapshot.agentId,
					conversation_id: context.snapshot.conversationId,
					run_id: context.snapshot.runId,
					iteration: context.snapshot.iteration,
					tool_call_id: context.toolCall.toolCallId,
				});
				return {
					skip: true,
					reason: formatPlanModeBlockedCommandError(blocked),
				};
			}
		}

		return undefined;
	};

	// Plan mode removes the file-editing tools from the runtime entirely, so a
	// model that tries to edit anyway (typically after an act -> plan switch
	// left successful edits in the transcript) produces an *unknown* tool
	// call. The default `Unknown tool: editor` error reads like a transient
	// failure and sends models hunting for workarounds; replace it with the
	// same explicit plan-mode contract the command blacklist uses.
	const onUnknownTool = (
		context: AgentUnknownToolContext,
	): AgentUnknownToolResult | undefined => {
		const blocked = findBlockedEditToolName(context.toolCall.toolName);
		if (!blocked) {
			return undefined;
		}
		capturePlanModeEditToolBlocked(options.telemetry, {
			tool_name: blocked,
			agent_id: context.snapshot.agentId,
			conversation_id: context.snapshot.conversationId,
			run_id: context.snapshot.runId,
			iteration: context.snapshot.iteration,
			tool_call_id: context.toolCall.toolCallId,
		});
		return {
			reason: formatPlanModeBlockedEditToolError(blocked),
		};
	};

	return {
		name: PLAN_MODE_COMMAND_GUARD_EXTENSION_NAME,
		manifest: {
			capabilities: ["hooks"],
		},
		hooks: {
			beforeTool,
			onUnknownTool,
		},
	};
}
