import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import { readKanbanReason } from "../connectors/kanban-card-reply";
import type { IncomingImages } from "../connectors/message-images";

const execFileAsync = promisify(execFile);

/**
 * Turns a demand written in a chat conversation into a Kanban card.
 *
 * This is the other direction of the hub/Kanban pair: a card entering review announces itself
 * into the conversation, and a demand raised in the conversation becomes a card. It goes through
 * the `kanban` CLI rather than the board file because the board is owned by a running Kanban
 * server -- the CLI's own `task create` talks to it over tRPC and writing the file behind its
 * back would lose the write or corrupt the revision counter.
 */

const TITLE_MAX_LENGTH = 60;

export interface TaskCommandInput {
	/** Create the card and start its session right away. */
	start: boolean;
	/** Interview the person first, then file the card. */
	brainstorm: boolean;
	/** Comma-separated when typed; passed on to Kanban as written. */
	tags?: string;
	category?: string;
	priority?: string;
	/** Agent the card runs with, for a demand that needs one that can ask questions. */
	agentId?: string;
	description: string;
}

/**
 * Flags are read only from the front of the line, so a demand is free to contain "--" in its
 * own text: `/task --start fix the --dry-run flag` starts a card about `--dry-run`.
 */
const VALUE_FLAGS = new Map<
	string,
	"tags" | "category" | "priority" | "agentId"
>([
	["--tags", "tags"],
	["--tag", "tags"],
	["--category", "category"],
	["--priority", "priority"],
	// The agents differ in what they can do: only some can stop and ask the person a question.
	// Without this, a card filed from chat was stuck with the board's configured agent and
	// could never ask for anything -- the question simply never came.
	["--agent", "agentId"],
	["--agent-id", "agentId"],
]);

export function parseTaskCommand(args: string[]): TaskCommandInput {
	let start = false;
	let brainstorm = false;
	const values: {
		tags?: string;
		category?: string;
		priority?: string;
		agentId?: string;
	} = {};
	let index = 0;
	for (; index < args.length; index += 1) {
		const flag = args[index]?.toLowerCase() ?? "";
		if (flag === "--start" || flag === "--go") {
			start = true;
			continue;
		}
		if (flag === "--brainstorm" || flag === "--ask") {
			brainstorm = true;
			continue;
		}
		const field = VALUE_FLAGS.get(flag);
		if (field) {
			// A value flag with nothing after it is a typo, not a request to clear: the rest of
			// the line is the demand, and eating a word of it would be worse than ignoring the
			// flag. `--tags` at the very end simply carries no value.
			const value = args[index + 1];
			if (value !== undefined && !value.startsWith("--")) {
				values[field] = value;
				index += 1;
			}
			continue;
		}
		break;
	}
	return {
		start,
		brainstorm,
		...values,
		description: args.slice(index).join(" ").trim(),
	};
}

export interface KanbanTaskRequest {
	/** The demand as the person wrote it. Becomes the card's prompt verbatim. */
	description: string;
	/** Repository the card belongs to -- the conversation's workspace, not a worktree. */
	projectPath: string;
	/** Start the session as soon as the card exists. */
	start?: boolean;
	tags?: string;
	category?: string;
	priority?: string;
	/** Which surface filed the card, so the board can show where a demand came from. */
	source?: string;
	/** Agent the card runs with; left out, Kanban uses the board's configured agent. */
	agentId?: string;
	/** Pictures to attach, as files Kanban can read. */
	images?: string[];
}

export interface KanbanTaskResult {
	ok: boolean;
	taskId?: string;
	message: string;
}

export interface KanbanCommandOutput {
	stdout: string;
}

export interface CreateKanbanTaskDependencies {
	/** Overridable for tests; defaults to running the real `kanban` binary. */
	run?: (args: string[]) => Promise<KanbanCommandOutput>;
}

/**
 * A card needs a short label for the board and the full text for the agent. The first line is
 * the label when it is short enough, because that is how people write a demand: a headline and
 * then the detail.
 */
