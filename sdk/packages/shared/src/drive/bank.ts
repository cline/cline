/**
 * Drive task bank schemas.
 *
 * Plans are ordered refs to tasks. Tasks are the durable implementable unit.
 */

import { z } from "zod";

export const DRIVE_BANK_ROOT = ".drive/bank";

export const DriveTaskStatusSchema = z.enum([
	"open",
	"in_progress",
	"done",
]);

export const DrivePlanStatusSchema = z.enum(["draft", "active", "closed"]);

export const DriveTaskSchema = z
	.object({
		id: z.string().min(1),
		title: z.string().min(1),
		body: z.string(),
		status: DriveTaskStatusSchema,
		lastFailure: z.string().optional(),
	})
	.strict();

export const DrivePlanSchema = z
	.object({
		id: z.string().min(1),
		title: z.string().min(1),
		taskIds: z.array(z.string().min(1)),
		status: DrivePlanStatusSchema,
	})
	.strict();

export const BankSnapshotSchema = z
	.object({
		activePlanId: z.string().nullable(),
		openTaskIds: z.array(z.string()),
		nowTaskId: z.string().nullable(),
		nextTaskId: z.string().nullable(),
		nowTitle: z.string().nullable(),
		nextTitle: z.string().nullable(),
	})
	.strict();

export type DriveTaskStatus = z.infer<typeof DriveTaskStatusSchema>;
export type DrivePlanStatus = z.infer<typeof DrivePlanStatusSchema>;
export type DriveTask = z.infer<typeof DriveTaskSchema>;
export type DrivePlan = z.infer<typeof DrivePlanSchema>;
export type BankSnapshot = z.infer<typeof BankSnapshotSchema>;

export function parseDriveTask(input: unknown): DriveTask {
	return DriveTaskSchema.parse(input);
}

export function parseDrivePlan(input: unknown): DrivePlan {
	return DrivePlanSchema.parse(input);
}

export function parseBankSnapshot(input: unknown): BankSnapshot {
	return BankSnapshotSchema.parse(input);
}
