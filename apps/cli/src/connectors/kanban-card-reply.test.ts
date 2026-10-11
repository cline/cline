import { describe, expect, it, vi } from "vitest";

import {
	answerKanbanCard,
	buildKanbanInputArgs,
	findRememberedCard,
	rememberCardMessage,
	resolveCardForReply,
	type TrackedCardMessage,
} from "./kanban-card-reply";

const card: TrackedCardMessage = {
	taskId: "49084",
	projectPath: "/code/kanban",
};

describe("resolveCardForReply", () => {
	it("finds the card whose message was replied to", () => {
		const tracked = new Map([["m1", card]]);
		expect(resolveCardForReply("m1", tracked)).toEqual(card);
	});

	it("routes nothing when the message replies to nothing", () => {
		// An ordinary message must take the ordinary path. Inferring a card from timing, or from
		// "the last one that asked", would type an answer into the wrong agent's session --
		// silently, and with no way back.
		expect(
			resolveCardForReply(undefined, new Map([["m1", card]])),
		).toBeUndefined();
	});

	it("routes nothing when the reply is to some other message", () => {
		expect(resolveCardForReply("m2", new Map([["m1", card]]))).toBeUndefined();
	});
});

describe("buildKanbanInputArgs", () => {
	it("names the card and its repository", () => {
		expect(buildKanbanInputArgs(card, "sim, pode seguir")).toEqual([
			"task",
			"input",
			"--task-id",
			"49084",
			"--text",
			"sim, pode seguir",
			"--project-path",
			"/code/kanban",
		]);
	});
});

describe("answerKanbanCard", () => {
	it("passes the answer on and says which card got it", async () => {
		const run = vi.fn<(args: string[]) => Promise<{ stdout: string }>>(
			async () => ({
				stdout: '{"ok":true}',
			}),
		);
		const result = await answerKanbanCard(card, "  sim  ", { run });
		expect(result).toEqual({ ok: true, message: "Passed to card 49084." });
		expect(run.mock.calls[0]?.[0]).toContain("sim");
	});

	it("refuses an empty reply instead of typing nothing into a session", async () => {
		const run = vi.fn<(args: string[]) => Promise<{ stdout: string }>>(
			async () => ({
				stdout: "",
			}),
		);
		const result = await answerKanbanCard(card, "   ", { run });
		expect(result.ok).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});

	it("explains a card that stopped running between asking and being answered", async () => {
		// The common case by far, and the one a stack trace would explain worst.
		const result = await answerKanbanCard(card, "sim", {
			run: async () => {
				throw Object.assign(new Error("x"), {
					stderr:
						'Task "49084" has no running session in workspace /code/kanban.',
				});
			},
		});
		expect(result.ok).toBe(false);
		expect(result.message).toBe(
			"That card is no longer running, so there is nobody to answer.",
		);
	});

	it("explains a board that is not running", async () => {
		const result = await answerKanbanCard(card, "sim", {
			run: async () => {
				throw Object.assign(new Error("fetch failed"), {
					stderr: "fetch failed",
				});
			},
		});
		expect(result.message).toBe(
			"Could not reach Kanban. Is the board running?",
		);
	});

	it("explains a missing Kanban", async () => {
		const result = await answerKanbanCard(card, "sim", {
			run: async () => {
				throw Object.assign(new Error("spawn kanban ENOENT"), {
					code: "ENOENT",
				});
			},
		});
		expect(result.message).toContain("not installed");
	});
});

describe("remembering which message belongs to which card", () => {
	const a = { messageId: "m1", taskId: "49084", projectPath: "/code/kanban" };
	const b = { messageId: "m2", taskId: "05baa", projectPath: "/code/kanban" };

	it("keeps the newest first", () => {
		expect(rememberCardMessage(rememberCardMessage([], a), b)).toEqual([b, a]);
	});

	it("replaces an entry for the same message instead of duplicating it", () => {
		// An edited notification keeps its message id, and the options may have changed.
		const updated = { ...a, options: ["Sim", "Não"] };
		expect(rememberCardMessage([a], updated)).toEqual([updated]);
	});

	it("forgets the oldest once the bound is reached", () => {
		// A conversation accumulates these forever otherwise, and nobody replies to a question
		// from last week.
		let list = rememberCardMessage(undefined, a, 2);
		list = rememberCardMessage(list, b, 2);
		list = rememberCardMessage(list, { ...a, messageId: "m3" }, 2);
		expect(list.map((item) => item.messageId)).toEqual(["m3", "m2"]);
	});

	it("finds the card a reply belongs to", () => {
		expect(findRememberedCard([b, a], "m1")?.taskId).toBe("49084");
	});

	it("finds nothing for a message it never posted about", () => {
		// This is what a restart used to cause: the memory was empty, so a reply fell through
		// to an ordinary chat turn, silently.
		expect(findRememberedCard([b, a], "m9")).toBeUndefined();
		expect(findRememberedCard([b, a], undefined)).toBeUndefined();
		expect(findRememberedCard(undefined, "m1")).toBeUndefined();
	});
});
