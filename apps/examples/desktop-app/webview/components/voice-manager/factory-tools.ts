import type { AgendaTaskRecord } from "@cline/shared";
import { parseFactoryId } from "@cline/shared/browser";
import type { Experimental_RealtimeSessionConfig } from "ai";
import {
	factoryActivity,
	factoryShortId,
} from "@/components/views/factory/factory-ui";
import type { FactoryAttention } from "@/hooks/use-factory-attention";
import {
	type FactoryAttentionEpisode,
	readFactoryTaskEvent,
} from "@/lib/desktop-notifications";

/**
 * How the Cline robot works the Factory.
 *
 * - It reads the board the app already holds, so "what's in flight" answers
 *   at once.
 * - It hands requests (new work, hold, start, retry, priority) to the Factory
 *   manager conversation, which stays the one way to add work.
 * - It carries the person's own decisions (an answer, a plan approval), which
 *   the manager agent is not allowed to make for them.
 */

/** The Factory board as the app holds it. */
export type VoiceFactoryBoard = {
	tasks: AgendaTaskRecord[];
	attention: FactoryAttention[];
	answer: (requestId: string, value: string) => Promise<unknown>;
	approvePlan: (task: AgendaTaskRecord) => Promise<unknown>;
};

export type VoiceFactoryContext = {
	board: () => VoiceFactoryBoard;
	/** Shows a card in the Factory view. */
	openCard: (taskId: string) => void;
	/** Shows the Factory board, with every card in its column. */
	openBoard: () => void;
	openExternalUrl: (url: string) => Promise<unknown> | undefined;
	/** Sends a request to the Factory manager conversation. */
	askManager: (request: string) => Promise<boolean>;
	setActivity: (activity: string) => void;
};

export const FACTORY_INSTRUCTIONS = `The Factory is the app's production line. The user hands it work as cards, and it scopes, builds, tests, reviews and opens a draft pull request for each card by itself. It never merges.
Send work to the Factory when the user wants something built and delivered without watching it. Use a plain session instead when they want to work alongside an agent or look at a live preview.
To add work, or to hold, start, retry or reprioritize a card, call ask_factory with the request in the user's own words. The Factory answers a little later as an app update; say you passed it on, then tell them the answer when it comes.
Call factory_board before saying what the Factory is doing. Refer to cards by their titles, adding the short ID such as F12 only when titles are alike.
When a card has a question, read the question and its options aloud, then pass the user's answer on with answer_factory_question. Approve a plan with approve_factory_plan only after the user has clearly said to.
When the user wants to see a card, its proof or its pull request, call show_factory_card. When they want the whole board again, or to go back from a card, call show_factory_board.`;

const CARD_PARAM = {
	card: {
		type: "string",
		description:
			"The card's short ID from factory_board, such as F12, or words from its title.",
	},
} as const;

export const FACTORY_TOOLS: NonNullable<
	Experimental_RealtimeSessionConfig["tools"]
> = [
	{
		type: "function",
		name: "factory_board",
		description:
			"What the Factory is doing: the cards that need the user, the ones being worked on, the ones waiting, and recent deliveries.",
		parameters: { type: "object", properties: {} },
	},
	{
		type: "function",
		name: "factory_card",
		description:
			"One Factory card in detail: what was asked, where it stands, any question it is asking, and its pull request.",
		parameters: {
			type: "object",
			properties: CARD_PARAM,
			required: ["card"],
		},
	},
	{
		type: "function",
		name: "ask_factory",
		description:
			"Pass a request to the Factory: add new work, or hold, start, retry or reprioritize a card. The Factory replies later as an app update.",
		parameters: {
			type: "object",
			properties: {
				request: {
					type: "string",
					description:
						"The request as the user would type it, with the project named if they named one.",
				},
			},
			required: ["request"],
		},
	},
	{
		type: "function",
		name: "answer_factory_question",
		description: "Give the user's answer to the question a card is asking.",
		parameters: {
			type: "object",
			properties: {
				...CARD_PARAM,
				answer: {
					type: "string",
					description:
						"The answer. When the question has options, the chosen option's exact text.",
				},
			},
			required: ["card", "answer"],
		},
	},
	{
		type: "function",
		name: "approve_factory_plan",
		description:
			"Approve a card's plan so the Factory builds it. Only after the user has said to.",
		parameters: {
			type: "object",
			properties: CARD_PARAM,
			required: ["card"],
		},
	},
	{
		type: "function",
		name: "show_factory_card",
		description:
			"Show a card on screen in the Factory, with its progress and proof, or open its pull request in the browser.",
		parameters: {
			type: "object",
			properties: {
				...CARD_PARAM,
				show: { type: "string", enum: ["card", "pull_request"] },
			},
			required: ["card"],
		},
	},
	{
		type: "function",
		name: "show_factory_board",
		description:
			"Show the Factory board on screen: every card in its column. Also the way back from a card to the overview.",
		parameters: { type: "object", properties: {} },
	},
];

