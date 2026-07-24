import type { AgentTool } from "@cline/shared";
import { createTool, zodToJsonSchema } from "@cline/shared";
import { z } from "zod";
import type { ComputerUserCoordinator } from "./coordinator";

/**
 * Driver-facing tools for delegating GUI work to the asynchronous computer
 * user. All four return immediately; the helper's results, questions, and
 * warnings arrive later as steer messages injected into the driver's
 * conversation. The tools are separate (rather than one action union)
 * because their approval semantics differ: hosts typically auto-approve
 * status polling while gating start/interrupt.
 */

const StartInput = z
	.object({
		task: z
			.string()
			.trim()
			.min(1)
			.describe(
				"The task to delegate. Include the goal, any constraints, and what evidence you need back.",
			),
	})
	.strict();

const MessageInput = z
	.object({
		message: z
			.string()
			.trim()
			.min(1)
			.describe(
				"Guidance, an answer to the computer user's question, or a follow-up task.",
			),
	})
	.strict();

const InterruptInput = z
	.object({
		reason: z
			.string()
			.trim()
			.min(1)
			.optional()
			.describe("Why the work should stop. Shown to the computer user."),
	})
	.strict();

const StatusInput = z.object({}).strict();

/** Builds the driver-facing computer-user tools bound to one coordinator. */
export function createComputerUserDriverTools(
	coordinator: ComputerUserCoordinator,
): AgentTool[] {
	const start = createTool({
		name: "computer_user_start",
		description:
			"Delegate a task requiring GUI/computer interaction to the computer user, a separate agent controlling a computer environment. Returns immediately; you will be notified in this conversation when it finishes, fails, or has a question. Continue with other work meanwhile, or poll computer_user_status.",
		inputSchema: zodToJsonSchema(StartInput),
		retryable: false,
		execute: async (input: unknown) => {
			const parsed = StartInput.parse(input);
			const { sessionId, runId } = await coordinator.start(parsed.task);
			return {
				status: "started",
				sessionId,
				runId,
				note: "The computer user is working in the background. You will be notified here when it reports.",
			};
		},
	});

	const status = createTool({
		name: "computer_user_status",
		description:
			"Check what the computer user is doing right now: its latest posted update (with age), current state, and any pending question. Use while waiting instead of assuming progress.",
		inputSchema: zodToJsonSchema(StatusInput),
		execute: async () => coordinator.status(),
	});

	const message = createTool({
		name: "computer_user_message",
		description:
			"Send a message to the computer user: answer its question, adjust its instructions mid-task, or give it a follow-up task in the same session. Steers a running task at its next step; starts a new turn when it is idle or waiting. Returns immediately.",
		inputSchema: zodToJsonSchema(MessageInput),
		retryable: false,
		execute: async (input: unknown) => {
			const parsed = MessageInput.parse(input);
			const { delivered } = await coordinator.message(parsed.message);
			return {
				status: "delivered",
				delivered,
				note:
					delivered === "steer"
						? "The computer user will see this at its next step."
						: "The computer user started a new turn with this message.",
			};
		},
	});

	const interrupt = createTool({
		name: "computer_user_interrupt",
		description:
			"Stop the computer user's current work immediately. Its session and memory of the task survive; send computer_user_message afterwards to redirect it. An input action already delivered to the computer may still take effect.",
		inputSchema: zodToJsonSchema(InterruptInput),
		retryable: false,
		execute: async (input: unknown) => {
			const parsed = InterruptInput.parse(input);
			const { interrupted } = await coordinator.interrupt(parsed.reason);
			return interrupted
				? {
						status: "interrupting",
						note: "You will be notified here when it has stopped.",
					}
				: {
						status: "not_running",
						note: "The computer user was not running; nothing to interrupt.",
					};
		},
	});

	return [start, status, message, interrupt];
}
