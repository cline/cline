/**
 * Connector-to-session semantics (Gateway RFC, Phase 6), tested entirely
 * with in-memory ports: exact-one-bot scoping, durable route mapping,
 * canonical shared sessions, normalized metadata in the prompt, and the
 * credential-free reply capability boundary.
 */

import type {
	BotId,
	ConnectorId,
	RunAccepted,
	SessionId,
} from "@cline/shared/gateway";
import {
	createBotId,
	createConnectorId,
	createRunId,
	createSessionId,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
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
import { createStepClock } from "./in-memory";

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

class RecordingAdmission implements ConnectorRunAdmission {
	readonly submissions: { botId: BotId; prompt: string }[] = [];
	/** One canonical session per bot — exactly like the real runtime. */
	private readonly sessions = new Map<BotId, SessionId>();

	submit(botId: BotId, prompt: string): RunAccepted & { sessionId: SessionId } {
		this.submissions.push({ botId, prompt });
		let sessionId = this.sessions.get(botId);
		if (!sessionId) {
			sessionId = createSessionId();
			this.sessions.set(botId, sessionId);
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
		botId: createBotId(),
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
	it("maps (connector, account, conversation) to (bot, session) durably", () => {
		const { descriptor, routes, inbox } = setup();
		const first = inbox.handleMessage(message(descriptor));
		expect(first.routeCreated).toBe(true);
		expect(first.route.botId).toBe(descriptor.botId);
		expect(first.route.sessionId).toBe(first.accepted.sessionId);
		expect(
			routes.get(descriptor.connectorId, "user-42", "chat-7")?.sessionId,
		).toBe(first.accepted.sessionId);

		const second = inbox.handleMessage(
			message(descriptor, { externalMessageId: "1002", text: "again" }),
		);
		expect(second.routeCreated).toBe(false);
		expect(second.route).toBe(
			routes.get(descriptor.connectorId, "user-42", "chat-7"),
		);
		expect(second.accepted.sessionId).toBe(first.accepted.sessionId);
	});

	it("shares the bot's canonical session across conversations and clients", () => {
		const { descriptor, admission, inbox } = setup();
		const fromChatA = inbox.handleMessage(message(descriptor));
		const fromChatB = inbox.handleMessage(
			message(descriptor, {
				externalConversationId: "chat-8",
				externalMessageId: "2001",
			}),
		);
		// Both external conversations land in the bot's one canonical
		// session — the same session a desktop/CLI prompt would use.
		expect(fromChatB.accepted.sessionId).toBe(fromChatA.accepted.sessionId);
		expect(admission.submissions).toHaveLength(2);
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
				message(descriptor, {
					senderDisplay: undefined,
				}),
			),
		).toBe("[telegram:chat-7] hello bot");
	});

	it("follows the canonical session when admission lands in a new one", () => {
		const { descriptor, routes, admission, inbox } = setup();
		const first = inbox.handleMessage(message(descriptor));
		// Simulate the bot's session being closed and a fresh canonical one
		// created by the next admission.
		(
			admission as unknown as { sessions: Map<BotId, SessionId> }
		).sessions.set(descriptor.botId, createSessionId());
		const second = inbox.handleMessage(
			message(descriptor, { externalMessageId: "1002" }),
		);
		expect(second.accepted.sessionId).not.toBe(first.accepted.sessionId);
		expect(
			routes.get(descriptor.connectorId, "user-42", "chat-7")?.sessionId,
		).toBe(second.accepted.sessionId);
	});
});
