import { describe, expect, it } from "vitest";
import { HubContext } from "./state";
import { loadSessionIntoMemory, sendMessage } from "./sessions";
import type { BrowserPeer } from "./types";

/**
 * The hub lists every session stored on disk, but it only accepts a turn for the
 * sessions it holds in memory. A session created by Cline Desktop therefore
 * hydrates fine and fails the turn with `session not found: <id>`. These cover
 * loading such a session back in and sending the prompt that triggered it.
 */

const SOURCE_SESSION_ID = "session_1790745014823_bfq7b";
const LOADED_SESSION_ID = "session_loaded";

const sourceRecord = {
	sessionId: SOURCE_SESSION_ID,
	workspaceRoot: "C:/work/thesis",
	cwd: "C:/work/thesis",
	provider: "openai-compatible",
	model: "swift-1.5-iq3_xxs",
	status: "completed",
	metadata: { mode: "plan", title: "博士論文" },
};

const storedMessages = [
	{ role: "user", content: "先行研究の整理を続けて" },
	{ role: "assistant", content: "了解しました" },
];

function sessionNotFoundError(sessionId: string) {
	const error = new Error(`session not found: ${sessionId}`) as Error & {
		code?: string;
	};
	error.code = "session_not_found";
	return error;
}

type FakeCline = {
	get: (sessionId: string) => Promise<Record<string, unknown> | undefined>;
	readMessages: (sessionId: string) => Promise<unknown[]>;
	start: (input: Record<string, unknown>) => Promise<{ sessionId: string }>;
	send: (input: { sessionId: string; prompt: string }) => Promise<void>;
	startInputs: Record<string, unknown>[];
	sentPrompts: { sessionId: string; prompt: string }[];
};

function makeCline(options: { liveSessionIds?: string[] } = {}): FakeCline {
	const live = new Set(options.liveSessionIds ?? [LOADED_SESSION_ID]);
	const cline: FakeCline = {
		startInputs: [],
		sentPrompts: [],
		get: async (sessionId: string) => {
			if (sessionId === SOURCE_SESSION_ID) return sourceRecord;
			if (live.has(sessionId))
				return { ...sourceRecord, sessionId, status: "running" };
			return undefined;
		},
		readMessages: async (sessionId: string) =>
			sessionId === SOURCE_SESSION_ID ? storedMessages : [],
		start: async (input: Record<string, unknown>) => {
			cline.startInputs.push(input);
			// The runtime hosts reuse a requested session id, so loading a
			// stored session back in keeps the session the user picked.
			const config = input.config as { sessionId?: string } | undefined;
			const sessionId = config?.sessionId?.trim() || LOADED_SESSION_ID;
			live.add(sessionId);
			return { sessionId };
		},
		send: async ({ sessionId, prompt }) => {
			if (!live.has(sessionId)) throw sessionNotFoundError(sessionId);
			cline.sentPrompts.push({ sessionId, prompt });
		},
	};
	return cline;
}

function makeContext(cline: FakeCline) {
	const ctx = new HubContext();
	ctx.cline = cline as unknown as HubContext["cline"];
	return ctx;
}

function makePeer(ctx: HubContext, selectedSessionId: string) {
	const sent: Record<string, unknown>[] = [];
	const peer = {
		socket: { send: (data: string) => sent.push(JSON.parse(data)) },
		displayName: "phone",
		sending: false,
		selectedSessionId,
	} as unknown as BrowserPeer;
	ctx.peers.add(peer);
	return { peer, sent };
}

