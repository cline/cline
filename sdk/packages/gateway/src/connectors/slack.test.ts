/**
 * Slack bot adapter (Gateway RFC, Phase 6 V0): Socket Mode envelopes,
 * per-event acks, event_id-based crash-safe dedupe (Slack redelivers),
 * un-acked delivery failures, and the credential-holding reply port.
 */

import type {
	ConnectorDescriptor,
	NormalizedConnectorMessage,
} from "@cline/bot";
import { createBotId, createConnectorId } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import type { ConnectorAdapterContext } from "./adapter";
import { ConnectorDeliveryError } from "./adapter";
import type { SlackSocket } from "./slack";
import {
	parseSlackConversationId,
	parseSlackCredential,
	redactSlackTokens,
	SLACK_MAX_MESSAGE_LENGTH,
	SlackConnectorAdapter,
	slackConversationId,
} from "./slack";

const DESCRIPTOR: ConnectorDescriptor = {
	connectorId: createConnectorId(),
	botId: createBotId(),
	kind: "slack",
	name: "slack",
};

const CREDENTIAL = JSON.stringify({
	appToken: "xapp-test",
	botToken: "xoxb-test",
});

class FakeSocket implements SlackSocket {
	readonly sent: unknown[] = [];
	private listeners = new Set<(frame: unknown) => void>();
	private closeListeners = new Set<() => void>();

	send(frame: unknown): void {
		this.sent.push(frame);
	}

	emit(frame: unknown): void {
		for (const listener of this.listeners) {
			listener(frame);
		}
	}

	onMessage(listener: (frame: unknown) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	onClose(listener: () => void): () => void {
		this.closeListeners.add(listener);
		return () => {
			this.closeListeners.delete(listener);
		};
	}

	close(): void {
		for (const listener of this.closeListeners) {
			listener();
		}
	}
}

function messageEnvelope(
	eventId: string,
	text: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		type: "events_api",
		envelope_id: `env-${eventId}`,
		payload: {
			event_id: eventId,
			team_id: "T1",
			event: {
				type: "message",
				text,
				user: "U42",
				channel: "C7",
				ts: "1700000000.000100",
				channel_type: "channel",
				...overrides,
			},
		},
	};
}

