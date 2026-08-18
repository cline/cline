import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildBotRules,
	createBot,
	createBotTools,
	deleteBot,
	deliverBotMessage,
	getBot,
	handleBotsCommand,
	isBotsCommand,
	listBots,
	readBotMemory,
	updateBot,
	writeBotMemory,
} from "./bots";
import type { SidecarContext, SidecarWebSocketClient } from "./types";

let dataDir: string;
let kanbanDir: string;

function createContext(): SidecarContext & {
	sentEvents: Array<{ name: string; payload: Record<string, unknown> }>;
} {
	const sentEvents: Array<{ name: string; payload: Record<string, unknown> }> =
		[];
	const client: SidecarWebSocketClient = {
		send: (message: string) => {
			const parsed = JSON.parse(message) as {
				event: { name: string; payload: Record<string, unknown> };
			};
			sentEvents.push(parsed.event);
		},
	};
	return {
		liveSessions: new Map(),
		restoringWorkspacePaths: new Set(),
		streamIndices: new Map(),
		wsClients: new Set([client]),
		pendingApprovals: new Map(),
		pendingQuestions: new Map(),
		sessionManager: null,
		hubClient: null,
		workspaceRoot: dataDir,
		liveBotSessions: new Map(),
		unsubscribeSessionEvents: null,
		hubBuildMismatch: null,
		sentEvents,
	};
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-bots-test-"));
	kanbanDir = mkdtempSync(join(tmpdir(), "cline-bots-kanban-"));
	process.env.CLINE_BOTS_DATA_DIR = dataDir;
	process.env.CLINE_KANBAN_DATA_DIR = kanbanDir;
});

afterEach(() => {
	delete process.env.CLINE_BOTS_DATA_DIR;
	delete process.env.CLINE_KANBAN_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(kanbanDir, { recursive: true, force: true });
});

describe("bot registry", () => {
	it("creates, lists, updates, and deletes bots", () => {
		const ctx = createContext();
		const created = createBot({
			name: "Chief of Staff",
			shape: "hexagon",
			color: "#3B82F6",
			provider: "openrouter",
			model: "anthropic/claude-sonnet-4.6",
		});
		expect(created.id).toMatch(/^bot_/);
		expect(created.shape).toBe("hexagon");
		expect(created.color).toBe("#3b82f6");
		expect(created.provider).toBe("openrouter");

		const listed = listBots();
		expect(listed).toHaveLength(1);
		expect(listed[0]?.name).toBe("Chief of Staff");
		expect(listed[0]?.hasMemory).toBe(false);

		const updated = updateBot(created.id, { name: "COS", color: "#ef4444" });
		expect(updated.name).toBe("COS");
		expect(updated.color).toBe("#ef4444");
		expect(updated.shape).toBe("hexagon");

		expect(deleteBot(ctx, created.id)).toBe(true);
		expect(listBots()).toHaveLength(0);
		expect(getBot(created.id)).toBeNull();
	});

	it("rejects invalid names and falls back on invalid shapes/colors", () => {
		expect(() => createBot({ name: "   " })).toThrow(/name is required/i);
		const bot = createBot({
			name: "Fallback",
			shape: "blob",
			color: "not-a-color",
		});
		expect(bot.shape).toBe("circle");
		expect(bot.color).toBe("#8b5cf6");
	});

	it("stores memory and surfaces a preview line", () => {
		const bot = createBot({ name: "Research" });
		expect(readBotMemory(bot.id)).toBe("");
		writeBotMemory(bot.id, "# Role\n\nI research topics for the team.");
		expect(readBotMemory(bot.id)).toContain("I research topics");
		const summary = listBots()[0];
		expect(summary?.hasMemory).toBe(true);
		expect(summary?.memoryPreview).toBe("Role");
	});
});

describe("bot persona rules", () => {
	it("includes identity, roster, and memory", () => {
		const bot = createBot({ name: "Chief" });
		const other = createBot({ name: "Researcher" });
		writeBotMemory(bot.id, "I coordinate the other bots.");
		const rules = buildBotRules(getBot(bot.id) ?? bot);
		expect(rules).toContain(`You are "Chief" (bot_id: ${bot.id})`);
		expect(rules).toContain(`Researcher (bot_id: ${other.id})`);
		expect(rules).toContain("I coordinate the other bots.");
		expect(rules).toContain("send_bot_message");
	});

	it("notes an empty memory and empty roster", () => {
		const bot = createBot({ name: "Solo" });
		const rules = buildBotRules(getBot(bot.id) ?? bot);
		expect(rules).toContain("(empty — you have not written any memory yet)");
		expect(rules).toContain("(no other bots yet)");
	});
});

