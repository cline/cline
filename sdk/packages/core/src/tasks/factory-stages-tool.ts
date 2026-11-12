import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import {
	type AgentTool,
	createTool,
	FACTORY_STAGES_PATH,
	type FactoryRepositoryStage,
	factoryStageSchema,
	factoryStagesFileSchema,
	zodToJsonSchema,
} from "@cline/shared";
import { z } from "zod";
import { writeFileAtomic } from "../session/stores/atomic-file";
import type { AgendaTaskManagerApi } from "./agenda-task-api";
import {
	screenFactoryGuidance,
	unifiedFactoryGuidanceDiff,
} from "./factory-guidance";
import {
	type FactoryStagesRead,
	type FactoryStageTrustStatus,
	factoryStageHash,
	readFactoryStages,
} from "./factory-stages";
import {
	awaitFactoryManagerConfirmation,
	FACTORY_GUIDANCE_CONFIRM_TTL_MS,
	FactoryProjectError,
	requireFactoryManagerProject,
} from "./factory-tool";
import {
	describeIssues,
	factoryUnsafeCommandProblems,
} from "./factory-verification-profile";

// ---------------------------------------------------------------------------
// Factory manager: repository stages (.cline/factory/stages.json)

export const FACTORY_STAGES_TOOL_NAME = "factory_stages";

/** Shown to the person beside a stage that can edit the change before review. */
export const FACTORY_STAGE_WRITE_WARNING =
	"This stage can change code before review.";
/** Shown to the person beside a command stage. */
export const FACTORY_STAGE_COMMAND_WARNING =
	"This command will run on your machine as you.";

const FACTORY_STAGE_REFUSAL =
	"A repository stage adds one check or one task after the build. It cannot skip or change approval, review, publishing or spending limits, give agents more tools or permissions, or tell agents to ignore their rules; those stay in Factory settings and with the user.";

/**
 * Stage wording the role screen does not cover: publishing. The engine never
 * lets a stage publish; refusing the wording keeps the definition honest. A
 * clause that negates it ("do not push") passes.
 */
const PUBLISH_SCREEN =
	/\b(git push|push\b[^.\n]{0,20}\b(branch|changes|commits?|to (origin|github|the remote))|(open|create|submit)\b[^.\n]{0,15}\b(pull requests?|PRs?)|(npm|bun|pnpm|yarn) publish|merge\b[^.\n]{0,20}\b(pull requests?|PRs?|the branch))\b/i;
const NEGATION = /\b(not|never|don'?t|cannot|can'?t|no)\b/i;

/** What a stage definition would do that no stage may, or undefined. */
function screenFactoryStage(stage: FactoryRepositoryStage): string | undefined {
	const text = [
		stage.name,
		stage.kind === "agent" ? stage.instruction : undefined,
	]
		.filter(Boolean)
		.join("\n");
	return (
		screenFactoryGuidance(text) ??
		(text
			.split(/[.;\n]/)
			.some((clause) => !NEGATION.test(clause) && PUBLISH_SCREEN.test(clause))
			? "publish, push or merge work"
			: undefined)
	);
}

const STATUS_TEXT: Record<FactoryStageTrustStatus, string> = {
	approved: "in use",
	needs_approval: "needs approval",
	changed: "changed since approved",
	declined: "not used",
};

export const FactoryStagesToolInputSchema = z
	.object({
		action: z
			.enum(["show", "propose", "apply"])
			.describe(
				"show lists the project's repository stages and their status; propose returns a diff of .cline/factory/stages.json and a proposal_id without writing; apply asks the user to confirm that proposal in the app and saves it only if they do",
			),
		project: z
			.string()
			.trim()
			.min(1)
			.max(1000)
			.optional()
			.describe(
				"The project, by its name or path from factory_status projects. Required for show and propose",
			),
		change: z
			.object({
				set: z
					.record(z.string(), z.unknown())
					.optional()
					.describe(
						'A full stage definition to add, or to replace the stage with the same id. Command stage: {"id","name","kind":"command","command", optional "artifacts" (paths), "when", "blocking", "timeoutSeconds"}. Agent stage: {"id","name","kind":"agent","instruction", optional "access" ("read" default, or "write" to edit the change before review), "when", "blocking", "timeoutSeconds", "maxIterations"}. id: lowercase letters, digits and dashes. when: {"paths": globs} and/or {"minSize": "trivial"|"local"|"shared_contract"|"cross_cutting"}. blocking unset means the card cannot finish while the stage fails',
					),
				index: z
					.number()
					.int()
					.min(0)
					.max(7)
					.optional()
					.describe(
						"With set: the stage's position, 0 first (stages run in file order). Omit to keep an existing stage's place or add a new one last",
					),
				remove: z
					.string()
					.trim()
					.min(1)
					.max(100)
					.optional()
					.describe("The id of a stage to remove"),
			})
			.strict()
			.optional()
			.describe("For propose: set or remove, exactly one"),
		proposal_id: z
			.string()
			.trim()
			.min(1)
			.max(100)
			.optional()
			.describe("For apply: the proposal_id from propose"),
	})
	.strict();
