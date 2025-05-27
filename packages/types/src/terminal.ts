import { z } from "zod"

/**
 * CommandExecutionStatus
 */

export const commandExecutionStatusSchema = z.discriminatedUnion("status", [
	z.object({
		executionId: z.string(),
		status: z.literal("started"),
		pid: z.number().optional(),
		command: z.string(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("output"),
		output: z.string(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("exited"),
		exitCode: z.number().optional(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("fallback"),
	}),
])

export type CommandExecutionStatus = z.infer<typeof commandExecutionStatusSchema>