export type VoiceFactoryCard = {
	card: string;
	title: string;
	project: string;
	/** The board column: Needs you, Working, Queued, Ready for you, Done. */
	column: string;
	state: string;
	question?: { question: string; options?: string[] };
	pullRequest?: string;
};

function projectName(workspaceRoot: string | undefined): string {
	return workspaceRoot?.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function flat(text: string, max: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max)}…` : line;
}

function describeCard(
	task: AgendaTaskRecord,
	attention: FactoryAttention | undefined,
): VoiceFactoryCard {
	const activity = factoryActivity(task, attention);
	const question = attention?.questions[0];
	const pullRequest = attention?.outcome?.pullRequestUrl;
	return {
		card: factoryShortId(task) ?? task.taskId,
		title: task.title,
		project: projectName(task.workspaceRoot),
		column: activity.column,
		state: activity.label,
		...(question
			? {
					question: {
						question: flat(question.question, 400),
						...(question.options.length ? { options: question.options } : {}),
					},
				}
			: {}),
		...(pullRequest ? { pullRequest } : {}),
	};
}

function openTasks(board: VoiceFactoryBoard): AgendaTaskRecord[] {
	return board.tasks.filter((task) => task.factory && !task.archivedAt);
}

/** The board in the shape the robot speaks from, most pressing first. */
export function factoryBoardSummary(board: VoiceFactoryBoard): {
	needsYou: VoiceFactoryCard[];
	working: VoiceFactoryCard[];
	waiting: VoiceFactoryCard[];
	delivered: VoiceFactoryCard[];
} {
	const attention = new Map(board.attention.map((item) => [item.taskId, item]));
	const cards = openTasks(board).map((task) =>
		describeCard(task, attention.get(task.taskId)),
	);
	const inColumn = (...columns: string[]) =>
		cards.filter((card) => columns.includes(card.column));
	return {
		needsYou: inColumn("Needs you", "Status unavailable"),
		working: inColumn("Working"),
		waiting: inColumn("Queued"),
		// The board lists newest first; a handful is plenty to say aloud.
		delivered: inColumn("Ready for you", "Done").slice(0, 6),
	};
}

/**
 * The card a spoken reference means: a short ID ("F12", "f 12", "#12") or
 * words from a title. Title matches must be unambiguous.
 */
export function findFactoryCard(
	board: VoiceFactoryBoard,
	reference: string,
): { task: AgendaTaskRecord } | { error: string } {
	const tasks = openTasks(board);
	const text = reference.trim();
	const number = parseFactoryId(text.replace(/\s+/g, ""));
	if (number !== undefined) {
		const task = tasks.find((item) => item.factoryNumber === number);
		if (task) return { task };
	}
	const exact = tasks.find((item) => item.taskId === text);
	if (exact) return { task: exact };
	const words = text.toLowerCase().split(/\s+/).filter(Boolean);
	const matches = words.length
		? tasks.filter((item) => {
				const title = item.title.toLowerCase();
				return words.every((word) => title.includes(word));
			})
		: [];
	if (matches.length === 1) return { task: matches[0] };
	return {
		error: matches.length
			? `Several cards match: ${matches
					.slice(0, 5)
					.map((item) => `${factoryShortId(item) ?? ""} ${item.title}`.trim())
					.join("; ")}. Ask which one.`
			: "No open card matches that. Call factory_board to see the cards.",
	};
}

/** Runs a Factory tool. Undefined when `name` is not one. */
export async function runFactoryTool(
	name: string,
	args: Record<string, unknown>,
	context: VoiceFactoryContext,
): Promise<unknown> {
	const board = context.board();
	const attentionFor = (taskId: string) =>
		board.attention.find((item) => item.taskId === taskId);
	const resolve = () => findFactoryCard(board, String(args.card ?? ""));
	switch (name) {
		case "factory_board": {
			context.setActivity("Checking the Factory");
			return factoryBoardSummary(board);
		}
		case "factory_card": {
			const found = resolve();
			if ("error" in found) return { ok: false, error: found.error };
			const { task } = found;
			context.setActivity(`Reading “${task.title}”`);
			const attention = attentionFor(task.taskId);
			const outcome = attention?.outcome;
			return {
				...describeCard(task, attention),
				asked: flat(task.instructions, 600),
				...(outcome?.visualProof
					? {
							proof:
								outcome.visualProof === "shown"
									? outcome.recording
										? "screenshots and a recording"
										: "screenshots"
									: "missing",
						}
					: {}),
				...(outcome?.error ? { problem: flat(outcome.error, 300) } : {}),
			};
		}
		case "ask_factory": {
			const request = String(args.request ?? "").trim();
			if (!request) return { ok: false, error: "There was no request." };
			context.setActivity("Asking the Factory");
			return (await context.askManager(request))
				? {
						ok: true,
						note: "Passed on. The Factory's answer arrives as an app update.",
					}
				: { ok: false, error: "The Factory did not accept the request." };
		}
		case "answer_factory_question": {
			const found = resolve();
			if ("error" in found) return { ok: false, error: found.error };
			const question = attentionFor(found.task.taskId)?.questions[0];
			if (!question)
				return { ok: false, error: "That card is not asking anything." };
			const answer = String(args.answer ?? "").trim();
			if (!answer) return { ok: false, error: "There was no answer." };
			context.setActivity(`Answering “${found.task.title}”`);
			await board.answer(question.requestId, answer);
			return { ok: true };
		}
		case "approve_factory_plan": {
			const found = resolve();
			if ("error" in found) return { ok: false, error: found.error };
			context.setActivity(`Approving the plan for “${found.task.title}”`);
			await board.approvePlan(found.task);
			return { ok: true };
		}
		case "show_factory_board": {
			context.setActivity("Showing the Factory board");
			context.openBoard();
			return { ok: true };
		}
		case "show_factory_card": {
			const found = resolve();
			if ("error" in found) return { ok: false, error: found.error };
			const { task } = found;
			if (args.show === "pull_request") {
				const url = attentionFor(task.taskId)?.outcome?.pullRequestUrl;
				if (!url)
					return { ok: false, error: "That card has no pull request yet." };
				context.setActivity("Opening the pull request");
				await context.openExternalUrl(url);
				return { ok: true };
			}
			context.setActivity(`Showing “${task.title}”`);
			context.openCard(task.taskId);
			return { ok: true };
		}
		default:
			return undefined;
	}
}

/**
 * Turns Factory task events into the updates the robot speaks: each thing
 * that needs the person, or each result, is announced once while it stays
 * true (the rule native notifications follow).
 */
export function createFactoryAnnouncer(): {
	/** The update to speak for this event, if it brings a new one. */
	read: (payload: unknown) => string | null;
	/** Whether Factory runs this session for one of its cards. */
	isFactorySession: (sessionId: string) => boolean;
} {
	const active = new Map<string, Set<string>>();
	const sessions = new Set<string>();
	return {
		read(payload) {
			const event = readFactoryTaskEvent(payload);
			if (!event) return null;
			for (const sessionId of event.sessionIds) sessions.add(sessionId);
			const previous = active.get(event.taskId) ?? new Set<string>();
			const fresh: FactoryAttentionEpisode | undefined = event.episodes.find(
				(episode) => !previous.has(episode.key),
			);
			const next = new Set([
				...event.episodes
					.map((episode) => episode.key)
					.filter((key) => previous.has(key)),
				...[...previous].filter(event.unknown),
				...(fresh ? [fresh.key] : []),
			]);
			if (next.size) active.set(event.taskId, next);
			else active.delete(event.taskId);
			return fresh ? `Factory: ${fresh.title}. ${fresh.body}` : null;
		},
		isFactorySession: (sessionId) => sessions.has(sessionId),
	};
}
