import {
	type Tool,
	type ToolContext,
	validateWithZod,
	zodToJsonSchema,
} from "@clinebot/shared";
import { z } from "zod";
import { createTool } from "./create";

export const AskQuestionInputSchema = z.object({
	question: z
		.string()
		.min(1)
		.describe(
			'The single question to ask the user. E.g. "How can I help you?"',
		),
	options: z
		.array(z.string().min(1))
		.min(2)
		.max(5)
		.describe(
			"Array of 2-5 user-selectable answer options for the single question",
		),
});

export type AskQuestionInput = z.infer<typeof AskQuestionInputSchema>;

export type AskQuestionExecutor = (
	question: string,
	options: string[],
	context: ToolContext,
) => Promise<string>;

export interface AskQuestionToolConfig {
	askQuestionTimeoutMs?: number;
}

function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message: string,
): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(message)), ms);
		}),
	]);
}

export function createAskQuestionTool(
	executor: AskQuestionExecutor,
	config: AskQuestionToolConfig = {},
): Tool<AskQuestionInput, string> {
	const timeoutMs = config.askQuestionTimeoutMs ?? 15000;

	return createTool<AskQuestionInput, string>({
		name: "ask_question",
		description:
			"Ask user a question for clarifying or gathering information needed to complete the task. " +
			"For example, ask the user clarifying questions about a key implementation decision. " +
			"You should only ask one question. " +
			"Provide an array of 2-5 options for the user to choose from. " +
			"Never include an option to toggle to Act mode.",
		inputSchema: zodToJsonSchema(AskQuestionInputSchema),
		timeoutMs,
		retryable: false,
		maxRetries: 0,
		execute: async (input, context) => {
			const validatedInput = validateWithZod(AskQuestionInputSchema, input);
			return withTimeout(
				executor(validatedInput.question, validatedInput.options, context),
				timeoutMs,
				`ask_question timed out after ${timeoutMs}ms`,
			);
		},
	});
}
