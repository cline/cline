import type { AgendaTaskRecord } from "@cline/shared";
import { factoryTaskConfigSchema } from "@cline/shared/browser";
import { describe, expect, it, vi } from "vitest";
import type { FactoryAttention } from "@/hooks/use-factory-attention";
import {
	createFactoryAnnouncer,
	factoryBoardSummary,
	findFactoryCard,
	runFactoryTool,
	type VoiceFactoryBoard,
	type VoiceFactoryContext,
} from "./factory-tools";

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: vi.fn(), subscribe: vi.fn() },
	isTauriAvailable: () => false,
}));

const task = (overrides: Partial<AgendaTaskRecord>): AgendaTaskRecord =>
	({
		taskId: "card",
		title: "Card",
		instructions: "Build it.",
		type: "todo",
		scope: "workspace",
		workspaceRoot: "/code/notes-app",
		status: "in_progress",
		resourcePaths: [],
		priority: 2,
		availableAt: "2026-01-01T00:00:00Z",
		expiresAt: "2027-01-01T00:00:00Z",
		automationEligible: false,
		revision: 3,
		approvedRevision: 3,
		createdBy: { kind: "user" },
		updatedBy: { kind: "user" },
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		factory: {
			execution: "local",
			approval: "required",
			maxRepairRounds: 2,
			checks: [],
			publishPullRequest: true,
		},
		...overrides,
	}) as AgendaTaskRecord;

const attention = (
	taskId: string,
	overrides: Partial<FactoryAttention> = {},
	outcome?: Partial<NonNullable<FactoryAttention["outcome"]>>,
): FactoryAttention => ({
	taskId,
	revision: 3,
	questions: [],
	needsAttention: false,
	...(outcome
		? {
				outcome: {
					phase: "implementing",
					repairRound: 0,
					activeRoles: [],
					activeSessions: [],
					followupPaused: false,
					...outcome,
				} as FactoryAttention["outcome"],
			}
		: {}),
	...overrides,
});

const question = {
	requestId: "factory_question_1",
	sessionId: "designer",
	createdAt: "2026-01-01T00:00:00Z",
	question: "Which list should search cover?",
	options: ["Titles only", "Titles and bodies"],
};

function board(overrides: Partial<VoiceFactoryBoard> = {}): VoiceFactoryBoard {
	return {
		tasks: [
			task({ taskId: "t12", factoryNumber: 12, title: "Search notes" }),
			task({ taskId: "t13", factoryNumber: 13, title: "Dark mode toggle" }),
			task({ taskId: "t14", factoryNumber: 14, title: "Dark mode for email" }),
			task({
				taskId: "t9",
				factoryNumber: 9,
				title: "Old card",
				archivedAt: "2026-01-02T00:00:00Z",
			}),
		],
		attention: [
			attention("t12", { needsAttention: true, questions: [question] }),
			attention(
				"t13",
				{},
				{ pullRequestUrl: "https://github.com/acme/notes/pull/7" },
			),
		],
		answer: vi.fn(async () => undefined),
		approvePlan: vi.fn(async () => undefined),
		...overrides,
	};
}

function context(
	current: VoiceFactoryBoard,
	overrides: Partial<VoiceFactoryContext> = {},
): VoiceFactoryContext {
	return {
		board: () => current,
		openCard: vi.fn(),
		openExternalUrl: vi.fn(async () => undefined),
		askManager: vi.fn(async () => true),
		setActivity: vi.fn(),
		...overrides,
	};
}

describe("findFactoryCard", () => {
	it.each(["F12", "f 12", "#12", "F-12"])("reads %s as a short ID", (ref) => {
		expect(findFactoryCard(board(), ref)).toMatchObject({
			task: { taskId: "t12" },
		});
	});

	it("finds a card by words from its title", () => {
		expect(findFactoryCard(board(), "search")).toMatchObject({
			task: { taskId: "t12" },
		});
		expect(findFactoryCard(board(), "dark toggle")).toMatchObject({
			task: { taskId: "t13" },
		});
	});

	it("asks which one when a title is ambiguous, naming the candidates", () => {
		const found = findFactoryCard(board(), "dark mode");
		expect(found).toMatchObject({
			error: expect.stringContaining("F13 Dark mode toggle"),
		});
	});

	it("never resolves to an archived card", () => {
		expect(findFactoryCard(board(), "F9")).toHaveProperty("error");
		expect(findFactoryCard(board(), "old card")).toHaveProperty("error");
	});
});

describe("factoryBoardSummary", () => {
	it("describes each open card once, with its question and pull request", () => {
		const summary = factoryBoardSummary(board());
		const cards = Object.values(summary).flat();
		expect(cards.map((card) => card.card).sort()).toEqual([
			"F12",
			"F13",
			"F14",
		]);
		const asking = cards.find((card) => card.card === "F12");
		expect(asking).toMatchObject({
			title: "Search notes",
			project: "notes-app",
			question: {
				question: "Which list should search cover?",
				options: ["Titles only", "Titles and bodies"],
			},
		});
		expect(cards.find((card) => card.card === "F13")?.pullRequest).toBe(
			"https://github.com/acme/notes/pull/7",
		);
	});
});

