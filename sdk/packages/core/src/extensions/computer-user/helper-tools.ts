import type { AgentTool } from "@cline/shared";
import { createTool, zodToJsonSchema } from "@cline/shared";
import { z } from "zod";
import type { ComputerUserCoordinator } from "./coordinator";

/**
 * Collaboration tools given to the computer-user helper session in place of
 * the generic `ask_question`/`submit_and_exit` built-ins. Questions and
 * completion go to the DRIVER agent (via the coordinator), never to the
 * human, and both terminal tools carry the structured report the driver
 * needs. `post_driver_update` is the non-terminal progress channel that
 * feeds status polling ("The computer user reported: ... 43 seconds ago")
 * and the replay artifact.
 */

const PostDriverUpdateInput = z
	.object({
		kind: z
			.enum(["progress", "observation", "warning"])
			.describe(
				"progress: routine milestone. observation: important fact the driver may need. warning: blocker or risk — this interrupts the driver.",
			),
		message: z
			.string()
			.trim()
			.min(1)
			.describe(
				"Concise, factual update. Report observations and decisions, never secrets or credentials.",
			),
	})
	.strict();

const AskDriverInput = z
	.object({
		question: z
			.string()
			.trim()
			.min(1)
			.describe("The specific decision or information you need."),
		context: z
			.string()
			.trim()
			.min(1)
			.describe(
				"What you observed and attempted, so the driver can answer without asking follow-ups.",
			),
		options: z
			.array(z.string().trim().min(1))
			.optional()
			.describe("Concrete choices when the decision is a selection."),
	})
	.strict();

const FinishComputerTaskInput = z
	.object({
		result: z
			.string()
			.trim()
			.min(1)
			.describe("The verified outcome of the delegated task."),
		observations: z
			.array(z.string().trim().min(1))
			.describe("Key facts observed while performing the task."),
	})
	.strict();

/**
 * Builds the three collaboration tools bound to a coordinator. Inputs are
 * validated with the zod schemas inside execute so the tools fit the
 * heterogeneous `AgentTool[]` contract without casts.
 */
export function createComputerUserCollaborationTools(
	coordinator: ComputerUserCoordinator,
): AgentTool[] {
	const postDriverUpdate = createTool({
		name: "post_driver_update",
		description:
			"Post a status note for the driver agent. The driver sees it when polling status; warnings interrupt the driver immediately. Use after understanding the task, at meaningful milestones, before long waits, and when blocked.",
		inputSchema: zodToJsonSchema(PostDriverUpdateInput),
		execute: async (input: unknown) => {
			const parsed = PostDriverUpdateInput.parse(input);
			coordinator.onHelperNote({ kind: parsed.kind, text: parsed.message });
			return { acknowledged: true };
		},
	});

	const askDriver = createTool({
		name: "ask_driver",
		description:
			"Ask the driver agent a question and end this run to wait for the answer. Use when required information is missing or the driver must choose between materially different actions. Do not continue acting after calling this.",
		inputSchema: zodToJsonSchema(AskDriverInput),
		lifecycle: { completesRun: true },
		execute: async (input: unknown) => {
			coordinator.onHelperQuestion(AskDriverInput.parse(input));
			return { delivered: true };
		},
	});

	const finishComputerTask = createTool({
		name: "finish_computer_task",
		description:
			"Report the completed task to the driver agent and end this run. Verify the requested outcome (inspect the final screen state) before calling. This is the only way to finish; do not finish with free-form text.",
		inputSchema: zodToJsonSchema(FinishComputerTaskInput),
		lifecycle: { completesRun: true },
		execute: async (input: unknown) => {
			coordinator.onHelperFinish(FinishComputerTaskInput.parse(input));
			return { delivered: true };
		},
	});

	return [postDriverUpdate, askDriver, finishComputerTask];
}