export type FactoryStagesToolInput = z.input<
	typeof FactoryStagesToolInputSchema
>;

export interface FactoryStagesToolEntry {
	id: string;
	name: string;
	kind: FactoryRepositoryStage["kind"];
	status: string;
	stage: FactoryRepositoryStage;
}

export type FactoryStagesToolResult =
	| {
			ok: true;
			action: "show";
			project: string;
			workspaceRoot: string;
			path: string;
			file: "absent" | "present" | "invalid";
			problem?: string;
			stages: FactoryStagesToolEntry[];
	  }
	| {
			ok: true;
			action: "propose";
			project: string;
			workspaceRoot: string;
			path: string;
			summary: string;
			diff: string;
			warnings: string[];
			current_hash: string;
			proposal_id: string;
			expires_at: string;
			next: string;
	  }
	| {
			ok: true;
			action: "apply";
			project: string;
			workspaceRoot: string;
			path: string;
			summary: string;
			approved: string[];
			removed: string[];
			next: string;
	  }
	| { ok: false; error: { code: string; message: string } };

/** What the user is asked to confirm before the stages file is saved. */
export interface FactoryStagesConfirmationRequest {
	sessionId: string;
	agentId: string;
	conversationId?: string;
	iteration: number;
	toolCallId: string;
	/** The project's short name. */
	project: string;
	workspaceRoot: string;
	path: string;
	summary: string;
	diff: string;
	/** One line each: write access, a command that runs as the user. */
	warnings: string[];
	signal?: AbortSignal;
}

export interface CreateFactoryStagesToolOptions {
	manager: Pick<
		AgendaTaskManagerApi,
		"getFactoryStages" | "decideFactoryStage"
	>;
	/** Defined only for the user's Factory manager chat; the tool refuses every other session. */
	resolveManagerSession: (sessionId: string) => Promise<unknown | undefined>;
	/** Candidate projects; only those Factory knows can be named. */
	listProjects: () => Promise<readonly (string | undefined)[]>;
	/** Asks the user to confirm the diff in their app. Without it nothing is saved. */
	confirm?: (
		request: FactoryStagesConfirmationRequest,
	) => Promise<{ approved: boolean; reason?: string }>;
	now?: () => number;
	createProposalId?: () => string;
}

interface PendingStagesChange {
	sessionId: string;
	expiresAt: number;
	project: string;
	workspaceRoot: string;
	baseHash: string;
	content: string;
	summary: string;
	diff: string;
	warnings: string[];
	/** Stages added or changed: approved on confirmation, exactly these hashes. */
	changed: { id: string; name: string; hash: string }[];
	/** Stages removed: their trust entries are forgotten. */
	removed: { id: string; name: string; hash: string }[];
}

/** The stages file's text (empty when absent) and its 16-character hash. */
function readStagesSource(workspaceRoot: string): {
	read: FactoryStagesRead;
	text: string;
	hash: string;
} {
	const read = readFactoryStages(workspaceRoot);
	let text = "";
	if (read.status !== "absent") {
		try {
			// readFactoryStages checked it is a bounded regular file inside the project.
			text = readFileSync(
				join(realpathSync(workspaceRoot), FACTORY_STAGES_PATH),
				"utf8",
			);
		} catch {
			text = "";
		}
	}
	return {
		read,
		text,
		hash: createHash("sha256").update(text).digest("hex").slice(0, 16),
	};
}