describe("loading a disk-only session into the hub", () => {
	it("starts a session seeded with the stored conversation", async () => {
		const cline = makeCline();
		const ctx = makeContext(cline);
		const { peer } = makePeer(ctx, SOURCE_SESSION_ID);

		const loaded = await loadSessionIntoMemory(ctx, peer, SOURCE_SESSION_ID);

		expect(loaded).toBe(SOURCE_SESSION_ID);
		const startInput = cline.startInputs[0];
		const config = startInput?.config as Record<string, unknown>;
		expect(config.sessionId).toBe(SOURCE_SESSION_ID);
		expect(config.workspaceRoot).toBe("C:/work/thesis");
		expect(config.cwd).toBe("C:/work/thesis");
		expect(config.providerId).toBe("openai-compatible");
		expect(config.modelId).toBe("swift-1.5-iq3_xxs");
		expect(config.mode).toBe("plan");
		expect(startInput?.initialMessages).toEqual(storedMessages);
		expect(
			(startInput?.sessionMetadata as Record<string, unknown>)?.title,
		).toBe(sourceRecord.metadata.title);
	});

	it("moves the peer onto the loaded session and rehydrates it", async () => {
		const cline = makeCline();
		const ctx = makeContext(cline);
		const { peer, sent } = makePeer(ctx, SOURCE_SESSION_ID);

		await loadSessionIntoMemory(ctx, peer, SOURCE_SESSION_ID);

		expect((peer as BrowserPeer).selectedSessionId).toBe(SOURCE_SESSION_ID);
		expect(ctx.sessions.has(SOURCE_SESSION_ID)).toBe(true);
		expect(sent.map((frame) => frame.type).slice(0, 2)).toEqual([
			"session_started",
			"session_hydrated",
		]);
		expect(sent.map((frame) => frame.type)).toContain("hub_state");
		const hydrated = sent[1];
		expect(hydrated?.sessionId).toBe(SOURCE_SESSION_ID);
		expect((hydrated?.messages as unknown[])?.length).toBe(storedMessages.length);
	});

	it("prefers the tracked session row when the record has no workspace", async () => {
		const cline = makeCline();
		cline.get = async (sessionId: string) =>
			sessionId === SOURCE_SESSION_ID
				? { sessionId, status: "failed", metadata: { mode: "plan" } }
				: undefined;
		const ctx = makeContext(cline);
		ctx.sessions.set(SOURCE_SESSION_ID, {
			sessionId: SOURCE_SESSION_ID,
			status: "failed",
			title: "博士論文",
			workspaceRoot: "C:/work/thesis",
			cwd: "C:/work/thesis",
			provider: "openai-compatible",
			model: "swift-1.5-iq3_xxs",
			createdAt: 0,
			updatedAt: 0,
			agentCount: 0,
			participantCount: 0,
		});
		const { peer } = makePeer(ctx, SOURCE_SESSION_ID);

		const loaded = await loadSessionIntoMemory(ctx, peer, SOURCE_SESSION_ID);

		expect(loaded).toBe(SOURCE_SESSION_ID);
		const config = cline.startInputs[0]?.config as Record<string, unknown>;
		expect(config.sessionId).toBe(SOURCE_SESSION_ID);
		expect(config.workspaceRoot).toBe("C:/work/thesis");
		expect(config.providerId).toBe("openai-compatible");
		expect(config.modelId).toBe("swift-1.5-iq3_xxs");
	});

	it("does nothing when the session is not on disk", async () => {
		const cline = makeCline();
		const ctx = makeContext(cline);
		const { peer, sent } = makePeer(ctx, "session_missing");

		const loaded = await loadSessionIntoMemory(ctx, peer, "session_missing");

		expect(loaded).toBeUndefined();
		expect(cline.startInputs.length).toBe(0);
		expect(sent.length).toBe(0);
	});
});

describe("sending to a disk-only session", () => {
	it("loads the session and delivers the prompt that failed", async () => {
		const cline = makeCline({ liveSessionIds: [] });
		const ctx = makeContext(cline);
		const { peer } = makePeer(ctx, SOURCE_SESSION_ID);

		await sendMessage(ctx, peer, "続きをやって", { mode: "act" });

		expect(cline.startInputs.length).toBe(1);
		expect(cline.sentPrompts).toEqual([
			{ sessionId: SOURCE_SESSION_ID, prompt: "続きをやって" },
		]);
	});

	it("leaves an unrelated failure alone", async () => {
		const cline = makeCline({ liveSessionIds: [] });
		cline.send = async () => {
			throw new Error("provider exploded");
		};
		const ctx = makeContext(cline);
		const { peer } = makePeer(ctx, SOURCE_SESSION_ID);

		await expect(
			sendMessage(ctx, peer, "続きをやって", { mode: "act" }),
		).rejects.toThrow("provider exploded");
		expect(cline.startInputs.length).toBe(0);
	});
});
