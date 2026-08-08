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
 */

import type {
	AgentBeforeToolContext,
	AgentBeforeToolResult,
	AgentExtension,
	ITelemetryService,
} from "@cline/shared";
import { capturePlanModeCommandBlocked } from "../../services/telemetry/core-events";
import {
	findFileEditingCommand,
	formatPlanModeBlockedCommandError,
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

	return {
		name: PLAN_MODE_COMMAND_GUARD_EXTENSION_NAME,
		manifest: {
			capabilities: ["hooks"],
		},
		hooks: {
			beforeTool,
		},
	};
}