/** Writes the file atomically; a symlinked or non-directory parent is refused. */
async function writeStagesFile(
	workspaceRoot: string,
	content: string,
): Promise<string> {
	const root = realpathSync(workspaceRoot);
	const file = join(root, FACTORY_STAGES_PATH);
	let cursor = root;
	for (const part of relative(root, dirname(file)).split(sep)) {
		cursor = join(cursor, part);
		const entry = lstatSync(cursor, { throwIfNoEntry: false });
		if (!entry) break;
		if (entry.isSymbolicLink() || !entry.isDirectory())
			throw new Error(
				"The project's .cline/factory directory is not a plain directory inside the project, so nothing was saved.",
			);
	}
	await mkdir(dirname(file), { recursive: true });
	const existing = lstatSync(file, { throwIfNoEntry: false });
	if (existing && !existing.isFile())
		throw new Error(
			`${FACTORY_STAGES_PATH} is not a plain file, so nothing was saved.`,
		);
	await writeFileAtomic(file, content);
	return file;
}

function failure(code: string, error: unknown) {
	return {
		ok: false as const,
		error: {
			code: error instanceof FactoryProjectError ? error.code : code,
			message: error instanceof Error ? error.message : String(error),
		},
	};
}

class FactoryStagesRefusal extends Error {}

function warningsFor(stages: readonly FactoryRepositoryStage[]): string[] {
	return [
		...(stages.some(
			(stage) => stage.kind === "agent" && stage.access === "write",
		)
			? [FACTORY_STAGE_WRITE_WARNING]
			: []),
		...(stages.some((stage) => stage.kind === "command")
			? [FACTORY_STAGE_COMMAND_WARNING]
			: []),
	];
}

/**
 * `factory_stages`: the Factory manager shows a project's repository stages
 * and proposes adding, changing or removing one. A proposal is the whole new
 * file, validated by the shared schema and the unsafe-command rules, and is
 * saved only after the user confirms its diff in the app; that confirmation
 * also approves exactly the stages it adds or changes. Nothing else writes
 * the file or approves a stage from the manager chat.
 */