function createHarness(options: {
	onDeliver?: (message: NormalizedConnectorMessage, next: string) => void;
	failDeliver?: boolean;
}) {
	const controller = new AbortController();
	let cursor: string | undefined;
	const delivered: NormalizedConnectorMessage[] = [];
	const socket = new FakeSocket();
	const adapter = new SlackConnectorAdapter({
		socketFactory: async () => socket,
		dedupeWindow: 4,
	});
	const context: ConnectorAdapterContext = {
		descriptor: DESCRIPTOR,
		config: {},
		credential: CREDENTIAL,
		signal: controller.signal,
		cursor: () => cursor,
		deliver: (message, next) => {
			if (options.failDeliver) {
				throw new Error("admission rejected");
			}
			delivered.push(message);
			cursor = next;
			options.onDeliver?.(message, next);
		},
		commitCursor: (next) => {
			cursor = next;
		},
		log: () => {},
	};
	const done = adapter.run(context);
	return {
		socket,
		controller,
		delivered,
		done,
		cursor: () => cursor,
	};
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("slack adapter", () => {
	it("delivers normalized message events and acks each envelope", async () => {
		const harness = createHarness({});
		await settle();
		harness.socket.emit({ type: "hello" });
		harness.socket.emit(messageEnvelope("Ev001", "hello there"));
		await settle();
		expect(harness.delivered).toHaveLength(1);
		expect(harness.delivered[0]).toMatchObject({
			connectorId: DESCRIPTOR.connectorId,
			externalAccountId: "U42",
			externalConversationId: "C7",
			externalMessageId: "Ev001",
			text: "hello there",
			sentAt: 1_700_000_000_000,
		});
		expect(harness.delivered[0].metadata).toMatchObject({
			platform: "slack",
			teamId: "T1",
			channelType: "channel",
		});
		expect(harness.socket.sent).toContainEqual({ envelope_id: "env-Ev001" });
		harness.controller.abort();
		harness.socket.close();
		await harness.done;
	});

	it("dedupes redelivered events by event_id (crash-safe cursor)", async () => {
		const harness = createHarness({});
		await settle();
		harness.socket.emit(messageEnvelope("Ev001", "first"));
		await settle();
		// Slack redelivers the same event (missed-ack retry semantics).
		harness.socket.emit(messageEnvelope("Ev001", "first"));
		harness.socket.emit(messageEnvelope("Ev002", "second"));
		await settle();
		expect(harness.delivered.map((m) => m.externalMessageId)).toEqual([
			"Ev001",
			"Ev002",
		]);
		// Both deliveries were acked, the duplicate too.
		expect(
			harness.socket.sent.filter(
				(frame) =>
					(frame as { envelope_id?: string }).envelope_id === "env-Ev001",
			),
		).toHaveLength(2);
		const seen = JSON.parse(harness.cursor() ?? "[]") as string[];
		expect(seen).toEqual(["Ev001", "Ev002"]);
		harness.controller.abort();
		harness.socket.close();
		await harness.done;
	});

	it("ignores bot messages and non-message events, acking them", async () => {
		const harness = createHarness({});
		await settle();
		harness.socket.emit(
			messageEnvelope("Ev010", "from a bot", { bot_id: "B1", user: undefined }),
		);
		harness.socket.emit(
			messageEnvelope("Ev011", "edited", { subtype: "message_changed" }),
		);
		await settle();
		expect(harness.delivered).toHaveLength(0);
		expect(harness.socket.sent).toContainEqual({ envelope_id: "env-Ev010" });
		expect(harness.socket.sent).toContainEqual({ envelope_id: "env-Ev011" });
		harness.controller.abort();
		harness.socket.close();
		await harness.done;
	});

	it("does not ack (or advance the cursor) when admission fails", async () => {
		const harness = createHarness({ failDeliver: true });
		await settle();
		harness.socket.emit(messageEnvelope("Ev020", "will fail"));
		await settle();
		expect(harness.cursor()).toBeUndefined();
		expect(harness.socket.sent).not.toContainEqual({
			envelope_id: "env-Ev020",
		});
		harness.controller.abort();
		harness.socket.close();
		await harness.done;
	});

	it("separates channels and threads into distinct conversations (sessions)", async () => {
		const harness = createHarness({});
		await settle();
		// Top-level channel message.
		harness.socket.emit(messageEnvelope("Ev100", "in the channel"));
		// Two different threads in the SAME channel.
		harness.socket.emit(
			messageEnvelope("Ev101", "thread one", { thread_ts: "111.000" }),
		);
		harness.socket.emit(
			messageEnvelope("Ev102", "thread two", { thread_ts: "222.000" }),
		);
		// A later reply in thread one reuses ITS conversation id.
		harness.socket.emit(
			messageEnvelope("Ev103", "thread one again", { thread_ts: "111.000" }),
		);
		await settle();
		expect(
			harness.delivered.map((message) => message.externalConversationId),
		).toEqual(["C7", "C7#111.000", "C7#222.000", "C7#111.000"]);
		// The encoding round-trips for replies.
		expect(parseSlackConversationId("C7#111.000")).toEqual({
			channel: "C7",
			threadTs: "111.000",
		});
		expect(slackConversationId("C7")).toBe("C7");
		harness.controller.abort();
		harness.socket.close();
		await harness.done;
	});

	it("replies into the thread for thread conversations", async () => {
		const requests: { url: string; init?: RequestInit }[] = [];
		const adapter = new SlackConnectorAdapter({
			fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
				requests.push({ url: String(input), init });
				return {
					ok: true,
					status: 200,
					json: async () => ({ ok: true, ts: "999.123" }),
				} as Response;
			}) as typeof fetch,
			socketFactory: async () => new FakeSocket(),
		});
		const port = adapter.createReplyPort({}, CREDENTIAL);
		const result = await port.reply(
			{ externalAccountId: "U42", externalConversationId: "C7#111.000" },
			"threaded reply",
		);
		expect(JSON.parse(String(requests[0].init?.body))).toEqual({
			channel: "C7",
			text: "threaded reply",
			thread_ts: "111.000",
		});
		expect(result?.externalMessageIds).toEqual(["999.123"]);
	});

	it("classifies permanent vs transient delivery failures", async () => {
		const scripted: { status: number; body: Record<string, unknown> }[] = [
			{ status: 200, body: { ok: false, error: "invalid_auth" } },
			{ status: 200, body: { ok: false, error: "ratelimited" } },
			{ status: 503, body: {} },
		];
		const adapter = new SlackConnectorAdapter({
			fetchImpl: (async () => {
				const next = scripted.shift();
				return {
					ok: (next?.status ?? 500) < 400,
					status: next?.status ?? 500,
					json: async () => next?.body ?? {},
				} as Response;
			}) as typeof fetch,
			socketFactory: async () => new FakeSocket(),
		});
		const port = adapter.createReplyPort({}, CREDENTIAL);
		const conversation = {
			externalAccountId: "U42",
			externalConversationId: "C7",
		};
		// Revoked credential: permanent.
		await expect(port.reply(conversation, "x")).rejects.toMatchObject({
			name: "ConnectorDeliveryError",
			retryable: false,
		});
		// Rate limit and 5xx: transient.
		await expect(port.reply(conversation, "x")).rejects.toMatchObject({
			retryable: true,
		});
		await expect(port.reply(conversation, "x")).rejects.toMatchObject({
			retryable: true,
		});
	});

	it("treats missing and malformed credentials as permanent failures", async () => {
		const adapter = new SlackConnectorAdapter({
			socketFactory: async () => new FakeSocket(),
		});
		await expect(
			adapter
				.createReplyPort({}, undefined)
				.reply({ externalAccountId: "U42", externalConversationId: "C7" }, "x"),
		).rejects.toMatchObject({ retryable: false });
		const malformed = adapter.createReplyPort({}, "not json");
		await expect(
			malformed.reply(
				{ externalAccountId: "U42", externalConversationId: "C7" },
				"x",
			),
		).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof ConnectorDeliveryError &&
				!error.retryable &&
				!error.message.includes("not json"),
		);
	});

	it("verifies credentials via auth.test and never leaks tokens", async () => {
		const requests: { url: string; init?: RequestInit }[] = [];
		const adapter = new SlackConnectorAdapter({
			fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
				requests.push({ url: String(input), init });
				return {
					ok: true,
					status: 200,
					json: async () => ({ ok: true, user: "gatewaybot", team: "acme" }),
				} as Response;
			}) as typeof fetch,
			socketFactory: async () => new FakeSocket(),
		});
		const check = await adapter.testCredentials({}, CREDENTIAL);
		expect(check.ok).toBe(true);
		expect(check.detail).toBe("gatewaybot @ acme");
		expect(requests[0].url).toContain("/auth.test");
		// Missing credential: a clean failure, not an exception.
		expect((await adapter.testCredentials({}, undefined)).ok).toBe(false);
		// Redaction helper scrubs both tokens.
		expect(
			redactSlackTokens("failed at xapp-test and xoxb-test", CREDENTIAL),
		).toBe("failed at [REDACTED] and [REDACTED]");
	});

	it("exposes the platform message limit", () => {
		const adapter = new SlackConnectorAdapter({
			socketFactory: async () => new FakeSocket(),
		});
		expect(adapter.maxMessageLength).toBe(SLACK_MAX_MESSAGE_LENGTH);
		expect(SLACK_MAX_MESSAGE_LENGTH).toBe(40_000);
	});

	it("validates the credential shape", () => {
		expect(() => parseSlackCredential("not json")).toThrow();
		expect(() => parseSlackCredential(JSON.stringify({}))).toThrow(/appToken/);
		expect(parseSlackCredential(CREDENTIAL)).toEqual({
			appToken: "xapp-test",
			botToken: "xoxb-test",
		});
	});

	it("replies through chat.postMessage with the bot token inside the port", async () => {
		const requests: { url: string; init?: RequestInit }[] = [];
		const adapter = new SlackConnectorAdapter({
			fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
				requests.push({ url: String(input), init });
				return {
					ok: true,
					status: 200,
					json: async () => ({ ok: true }),
				} as Response;
			}) as typeof fetch,
			socketFactory: async () => new FakeSocket(),
		});
		const port = adapter.createReplyPort({}, CREDENTIAL);
		await port.reply(
			{ externalAccountId: "U42", externalConversationId: "C7" },
			"done",
		);
		expect(requests[0].url).toContain("/chat.postMessage");
		expect(
			(requests[0].init?.headers as Record<string, string>).authorization,
		).toBe("Bearer xoxb-test");
		expect(JSON.parse(String(requests[0].init?.body))).toEqual({
			channel: "C7",
			text: "done",
		});
	});
});