export function deriveTaskTitle(description: string): string {
	const firstLine = description.split("\n", 1)[0] ?? "";
	const collapsed = firstLine.replace(/\s+/g, " ").trim();
	if (collapsed.length <= TITLE_MAX_LENGTH) {
		return collapsed;
	}
	const clipped = collapsed.slice(0, TITLE_MAX_LENGTH);
	const lastSpace = clipped.lastIndexOf(" ");
	// Cutting mid-word reads like a defect, so prefer the last word boundary -- unless that
	// would throw away most of the line.
	const base =
		lastSpace > TITLE_MAX_LENGTH / 2 ? clipped.slice(0, lastSpace) : clipped;
	return `${base.trimEnd()}…`;
}

export function buildKanbanCreateArgs(request: KanbanTaskRequest): string[] {
	return [
		"task",
		"create",
		"--title",
		deriveTaskTitle(request.description),
		"--prompt",
		request.description,
		"--project-path",
		request.projectPath,
		// Passed through as written: Kanban owns what a valid tag or priority is, and
		// validating it twice is how the two drift apart.
		...(request.tags ? ["--tags", request.tags] : []),
		...(request.category ? ["--category", request.category] : []),
		...(request.priority ? ["--priority", request.priority] : []),
		...(request.source ? ["--source", request.source] : []),
		...(request.agentId ? ["--agent-id", request.agentId] : []),
		...(request.images ?? []).flatMap((path) => ["--image", path]),
	];
}

/**
 * The CLI prints JSON on stdout, but Node writes deprecation warnings there in some versions,
 * so the object is located rather than assumed to start at byte zero.
 */
export function readCreatedTaskId(stdout: string): string | undefined {
	const start = stdout.indexOf("{");
	if (start < 0) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(stdout.slice(start)) as {
			ok?: boolean;
			task?: { id?: unknown };
		};
		if (parsed.ok === false) {
			return undefined;
		}
		const id = parsed.task?.id;
		return typeof id === "string" && id.length > 0 ? id : undefined;
	} catch {
		return undefined;
	}
}

function describeFailure(error: unknown): string {
	const code =
		error && typeof error === "object" && "code" in error
			? String(error.code)
			: "";
	if (code === "ENOENT") {
		return "Kanban is not installed, so there is no board to add this to.";
	}
	const stderr =
		error && typeof error === "object" && "stderr" in error
			? String(error.stderr).trim()
			: "";
	// The CLI's reason comes first: it is on stdout, and Node's own message is only the command line.
	const detail =
		readKanbanReason(error) ||
		stderr ||
		(error instanceof Error ? error.message : String(error));
	const firstLine =
		detail
			.split("\n")
			.find((line) => line.trim().length > 0)
			?.trim() ?? "";
	// A Kanban that is not running is the common case and deserves to say so plainly.
	if (/ECONNREFUSED|fetch failed/i.test(detail)) {
		return "Could not reach Kanban. Is the board running?";
	}
	return firstLine
		? `Kanban refused the task: ${firstLine}`
		: "Kanban refused the task.";
}

export async function createKanbanTask(
	request: KanbanTaskRequest,
	deps: CreateKanbanTaskDependencies = {},
): Promise<KanbanTaskResult> {
	const description = request.description.trim();
	if (!description) {
		return { ok: false, message: "Usage: /task <what needs doing>" };
	}
	const run =
		deps.run ??
		(async (args: string[]) => {
			const { stdout } = await execFileAsync("kanban", args, {
				maxBuffer: 1024 * 1024,
			});
			return { stdout: String(stdout) };
		});

	let stdout: string;
	try {
		({ stdout } = await run(
			buildKanbanCreateArgs({ ...request, description }),
		));
	} catch (error) {
		return { ok: false, message: describeFailure(error) };
	}

	const taskId = readCreatedTaskId(stdout);
	if (!taskId) {
		return { ok: false, message: "Kanban did not report a task id." };
	}
	const workspace = basename(request.projectPath) || request.projectPath;
	if (!request.start) {
		return {
			ok: true,
			taskId,
			message: `Added to the ${workspace} backlog: ${deriveTaskTitle(description)} (card ${taskId})`,
		};
	}

	try {
		await run([
			"task",
			"start",
			"--task-id",
			taskId,
			"--project-path",
			request.projectPath,
		]);
	} catch (error) {
		// The card exists, so say so: "could not start" without "but it is filed" would read as
		// if the demand had been lost.
		return {
			ok: false,
			taskId,
			message: `Filed in ${workspace} as card ${taskId}, but could not start it: ${describeFailure(error)}`,
		};
	}
	return {
		ok: true,
		taskId,
		message: `Started in ${workspace}: ${deriveTaskTitle(description)} (card ${taskId})`,
	};
}

