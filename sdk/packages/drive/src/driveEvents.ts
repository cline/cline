import type { BankDriveEvent } from "@cline/shared";

const DRIVE_BANK_EVENT_SCHEMA_VERSION = 1 as const;

let seq = 0;

function nextId(): string {
	seq += 1;
	return `drive-evt-${seq}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

export function resetDriveEventSeqForTests(): void {
	seq = 0;
}

function asBankEvent(event: BankDriveEvent): BankDriveEvent {
	return event;
}

export function createDriveTaskOpenedEvent(input: {
	roomId: string;
	taskId: string;
	title: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		roomId: input.roomId,
		type: "drive_task_opened",
		taskId: input.taskId,
		title: input.title,
	});
}

export function createDriveTaskBoundEvent(input: {
	roomId: string;
	taskId: string;
	planId: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		roomId: input.roomId,
		type: "drive_task_bound",
		taskId: input.taskId,
		planId: input.planId,
	});
}

export function createDriveTaskCompletedEvent(input: {
	roomId: string;
	taskId: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		roomId: input.roomId,
		type: "drive_task_completed",
		taskId: input.taskId,
	});
}

export function createDriveTaskArchivedEvent(input: {
	roomId: string;
	taskId: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		roomId: input.roomId,
		type: "drive_task_archived",
		taskId: input.taskId,
	});
}

export function createDrivePlanActivatedEvent(input: {
	roomId: string;
	planId: string;
	title: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		roomId: input.roomId,
		type: "drive_plan_activated",
		planId: input.planId,
		title: input.title,
	});
}

export function createDrivePlanArchivedEvent(input: {
	roomId: string;
	planId: string;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		roomId: input.roomId,
		type: "drive_plan_archived",
		planId: input.planId,
	});
}

export function createDrivePlanStepEvent(input: {
	roomId: string;
	planId: string;
	taskId: string;
	title: string;
	position: number;
}): BankDriveEvent {
	return asBankEvent({
		schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
		id: nextId(),
		at: nowIso(),
		roomId: input.roomId,
		type: "drive_plan_step",
		planId: input.planId,
		taskId: input.taskId,
		title: input.title,
		position: input.position,
	});
}