export function createFactoryStagesTool(
	options: CreateFactoryStagesToolOptions,
): AgentTool<FactoryStagesToolInput, FactoryStagesToolResult> {
	const now = options.now ?? Date.now;
	const createProposalId =
		options.createProposalId ??
		(() => `fsp_${randomBytes(12).toString("base64url")}`);
	const pending = new Map<string, PendingStagesChange>();
	const prune = () => {
		for (const [id, entry] of pending)
			if (entry.expiresAt <= now()) pending.delete(id);
	};

	const propose = (
		change: NonNullable<z.infer<typeof FactoryStagesToolInputSchema>["change"]>,
		project: { workspaceRoot: string; name: string },
		sessionId: string,
	): FactoryStagesToolResult => {
		if ((change.set === undefined) === (change.remove === undefined))
			throw new FactoryStagesRefusal(
				"Give change.set (a full stage) or change.remove (a stage id), exactly one.",
			);
		if (change.index !== undefined && change.set === undefined)
			throw new FactoryStagesRefusal("index goes with change.set.");
		const source = readStagesSource(project.workspaceRoot);
		if (source.read.status === "invalid")
			throw new FactoryStagesRefusal(
				`${FACTORY_STAGES_PATH} in ${project.name} is invalid (${source.read.reason}). Factory changes it only when it is valid; the user can fix or delete it by hand.`,
			);
		const before =
			source.read.status === "present"
				? source.read.stages.map((entry) => entry.stage)
				: [];
		let stages = [...before];
		let summary: string;
		if (change.set !== undefined) {
			const parsed = factoryStageSchema.safeParse(change.set);
			if (!parsed.success)
				throw new FactoryStagesRefusal(
					`That stage is not valid: ${describeIssues(parsed.error)}.`,
				);
			const stage = parsed.data;
			const screened = screenFactoryStage(stage);
			if (screened)
				throw new FactoryStagesRefusal(
					`${FACTORY_STAGE_REFUSAL} (This stage would ${screened}.)`,
				);
			const existing = stages.findIndex((entry) => entry.id === stage.id);
			if (existing >= 0) stages.splice(existing, 1);
			const position =
				change.index ?? (existing >= 0 ? existing : stages.length);
			stages.splice(Math.min(position, stages.length), 0, stage);
			summary =
				existing >= 0
					? `Change repository stage "${stage.name}"`
					: `Add repository stage "${stage.name}"`;
		} else {
			const id = change.remove as string;
			const removed = stages.find((entry) => entry.id === id);
			if (!removed)
				throw new FactoryStagesRefusal(
					`${project.name} has no repository stage "${id}". Its stages: ${
						stages.map((entry) => entry.id).join(", ") || "none"
					}.`,
				);
			stages = stages.filter((entry) => entry.id !== id);
			summary = `Remove repository stage "${removed.name}"`;
		}
		const file = factoryStagesFileSchema.safeParse({
			schemaVersion: 1,
			stages,
		});
		if (!file.success)
			throw new FactoryStagesRefusal(
				`The stages file would not be valid: ${describeIssues(file.error)}.`,
			);
		for (const stage of file.data.stages) {
			if (stage.kind !== "command") continue;
			const problems = factoryUnsafeCommandProblems(stage.command);
			if (problems.length)
				throw new FactoryStagesRefusal(
					`Stage "${stage.id}" is refused: its command ${problems.join(" and ")}. Factory never runs commands like that.`,
				);
		}
		const content = `${JSON.stringify(file.data, null, 2)}\n`;
		const diff = unifiedFactoryGuidanceDiff(
			source.text,
			content,
			FACTORY_STAGES_PATH,
		);
		if (!diff)
			throw new FactoryStagesRefusal(
				"That changes nothing in the stages file.",
			);
		const previous = new Map(
			before.map((stage) => [stage.id, factoryStageHash(stage)]),
		);
		const changedStages = file.data.stages.filter(
			(stage) => previous.get(stage.id) !== factoryStageHash(stage),
		);
		const kept = new Set(file.data.stages.map((stage) => stage.id));
		const warnings = warningsFor(changedStages);
		prune();
		const id = createProposalId();
		const expiresAt = now() + FACTORY_GUIDANCE_CONFIRM_TTL_MS;
		pending.set(id, {
			sessionId,
			expiresAt,
			project: project.name,
			workspaceRoot: project.workspaceRoot,
			baseHash: source.hash,
			content,
			summary,
			diff,
			warnings,
			changed: changedStages.map((stage) => ({
				id: stage.id,
				name: stage.name,
				hash: factoryStageHash(stage),
			})),
			removed: before
				.filter((stage) => !kept.has(stage.id))
				.map((stage) => ({
					id: stage.id,
					name: stage.name,
					hash: factoryStageHash(stage),
				})),
		});
		return {
			ok: true,
			action: "propose",
			project: project.name,
			workspaceRoot: project.workspaceRoot,
			path: FACTORY_STAGES_PATH,
			summary,
			diff,
			warnings,
			current_hash: source.hash,
			proposal_id: id,
			expires_at: new Date(expiresAt).toISOString(),
			next: "Nothing is saved yet. Show the user this change and any warning. When they want it, call apply with proposal_id: Factory then asks them to confirm this exact diff in the app, and only then saves the file and approves the stages it adds or changes. The proposal works once, in this chat, for 10 minutes.",
		};
	};

	return createTool({
		name: FACTORY_STAGES_TOOL_NAME,
		description:
			"Repository stages: extra steps Factory runs after the build on every card in one project, defined in that project's .cline/factory/stages.json. A command stage runs a shell line (exit 0 passes) and must leave files unchanged; an agent stage runs an agent with a written instruction (read-only by default; access write may edit the change before review). Stages cannot skip or change approval, review, publishing or spending limits. " +
			"show lists the project's stages with their status (in use, needs approval, changed since approved, not used) or the file's problem. propose (change.set a full stage, with an optional index, or change.remove an id) checks the whole new file and returns its diff and a proposal_id without writing. apply with that proposal_id asks the user to confirm the diff in the app; only if they confirm is the file saved and are the added or changed stages approved. Always pass project.",
		inputSchema: zodToJsonSchema(FactoryStagesToolInputSchema),
		// apply waits for the user's answer.
		timeoutMs: FACTORY_GUIDANCE_CONFIRM_TTL_MS + 60_000,
		retryable: false,
		maxRetries: 0,
		execute: async (rawInput, context) => {
			const parsed = FactoryStagesToolInputSchema.safeParse(rawInput);
			if (!parsed.success) {
				const issue = parsed.error.issues[0];
				const field = issue?.path.join(".") || "input";
				return failure(
					"invalid_factory_stages_input",
					`Fix ${field}: ${issue?.message ?? "invalid value"}`,
				);
			}
			const input = parsed.data;
			const sessionId = context.sessionId;
			const session = sessionId
				? await options.resolveManagerSession(sessionId).catch(() => undefined)
				: undefined;
			if (!sessionId || !session)
				return failure(
					"factory_stages_unavailable",
					"Repository stages can only be changed from the Factory manager chat (Factory → Ask Factory).",
				);
			const { manager } = options;
			if (!manager.getFactoryStages || !manager.decideFactoryStage)
				return failure(
					"factory_stages_unavailable",
					"Repository stages are unavailable in this Hub.",
				);
			try {
				switch (input.action) {
					case "show": {
						const project = await requireFactoryManagerProject(
							options.listProjects,
							input.project,
						);
						const listing = await manager.getFactoryStages(
							project.workspaceRoot,
						);
						return {
							ok: true,
							action: "show",
							project: project.name,
							workspaceRoot: project.workspaceRoot,
							path: FACTORY_STAGES_PATH,
							file: listing.file,
							...(listing.file === "invalid"
								? { problem: listing.reason }
								: {}),
							stages:
								listing.file === "present"
									? listing.stages.map(({ stage, status }) => ({
											id: stage.id,
											name: stage.name,
											kind: stage.kind,
											status: STATUS_TEXT[status],
											stage,
										}))
									: [],
						};
					}
					case "propose": {
						if (!input.change)
							return failure(
								"factory_stages_refused",
								"Give change: set (a full stage) or remove (a stage id).",
							);
						const project = await requireFactoryManagerProject(
							options.listProjects,
							input.project,
						);
						return propose(input.change, project, sessionId);
					}
					case "apply": {
						if (!input.proposal_id)
							return failure(
								"factory_stages_proposal_required",
								"apply needs the proposal_id from propose.",
							);
						const entry = pending.get(input.proposal_id);
						// Single use: a proposal is spent by any apply attempt.
						pending.delete(input.proposal_id);
						if (!entry || entry.sessionId !== sessionId)
							throw new FactoryStagesRefusal(
								"That proposal is unknown or already used; propose the change again and show it to the user.",
							);
						if (entry.expiresAt <= now())
							throw new FactoryStagesRefusal(
								"That proposal expired; propose the change again and show it to the user.",
							);
						const stale = () =>
							readStagesSource(entry.workspaceRoot).hash !== entry.baseHash;
						const staleMessage =
							"The stages file changed since this was proposed, so nothing was saved; show it and propose again.";
						if (stale()) return failure("factory_stages_stale", staleMessage);
						if (!options.confirm)
							return failure(
								"factory_stages_confirmation_unavailable",
								"Factory cannot ask the user to confirm stage changes here, so nothing was saved.",
							);
						const answer = await awaitFactoryManagerConfirmation(
							options.confirm,
							{
								sessionId,
								agentId: context.agentId,
								conversationId: context.conversationId,
								iteration: context.iteration,
								toolCallId:
									context.toolCallId ?? `factory_stages_${createProposalId()}`,
								project: entry.project,
								workspaceRoot: entry.workspaceRoot,
								path: FACTORY_STAGES_PATH,
								summary: entry.summary,
								diff: entry.diff,
								warnings: entry.warnings,
								signal: context.signal,
							},
						);
						if (!answer.approved)
							return failure(
								"factory_stages_not_confirmed",
								`The user did not confirm this change, so nothing was saved.${answer.reason ? ` (${answer.reason})` : ""}`,
							);
						// The person may have taken minutes: check again before writing.
						if (stale()) return failure("factory_stages_stale", staleMessage);
						// Forgetting approval is always safe, so it happens first.
						for (const stage of entry.removed)
							await manager.decideFactoryStage(
								entry.workspaceRoot,
								stage.id,
								stage.hash,
								"undecided",
							);
						await writeStagesFile(entry.workspaceRoot, entry.content);
						for (const stage of entry.changed)
							await manager.decideFactoryStage(
								entry.workspaceRoot,
								stage.id,
								stage.hash,
								"approved",
							);
						return {
							ok: true,
							action: "apply",
							project: entry.project,
							workspaceRoot: entry.workspaceRoot,
							path: FACTORY_STAGES_PATH,
							summary: entry.summary,
							approved: entry.changed.map((stage) => stage.name),
							removed: entry.removed.map((stage) => stage.name),
							next: "Saved and approved after the user confirmed. Cards that start a run from now on use it. The file is in the user's checkout; they commit it when they want it to travel with the project.",
						};
					}
				}
			} catch (error) {
				return failure(
					error instanceof FactoryStagesRefusal
						? "factory_stages_refused"
						: "factory_stages_failed",
					error,
				);
			}
		},
	});
}
