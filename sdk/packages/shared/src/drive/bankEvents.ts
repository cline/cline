/**
 * Bank/task Drive event schemas (task bank lifecycle).
 *
 * Full DRV-EVENTS surface lands incrementally; this module owns the versioned
 * union members needed by the task bank and now/next cursor.
 */

import { z } from "zod";

export const DRIVE_BANK_EVENT_SCHEMA_VERSION = 1 as const;

const DriveEventBaseSchema = z.object({
	schemaVersion: z.literal(DRIVE_BANK_EVENT_SCHEMA_VERSION),
	id: z.string().min(1),
	at: z.string().datetime(),
	roomId: z.string().min(1),
});

export const DriveTaskOpenedEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("drive_task_opened"),
	taskId: z.string().min(1),
	title: z.string().min(1),
}).strict();

export const DriveTaskBoundEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("drive_task_bound"),
	taskId: z.string().min(1),
	planId: z.string().min(1),
}).strict();

export const DriveTaskCompletedEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("drive_task_completed"),
	taskId: z.string().min(1),
}).strict();

export const DriveTaskArchivedEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("drive_task_archived"),
	taskId: z.string().min(1),
}).strict();

export const DrivePlanActivatedEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("drive_plan_activated"),
	planId: z.string().min(1),
	title: z.string().min(1),
}).strict();

export const DrivePlanArchivedEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("drive_plan_archived"),
	planId: z.string().min(1),
}).strict();

export const DrivePlanStepEventSchema = DriveEventBaseSchema.extend({
	type: z.literal("drive_plan_step"),
	planId: z.string().min(1),
	taskId: z.string().min(1),
	title: z.string().min(1),
	position: z.number().int().nonnegative(),
}).strict();

export const BankDriveEventSchema = z.discriminatedUnion("type", [
	DriveTaskOpenedEventSchema,
	DriveTaskBoundEventSchema,
	DriveTaskCompletedEventSchema,
	DriveTaskArchivedEventSchema,
	DrivePlanActivatedEventSchema,
	DrivePlanArchivedEventSchema,
	DrivePlanStepEventSchema,
]);

export type BankDriveEvent = z.infer<typeof BankDriveEventSchema>;
export type BankDriveEventType = BankDriveEvent["type"];

const BANK_FORBIDDEN_PAYLOAD_KEYS = [
	"audio",
	"rawTranscript",
	"transcript",
	"rawFrame",
	"imageBytes",
	"videoBytes",
	"pcm",
	"pixels",
] as const;

export function parseBankDriveEvent(input: unknown): BankDriveEvent {
	const event = BankDriveEventSchema.parse(input);
	assertNoForbiddenBankPayloadKeys(event);
	return event;
}

export function assertNoForbiddenBankPayloadKeys(
	value: unknown,
	path: string[] = [],
): void {
	if (value === null || typeof value !== "object") {
		return;
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoForbiddenBankPayloadKeys(item, [...path, String(index)]);
		}
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		if (
			(BANK_FORBIDDEN_PAYLOAD_KEYS as readonly string[]).includes(key)
		) {
			throw new Error(
				`Drive event payload must not include forbidden key "${key}" at ${[...path, key].join(".") || "(root)"}`,
			);
		}
		assertNoForbiddenBankPayloadKeys(child, [...path, key]);
	}
}

/** Exhaustive switch helper for DriveEvent.type. */
export function assertNeverBankDriveEventType(type: never): never {
	throw new Error(`Unhandled DriveEvent type: ${String(type)}`);
}
