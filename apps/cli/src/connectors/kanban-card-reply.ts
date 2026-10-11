import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Carrying an answer from the conversation back into the Kanban card that asked.
 *
 * Until now the notification was one-way: a card entering review could say that it needed
 * someone, and that someone had to go to the board to answer -- the board being exactly the
 * place the notification existed to spare them. This closes the loop.
 *
 * The signal is Telegram's own: replying *to* the card's message. Nothing is inferred from
 * timing or from "the last card that asked", because a wrong guess types an answer into the
 * wrong agent's session, which is unrecoverable and silent. No reply, no routing.
 */

export interface TrackedCardMessage {
	taskId: string;
	/** Repository the card belongs to; the Kanban CLI needs it to find the board. */
	projectPath: string;
	/**
	 * The choices this notification offered, as it displayed them. Kept so a reply naming one
	 * can be turned into the number the card's prompt actually accepts.
	 */
	options?: string[];
}

export interface RememberedCardMessage extends TrackedCardMessage {
	/** Id of the message the connector posted about this card. */
	messageId: string;
}

const DEFAULT_MEMORY = 20;

/**
 * Remembers one more card message per conversation, newest first and bounded.
 *
 * It has to be remembered on disk rather than in a map: the first version kept it in memory and
 * a connector restart between the question and the answer made the reply unrecognizable --
 * which is the same mistake the chat library's in-memory subscriptions make, found twice in one
 * afternoon. The bound exists because a conversation accumulates these forever otherwise, and
 * nobody replies to a question from last week.
 */
export function rememberCardMessage(
	existing: readonly RememberedCardMessage[] | undefined,
	entry: RememberedCardMessage,
	max = DEFAULT_MEMORY,
): RememberedCardMessage[] {
	const others = (existing ?? []).filter(
		(item) => item.messageId !== entry.messageId,
	);
	return [entry, ...others].slice(0, max);
}

export function findRememberedCard(
	existing: readonly RememberedCardMessage[] | undefined,
	messageId: string | undefined,
): TrackedCardMessage | undefined {
	if (!messageId) {
		return undefined;
	}
	return (existing ?? []).find((item) => item.messageId === messageId);
}

export interface CardReplyResult {
	ok: boolean;
	message: string;
}

export interface AnswerKanbanCardDependencies {
	/** Overridable for tests; defaults to running the real `kanban` binary. */
	run?: (args: string[]) => Promise<{ stdout: string }>;
}

/**
 * The card a reply belongs to, or nothing. `undefined` in, `undefined` out: a message that
 * replies to nothing is an ordinary message and must go through the ordinary path.
 */
export function resolveCardForReply(
	replyToMessageId: string | undefined,
	tracked: ReadonlyMap<string, TrackedCardMessage>,
): TrackedCardMessage | undefined {
	if (!replyToMessageId) {
		return undefined;
	}
	return tracked.get(replyToMessageId);
}

export function buildKanbanInputArgs(
	card: TrackedCardMessage,
	text: string,
): string[] {
	return [
		"task",
		"input",
		"--task-id",
		card.taskId,
		"--text",
		text,
		"--project-path",
		card.projectPath,
	];
}

function describeFailure(error: unknown): string {
	const code =
		error && typeof error === "object" && "code" in error
			? String(error.code)
			: "";
	if (code === "ENOENT") {
		return "Kanban is not installed here, so I cannot pass this to the card.";
	}
	const stderr =
		error && typeof error === "object" && "stderr" in error
			? String(error.stderr).trim()
			: "";
	const detail =
		stderr || (error instanceof Error ? error.message : String(error));
	if (/no running session/i.test(detail)) {
		// The common case by far: the card finished, or was stopped, between asking and being
		// answered. Saying so beats a stack trace.
		return "That card is no longer running, so there is nobody to answer.";
	}
	if (/ECONNREFUSED|fetch failed/i.test(detail)) {
		return "Could not reach Kanban. Is the board running?";
	}
	const firstLine =
		detail
			.split("\n")
			.find((line) => line.trim().length > 0)
			?.trim() ?? "";
	return firstLine
		? `Kanban refused the answer: ${firstLine}`
		: "Kanban refused the answer.";
}

export async function answerKanbanCard(
	card: TrackedCardMessage,
	text: string,
	deps: AnswerKanbanCardDependencies = {},
): Promise<CardReplyResult> {
	const trimmed = text.trim();
	if (!trimmed) {
		return { ok: false, message: "Nothing to pass on: the reply was empty." };
	}
	const run =
		deps.run ??
		(async (args: string[]) => {
			const { stdout } = await execFileAsync("kanban", args, {
				maxBuffer: 1024 * 1024,
			});
			return { stdout: String(stdout) };
		});
	try {
		await run(buildKanbanInputArgs(card, trimmed));
	} catch (error) {
		return { ok: false, message: describeFailure(error) };
	}
	return { ok: true, message: `Passed to card ${card.taskId}.` };
}