describe("runFactoryTool", () => {
	it("leaves tools that are not the Factory's to the caller", async () => {
		expect(
			await runFactoryTool("list_sessions", {}, context(board())),
		).toBeUndefined();
	});

	it("answers the question a card is asking", async () => {
		const current = board();
		expect(
			await runFactoryTool(
				"answer_factory_question",
				{ card: "search", answer: "Titles only" },
				context(current),
			),
		).toEqual({ ok: true });
		expect(current.answer).toHaveBeenCalledWith(
			"factory_question_1",
			"Titles only",
		);
	});

	it("refuses to answer a card that is not asking", async () => {
		const current = board();
		expect(
			await runFactoryTool(
				"answer_factory_question",
				{ card: "F13", answer: "yes" },
				context(current),
			),
		).toMatchObject({ ok: false });
		expect(current.answer).not.toHaveBeenCalled();
	});

	it("approves the plan of the card that was named", async () => {
		const current = board();
		await runFactoryTool(
			"approve_factory_plan",
			{ card: "F13" },
			context(current),
		);
		expect(current.approvePlan).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "t13" }),
		);
	});

	it("approves nothing when the reference is ambiguous", async () => {
		const current = board();
		expect(
			await runFactoryTool(
				"approve_factory_plan",
				{ card: "dark mode" },
				context(current),
			),
		).toMatchObject({ ok: false });
		expect(current.approvePlan).not.toHaveBeenCalled();
	});

	it("passes a request to the manager and says the answer comes later", async () => {
		const ctx = context(board());
		expect(
			await runFactoryTool(
				"ask_factory",
				{ request: "Add a CSV export to notes-app" },
				ctx,
			),
		).toMatchObject({ ok: true });
		expect(ctx.askManager).toHaveBeenCalledWith(
			"Add a CSV export to notes-app",
		);
	});

	it("reports a request the manager did not take", async () => {
		const ctx = context(board(), { askManager: vi.fn(async () => false) });
		expect(
			await runFactoryTool("ask_factory", { request: "Add export" }, ctx),
		).toMatchObject({ ok: false });
	});

	it("shows a card, or opens its pull request", async () => {
		const ctx = context(board());
		await runFactoryTool("show_factory_card", { card: "F12" }, ctx);
		expect(ctx.openCard).toHaveBeenCalledWith("t12");
		await runFactoryTool(
			"show_factory_card",
			{ card: "F13", show: "pull_request" },
			ctx,
		);
		expect(ctx.openExternalUrl).toHaveBeenCalledWith(
			"https://github.com/acme/notes/pull/7",
		);
		expect(
			await runFactoryTool(
				"show_factory_card",
				{ card: "F12", show: "pull_request" },
				ctx,
			),
		).toMatchObject({ ok: false });
	});
});

describe("createFactoryAnnouncer", () => {
	const factory = factoryTaskConfigSchema.parse({
		checks: [{ name: "API", command: "bun test", kind: "api" }],
		acceptanceCriteria: [{ id: "titles", text: "Title search", check: "API" }],
	});
	const event = (questions: Array<[string, string]>) => ({
		task: {
			taskId: "task-1",
			title: "Search notes",
			instructions: "Search note titles.",
			status: "pending_approval",
			revision: 2,
			factory,
			factoryDesignSessionIds: ["designer-session"],
			factoryQuestions: questions.map(([questionId, status]) => ({
				questionId,
				revision: 2,
				status,
				question: "Which list should search cover?",
				sessionId: "designer-session",
			})),
		},
	});

	it("speaks a question once, and the next question when it comes", () => {
		const announcer = createFactoryAnnouncer();
		const first = event([["q1", "pending"]]);
		expect(announcer.read(first)).toBe(
			"Factory: Factory needs your answer. Search notes: Which list should search cover?",
		);
		// A redelivered snapshot, such as after a reconnect, is the same news.
		expect(announcer.read(first)).toBeNull();
		expect(
			announcer.read(
				event([
					["q1", "answered"],
					["q2", "pending"],
				]),
			),
		).toContain("Factory needs your answer");
	});

	it("knows the sessions Factory runs, so they are not announced as sessions", () => {
		const announcer = createFactoryAnnouncer();
		expect(announcer.isFactorySession("designer-session")).toBe(false);
		announcer.read(event([]));
		expect(announcer.isFactorySession("designer-session")).toBe(true);
		expect(announcer.isFactorySession("my-own-session")).toBe(false);
	});

	it("ignores events that are not Factory task events", () => {
		expect(createFactoryAnnouncer().read({ nope: true })).toBeNull();
	});
});
