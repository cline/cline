import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
	AgendaTaskPriority,
	AgendaTaskRecord,
	AgendaTaskType,
	HubCommandName,
} from "@cline/shared";
import { resolveWorkspaceTaskSpecsDir } from "@cline/shared/storage";
import { DEFAULT_TASK_PRIORITY, TASK_PROPOSAL_TTL_MS } from "../config";
import { HubCommandFailed, type HubLink } from "../hub/link";
import { isRecord } from "../values";

/** Upstream's spec file suffix: the file reconciler reads only files that end in it. */
const TASK_SPEC_SUFFIX = ".task.md";

/**
 * Tasks on the hub's Agenda. The hub is the store's only writer: the plugin
 * never opens `tasks.db`.
 *
 * - **Edits** go through `task.update` with the revision the person saw. A
 *   stale revision is answered with the newer task, never overwritten.
 * - **Proposals** are written as spec files in `<workspace>/.cline/tasks/`.
 *   The hub's `task.create` forces `requiresApproval: false` and records the
 *   caller as the user, so an agent proposal sent through it would be
 *   approved, and credited to the person, without them seeing it. A spec file
 *   is reconciled as `pending_approval`, created by the file reconciler, and
 *   `task.created` fires.
 */

export type TaskLink = Pick<HubLink, "command">;

/** The hub's `AgendaTaskRevisionConflictError` message: the reply's code is the generic `task_command_failed`, so the text is all that tells a conflict apart. */
const STALE_REVISION_TEXT = "the requested revision is stale";

export function isRevisionConflict(error: unknown): boolean {
	return (
		error instanceof HubCommandFailed &&
		error.message.includes(STALE_REVISION_TEXT)
	);
}

export type TaskWrite = { kind: "saved" | "conflict"; task: AgendaTaskRecord };

export type TaskEdit = {
	title?: string;
	priority?: AgendaTaskPriority;
	instructions?: string;
};

type Revisioned = Pick<AgendaTaskRecord, "taskId" | "revision">;

function taskOf(reply: Record<string, unknown>): AgendaTaskRecord {
	const { task } = reply;
	if (!isRecord(task) || typeof task.taskId !== "string")
		throw new Error("the hub's reply carried no task");
	return task as unknown as AgendaTaskRecord;
}

async function guarded(
	link: TaskLink,
	command: HubCommandName,
	task: Revisioned,
	payload: Record<string, unknown>,
): Promise<TaskWrite> {
	try {
		return {
			kind: "saved",
			task: taskOf(
				await link.command(command, {
					...payload,
					taskId: task.taskId,
					expectedRevision: task.revision,
				}),
			),
		};
	} catch (error) {
		if (!isRevisionConflict(error)) throw error;
		return {
			kind: "conflict",
			task: taskOf(await link.command("task.get", { taskId: task.taskId })),
		};
	}
}

export function editTask(
	link: TaskLink,
	task: Revisioned,
	edit: TaskEdit,
): Promise<TaskWrite> {
	return guarded(link, "task.update", task, edit);
}

/** Marks the task approved. Starting it is a chat message, so chat input stays the only actuator. */
export function approveTask(
	link: TaskLink,
	task: Revisioned,
): Promise<TaskWrite> {
	return guarded(link, "task.approve", task, {});
}

export function cancelTask(
	link: TaskLink,
	task: Revisioned,
	reason?: string,
): Promise<TaskWrite> {
	return guarded(link, "task.cancel", task, { reason });
}

/** `<workspace>/.cline/tasks`, from upstream's own resolver. */
export function workspaceTaskSpecsDir(workspaceRoot: string): string {
	return resolveWorkspaceTaskSpecsDir(workspaceRoot);
}

function within(dir: string, path: string): boolean {
	const rel = relative(resolve(dir), resolve(path));
	return (
		rel !== "" &&
		rel !== ".." &&
		!rel.startsWith(`..${sep}`) &&
		!isAbsolute(rel)
	);
}

/** The body of a task's spec, read-only, or nothing when the spec is missing or outside the specs directory. */
export function readSpecBody(
	specsDir: string,
	specPath: string | undefined,
): string | undefined {
	if (
		!specPath ||
		!specPath.endsWith(TASK_SPEC_SUFFIX) ||
		!within(specsDir, specPath)
	)
		return undefined;
	let raw: string;
	try {
		raw = readFileSync(specPath, "utf8");
	} catch {
		return undefined;
	}
	const match = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
	return (match ? (match[1] ?? "") : raw).trim();
}

export type Proposal = {
	title: string;
	instructions: string;
	description?: string;
	type?: AgendaTaskType;
	priority?: AgendaTaskPriority;
};

/**
 * A spec in upstream's format: YAML frontmatter, then the instructions. Every
 * value is written as JSON, which YAML reads as the same value, so no title
 * can break out of its field. Proposals never run on their own:
 * `automationEligible` is false.
 */
export function proposalSpec(
	taskId: string,
	proposal: Proposal,
	now: number,
): string {
	const fields: Record<string, unknown> = {
		taskId,
		type: proposal.type ?? "suggestion",
		priority: proposal.priority ?? DEFAULT_TASK_PRIORITY,
		title: proposal.title.trim(),
		...(proposal.description?.trim()
			? { description: proposal.description.trim() }
			: {}),
		expiresAt: new Date(now + TASK_PROPOSAL_TTL_MS).toISOString(),
		resourcePaths: [],
		automationEligible: false,
	};
	const yaml = Object.entries(fields)
		.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
		.join("\n");
	return `---\n${yaml}\n---\n\n${proposal.instructions.trim()}\n`;
}

export type Proposed = { taskId: string; specPath: string };

/**
 * Write the proposal's spec (never replacing a file), then ask the hub to
 * list tasks so it reconciles the spec now and publishes `task.created`. If
 * the hub is unreachable, the spec waits for the next list.
 */
export async function proposeTask(
	link: TaskLink | undefined,
	specsDir: string,
	proposal: Proposal,
	now: number = Date.now(),
): Promise<Proposed> {
	if (!proposal.title.trim() || !proposal.instructions.trim())
		throw new Error("a proposal needs a title and instructions");
	const taskId = `task_${randomUUID().replaceAll("-", "")}`;
	const specPath = join(specsDir, `${taskId}${TASK_SPEC_SUFFIX}`);
	mkdirSync(specsDir, { recursive: true });
	writeFileSync(specPath, proposalSpec(taskId, proposal, now), { flag: "wx" });
	await link?.command("task.list", { limit: 1 }).catch(() => undefined);
	return { taskId, specPath };
}
