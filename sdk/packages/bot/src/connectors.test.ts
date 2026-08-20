/**
 * Connector-to-session semantics (Gateway RFC, Phase 6), tested entirely
 * with in-memory ports: exact-one-bot scoping, durable route mapping to
 * DEDICATED sessions (one per external conversation), session reuse for
 * later messages, isolation from the bot's canonical (desktop/CLI)
 * session, normalized metadata in the prompt, and the credential-free
 * reply capability boundary.
 */

import type {
	BotId,
	ConnectorId,
	RunAccepted,
	SessionId,
} from "@cline/shared/gateway";
import {
	createConnectorId,
	createRunId,
	createSessionId,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { Bot } from "./bot";
import type {
	ConnectorDescriptor,
	ConnectorRoute,
	ConnectorRouteRepository,
	ConnectorRunAdmission,
	NormalizedConnectorMessage,
} from "./connectors";
import {
	ConnectorInbox,
	ConnectorScopeError,
	formatConnectorPrompt,
} from "./connectors";
import { createInMemoryPorts, createStepClock } from "./in-memory";
import { BotRegistry } from "./registry";

class InMemoryRouteRepository implements ConnectorRouteRepository {
	readonly routes = new Map<string, ConnectorRoute>();

	get(
		connectorId: ConnectorId,
		externalAccountId: string,
		externalConversationId: string,
	): ConnectorRoute | undefined {
		return this.routes.get(
			`${connectorId}|${externalAccountId}|${externalConversationId}`,
		);
	}

	save(route: ConnectorRoute): void {
		this.routes.set(
			`${route.connectorId}|${route.externalAccountId}|${route.externalConversationId}`,
			route,
		);
	}
}

/**
 * Mimics the Gateway's dedicated-session admission: a submit without a
 * sessionId creates a NEW dedicated session; with one it reuses it.
 */
class RecordingAdmission implements ConnectorRunAdmission {
	readonly submissions: {
		botId: BotId;
		prompt: string;
		sessionId?: SessionId;
	}[] = [];
	readonly createdSessions: SessionId[] = [];

	submit(
		botId: BotId,
		prompt: string,
		context: { sessionId?: SessionId },
	): RunAccepted & { sessionId: SessionId } {
		this.submissions.push({ botId, prompt, sessionId: context.sessionId });
		const sessionId = context.sessionId ?? createSessionId();
		if (!context.sessionId) {
			this.createdSessions.push(sessionId);
		}
		return {
			runId: createRunId(),
			acceptedAt: this.submissions.length,
			queuePosition: 0,
			sessionId,
		};
	}
}

function setup() {
	const descriptor: ConnectorDescriptor = {
		connectorId: createConnectorId(),
		botId: "bot_testbot00000001" as BotId,
		kind: "telegram",
		name: "team-bot",
	};
	const routes = new InMemoryRouteRepository();
	const admission = new RecordingAdmission();
	const inbox = new ConnectorInbox(descriptor, {
		routes,
		admission,
		clock: createStepClock(),
	});
	return { descriptor, routes, admission, inbox };
}

function message(
	descriptor: ConnectorDescriptor,
	overrides: Partial<NormalizedConnectorMessage> = {},
): NormalizedConnectorMessage {
	return {
		connectorId: descriptor.connectorId,
		externalAccountId: "user-42",
		externalConversationId: "chat-7",
		externalMessageId: "1001",
		text: "hello bot",
		senderDisplay: "ada",
		metadata: { platform: "telegram" },
		...overrides,
	};
}

describe("connector inbox semantics", () => {
	it("creates a dedicated session per conversation and maps it durably", () => {
		const { descriptor, routes, inbox, admission } = setup();
		const first = inbox.handleMessage(message(descriptor));
		expect(first.routeCreated).toBe(true);
		expect(first.route.botId).toBe(descriptor.botId);
		expect(first.route.sessionId).toBe(first.accepted.sessionId);
		// The first message creates a NEW dedicated session (no sessionId
		// was passed to admission).
		expect(admission.submissions[0].sessionId).toBeUndefined();
		expect(admission.createdSessions).toEqual([first.accepted.sessionId]);
		expect(
			routes.get(descriptor.connectorId, "user-42", "chat-7")?.sessionId,
		).toBe(first.accepted.sessionId);
	});

	it("reuses the same dedicated session for later messages in one conversation", () => {
		const { descriptor, routes, inbox, admission } = setup();
		const first = inbox.handleMessage(message(descriptor));
		const second = inbox.handleMessage(
			message(descriptor, { externalMessageId: "1002", text: "again" }),
		);
		expect(second.routeCreated).toBe(false);
		// The routed session was passed to admission and reused.
		expect(admission.submissions[1].sessionId).toBe(first.accepted.sessionId);
		expect(second.accepted.sessionId).toBe(first.accepted.sessionId);
		expect(second.route).toBe(
			routes.get(descriptor.connectorId, "user-42", "chat-7"),
		);
	});

	it("keeps unrelated conversations in separate sessions", () => {
		const { descriptor, inbox } = setup();
		const chatA = inbox.handleMessage(message(descriptor));
		const chatB = inbox.handleMessage(
			message(descriptor, {
				externalConversationId: "chat-8",
				externalMessageId: "2001",
			}),
		);
		const otherUserSameChat = inbox.handleMessage(
			message(descriptor, {
				externalAccountId: "user-99",
				externalMessageId: "2002",
			}),
		);
		const sessions = new Set([
			chatA.accepted.sessionId,
			chatB.accepted.sessionId,
			otherUserSameChat.accepted.sessionId,
		]);
		// Different chats AND different external users are isolated.
		expect(sessions.size).toBe(3);
	});

	it("rejects messages claiming another connector's identity", () => {
		const { descriptor, inbox } = setup();
		expect(() =>
			inbox.handleMessage(
				message(descriptor, { connectorId: createConnectorId() }),
			),
		).toThrow(ConnectorScopeError);
	});

	it("puts normalized source metadata into the prompt, never credentials", () => {
		const { descriptor, admission, inbox } = setup();
		inbox.handleMessage(message(descriptor));
		expect(admission.submissions[0].prompt).toBe(
			"[telegram:chat-7 from ada] hello bot",
		);
		expect(
			formatConnectorPrompt(
				descriptor,
				message(descriptor, { senderDisplay: undefined }),
			),
		).toBe("[telegram:chat-7] hello bot");
	});

	it("follows the session when admission lands in a fresh one", () => {
		const { descriptor, routes, admission, inbox } = setup();
		const first = inbox.handleMessage(message(descriptor));
		// Simulate the routed session being closed: admission ignores the
		// stale sessionId and creates a fresh dedicated session.
		admission.submit = (() => {
			const sessionId = createSessionId();
			return {
				runId: createRunId(),
				acceptedAt: 99,
				queuePosition: 0,
				sessionId,
			};
		}) as RecordingAdmission["submit"];
		const second = inbox.handleMessage(
			message(descriptor, { externalMessageId: "1002" }),
		);
		expect(second.accepted.sessionId).not.toBe(first.accepted.sessionId);
		expect(
			routes.get(descriptor.connectorId, "user-42", "chat-7")?.sessionId,
		).toBe(second.accepted.sessionId);
	});
});

describe("dedicated session lanes on the Bot domain", () => {
	function createBot() {
		const ports = createInMemoryPorts();
		ports.engine.autoOutcome = () => ({ outputText: "done" });
		const registry = new BotRegistry(ports);
		const lead = registry.bootstrap();
		return { ports, bot: new Bot(lead.identity.botId, ports), lead };
	}

	it("isolates dedicated sessions from the canonical session", async () => {
		const { bot, ports } = createBot();
		// Desktop uses the canonical session…
		const canonical = bot.submitPrompt("desktop context");
		const canonicalSession = bot.session;
		if (!canonicalSession) {
			throw new Error("no canonical session");
		}
		// …while two external conversations get their own sessions.
		const conversationA = bot.submitPromptToSession("from chat A");
		const conversationB = bot.submitPromptToSession("from chat B");
		expect(conversationA.sessionId).not.toBe(canonicalSession.sessionId);
		expect(conversationB.sessionId).not.toBe(canonicalSession.sessionId);
		expect(conversationA.sessionId).not.toBe(conversationB.sessionId);
		// External conversations never inherit desktop context: each session
		// holds only its own runs.
		await bot.whenIdle();
		expect(
			ports.runs.listBySession(conversationA.sessionId).map((run) => run.input),
		).toEqual(["from chat A"]);
		expect(
			ports.runs
				.listBySession(canonicalSession.sessionId)
				.map((run) => run.input),
		).toEqual(["desktop context"]);
		expect(ports.sessions.get(conversationA.sessionId)?.kind).toBe("dedicated");
		expect(ports.sessions.get(canonicalSession.sessionId)?.kind).toBe(
			"canonical",
		);
		void canonical;
	});

	it("lets desktop join a dedicated session only by naming it explicitly", async () => {
		const { bot, ports } = createBot();
		const conversation = bot.submitPromptToSession("external question");
		// Desktop intentionally opens the conversation's session.
		const joined = bot.submitPromptToSession("desktop assist", {
			sessionId: conversation.sessionId,
		});
		expect(joined.sessionId).toBe(conversation.sessionId);
		await bot.whenIdle();
		expect(
			ports.runs.listBySession(conversation.sessionId).map((run) => run.input),
		).toEqual(["external question", "desktop assist"]);
	});

	it("runs lanes concurrently and steers/interrupts per run", async () => {
		const ports = createInMemoryPorts();
		const registry = new BotRegistry(ports);
		const lead = registry.bootstrap();
		const bot = new Bot(lead.identity.botId, ports);
		const laneA = bot.submitPromptToSession("lane A");
		const laneB = bot.submitPromptToSession("lane B");
		// Both lanes are active simultaneously (per-session FIFO, not
		// per-bot).
		expect(ports.engine.handles).toHaveLength(2);
		expect(bot.isRunActive(laneA.runId)).toBe(true);
		expect(bot.isRunActive(laneB.runId)).toBe(true);
		// Steering targets exactly one lane.
		expect(bot.steerRun(laneB.runId, "focus")).toBe(true);
		expect(ports.engine.handles[0].steers).toEqual([]);
		expect(ports.engine.handles[1].steers).toEqual(["focus"]);
		// Interrupting one lane leaves the other running.
		bot.interruptRun(laneA.runId, "enough");
		expect(ports.engine.handles[0].interrupted).toBe(true);
		expect(ports.engine.handles[1].interrupted).toBe(false);
		ports.engine.handles[0].settle({ status: "interrupted" });
		ports.engine.handles[1].settle({ outputText: "done" });
		await bot.whenIdle();
	});

	it("rejects dedicated sessions for other bots' session ids", () => {
		const { bot, ports } = createBot();
		const foreignSession = createSessionId();
		void ports;
		expect(() =>
			bot.submitPromptToSession("sneaky", { sessionId: foreignSession }),
		).toThrow(/does not belong to bot/);
	});

	it("rejects dedicated sessions for contractors", async () => {
		const ports = createInMemoryPorts();
		const registry = new BotRegistry(ports);
		const lead = registry.bootstrap();
		const contractor = registry.delegate(lead.identity.botId, {
			name: "one-shot",
			role: "contractor",
		});
		const bot = new Bot(contractor.identity.botId, ports);
		expect(() => bot.submitPromptToSession("task")).toThrow(
			/Contractors take exactly one task/,
		);
	});
});