/**
 * The brainstorm is the agent's job, not the connector's: the conversation already has a model
 * in it, and interviewing someone about a half-formed demand is exactly what it is good at.
 * The connector only hands it the assignment and gets out of the way.
 *
 * The instruction is blunt about asking first and exploring later, because the first version was
 * not: it said to ask only what could not be answered by reading the repository, and the agent
 * dutifully went off to read the repository -- dispatching a sub-agent and falling silent while
 * the person sat in a chat window waiting for a question that never came.
 */
export function buildBrainstormPrompt(input: {
	description: string;
	projectPath: string;
	start: boolean;
	tags?: string;
	category?: string;
	priority?: string;
	agentId?: string;
	/** Pictures sent with the demand, saved for this agent to attach to the card it files. */
	images?: string[];
}): string {
	return [
		`A demand came in for the Kanban board of ${input.projectPath}, written as:`,
		"",
		input.description,
		"",
		"Interview the person about it, right here in this conversation, until the demand is clear",
		"enough for another agent to pick it up cold: what outcome it must produce, how anyone",
		"would know it worked, and what is deliberately out of scope.",
		"",
		"Rules for the interview, because this is a chat and someone is waiting in it:",
		"- Ask your first question in this very reply. Do not explore the repository first.",
		"- One question at a time, and keep each message short enough to read on a phone.",
		"- Do not dispatch sub-agents and do not go quiet. If you need to check something in the",
		"  code, say what you are checking, check it, and come back with the answer and the next",
		"  question in the same reply.",
		"",
		"Do not file the card until the person confirms the demand is right. Then file it with:",
		"",
		`  kanban task create --project-path ${input.projectPath} --title <short line> --prompt <the agreed demand>` +
			(input.tags ? ` --tags ${input.tags}` : "") +
			(input.category ? ` --category ${input.category}` : "") +
			(input.priority ? ` --priority ${input.priority}` : "") +
			(input.agentId ? ` --agent-id ${input.agentId}` : "") +
			(input.images ?? []).map((path) => ` --image ${path}`).join(""),
		...(input.start
			? [
					"",
					"Then start it with `kanban task start --task-id <id from the create output> " +
						`--project-path ${input.projectPath}\`.`,
				]
			: []),
		"",
		"Finally, tell the person the card id. If they decide against it, say so and file nothing.",
	].join("\n");
}

function countImages(count: number): string {
	return count === 1 ? "1 imagem" : `${count} imagens`;
}

/** The reply's note on the pictures, so the person can tell whether the card saw them. */
export function describeAttachedImages(
	saved: IncomingImages | undefined,
): string {
	if (!saved) {
		return "";
	}
	const attached =
		saved.paths.length > 0 ? `, ${countImages(saved.paths.length)}` : "";
	const lost =
		saved.failed === 0
			? ""
			: saved.failed === 1
				? " — a imagem não pôde ser baixada"
				: ` — ${saved.failed} imagens não puderam ser baixadas`;
	const refused =
		saved.refused === 0
			? ""
			: ` — ${countImages(saved.refused)} ${saved.refused === 1 ? "recusada" : "recusadas"} (aceito png, jpg, gif ou webp até 5 MB)`;
	return `${attached}${lost}${refused}`;
}