describe("bot tools", () => {
	const toolContext = {
		agentId: "agent",
		conversationId: "conversation",
		iteration: 1,
	};

	function getTool(ctx: SidecarContext, botId: string, name: string) {
		const tool = createBotTools(ctx, botId).find((t) => t.name === name);
		if (!tool) {
			throw new Error(`tool ${name} not found`);
		}
		return tool;
	}

	it("update_memory replaces and appends", async () => {
		const ctx = createContext();
		const bot = createBot({ name: "Memo" });
		const tool = getTool(ctx, bot.id, "update_memory");
		await tool.execute({ content: "# Role\nHelper." }, toolContext);
		expect(readBotMemory(bot.id)).toBe("# Role\nHelper.");
		await tool.execute({ content: "New note.", mode: "append" }, toolContext);
		expect(readBotMemory(bot.id)).toBe("# Role\nHelper.\n\nNew note.");
		const result = (await tool.execute({ content: "  " }, toolContext)) as {
			error?: string;
		};
		expect(result.error).toMatch(/content is required/i);
	});

	it("list_bots marks the calling bot", async () => {
		const ctx = createContext();
		const self = createBot({ name: "Self" });
		const other = createBot({ name: "Other" });
		const tool = getTool(ctx, self.id, "list_bots");
		const result = (await tool.execute({}, toolContext)) as {
			bots: Array<{ bot_id: string; is_you: boolean }>;
		};
		expect(result.bots).toHaveLength(2);
		expect(result.bots.find((entry) => entry.bot_id === self.id)?.is_you).toBe(
			true,
		);
		expect(result.bots.find((entry) => entry.bot_id === other.id)?.is_you).toBe(
			false,
		);
	});

	it("read_bot_memory reads another bot's memory", async () => {
		const ctx = createContext();
		const self = createBot({ name: "Self" });
		const other = createBot({ name: "Other" });
		writeBotMemory(other.id, "Other bot memory.");
		const tool = getTool(ctx, self.id, "read_bot_memory");
		const result = (await tool.execute({ bot_id: other.id }, toolContext)) as {
			memory?: string;
		};
		expect(result.memory).toBe("Other bot memory.");
		const missing = (await tool.execute(
			{ bot_id: "bot_missing" },
			toolContext,
		)) as { error?: string };
		expect(missing.error).toMatch(/no bot with bot_id/i);
	});

	it("read_bot_chat returns empty for bots without a session", async () => {
		const ctx = createContext();
		const self = createBot({ name: "Self" });
		const other = createBot({ name: "Other" });
		const tool = getTool(ctx, self.id, "read_bot_chat");
		const result = (await tool.execute({ bot_id: other.id }, toolContext)) as {
			messages?: unknown[];
		};
		expect(result.messages).toEqual([]);
	});
});

describe("deliverBotMessage", () => {
	it("rejects unknown targets and self-sends", async () => {
		const ctx = createContext();
		const self = createBot({ name: "Self" });
		expect(
			(await deliverBotMessage(ctx, self.id, "bot_missing", "hi")) as {
				error?: string;
			},
		).toMatchObject({ error: expect.stringMatching(/no bot with bot_id/i) });
		expect(
			(await deliverBotMessage(ctx, self.id, self.id, "hi")) as {
				error?: string;
			},
		).toMatchObject({ error: expect.stringMatching(/yourself/i) });
	});

	it("delivers to a live bot session with attribution and emits a chat event", async () => {
		const ctx = createContext();
		const sender = createBot({ name: "Chief" });
		const receiver = createBot({ name: "Researcher" });
		ctx.liveBotSessions.set(receiver.id, "session_receiver");
		const send = vi.fn().mockResolvedValue(undefined);
		ctx.sessionManager = {
			send,
		} as unknown as SidecarContext["sessionManager"];

		const result = (await deliverBotMessage(
			ctx,
			sender.id,
			receiver.id,
			"Please research X.",
		)) as { delivered?: boolean };
		expect(result.delivered).toBe(true);
		expect(send).toHaveBeenCalledWith({
			sessionId: "session_receiver",
			prompt: `[Bot message from "Chief" (bot_id: ${sender.id})]\n\nPlease research X.`,
		});
		const chatEvent = ctx.sentEvents.find(
			(event) => event.name === "chat_event",
		);
		expect(chatEvent?.payload).toMatchObject({
			sessionId: "session_receiver",
			stream: "chat_queued_prompt_start",
		});
	});

	it("falls back to queue delivery when the receiver is mid-turn", async () => {
		const ctx = createContext();
		const sender = createBot({ name: "Chief" });
		const receiver = createBot({ name: "Researcher" });
		ctx.liveBotSessions.set(receiver.id, "session_receiver");
		const send = vi
			.fn()
			.mockRejectedValueOnce(new Error("session_run_in_progress"))
			.mockResolvedValueOnce(undefined);
		ctx.sessionManager = {
			send,
		} as unknown as SidecarContext["sessionManager"];

		await deliverBotMessage(ctx, sender.id, receiver.id, "Queued message.");
		await vi.waitFor(() => {
			expect(send).toHaveBeenCalledTimes(2);
		});
		expect(send).toHaveBeenLastCalledWith(
			expect.objectContaining({ delivery: "queue" }),
		);
	});
});

describe("handleBotsCommand", () => {
	it("routes commands and reports support", () => {
		const ctx = createContext();
		expect(isBotsCommand("list_bots")).toBe(true);
		expect(isBotsCommand("read_session_messages")).toBe(false);

		const created = handleBotsCommand(ctx, "create_bot", {
			name: "Cmd Bot",
			shape: "star",
			color: "#10b981",
		}) as { id: string };
		expect(created.id).toMatch(/^bot_/);
		expect((handleBotsCommand(ctx, "list_bots") as unknown[]).length).toBe(1);
		handleBotsCommand(ctx, "update_bot_memory", {
			botId: created.id,
			memory: "Hello.",
		});
		expect(
			handleBotsCommand(ctx, "read_bot_memory", { botId: created.id }),
		).toMatchObject({ memory: "Hello." });
		expect(handleBotsCommand(ctx, "delete_bot", { botId: created.id })).toBe(
			true,
		);
		// Mutations broadcast roster refreshes to connected webviews.
		expect(
			ctx.sentEvents.filter((event) => event.name === "bots_changed").length,
		).toBeGreaterThanOrEqual(3);
	});
});
