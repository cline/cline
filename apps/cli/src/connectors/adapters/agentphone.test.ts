import { createHmac } from "node:crypto";
import type { ConnectAgentPhoneOptions } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { __test__, agentPhoneConnector } from "./agentphone";

const parseAgentPhoneArgs = (rawArgs: string[]): ConnectAgentPhoneOptions =>
	(
		agentPhoneConnector as unknown as {
			parseArgs(rawArgs: string[]): ConnectAgentPhoneOptions;
		}
	).parseArgs(rawArgs);

describe("agentPhoneConnector", () => {
	it("parses AgentPhone credentials separately from provider credentials", () => {
		const options = parseAgentPhoneArgs([
			"--api-key",
			"agentphone-key",
			"--agent-id",
			"agent_123",
			"--webhook-secret",
			"whsec_123",
			"--provider-api-key",
			"provider-key",
			"--base-url",
			"https://example.test",
		]);

		expect(options.apiKey).toBe("agentphone-key");
		expect(options.agentId).toBe("agent_123");
		expect(options.webhookSecret).toBe("whsec_123");
		expect(options.apiProviderKey).toBe("provider-key");
		expect(options.baseUrl).toBe("https://example.test");
		expect(options.userName).toBeUndefined();
	});

	it("selects the active AgentPhone number for the configured agent", () => {
		const selected = __test__.selectAgentPhoneNumber({
			agentId: "agent_123",
			numbers: [
				{
					id: "num_1",
					phoneNumber: "+15550000001",
					status: "inactive",
					agentId: "agent_123",
				},
				{
					id: "num_2",
					phoneNumber: "+15550000002",
					status: "active",
					type: "sms",
					agentId: "agent_123",
				},
				{
					id: "num_3",
					phoneNumber: "+15550000003",
					status: "active",
					agentId: "other_agent",
				},
			],
		});

		expect(selected).toMatchObject({
			id: "num_2",
			phoneNumber: "+15550000002",
		});
	});

	it("verifies the AgentPhone API key by fetching the agent number", async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({
				data: [
					{
						id: "cmpyckhh106qzf4t0ct7xxgye",
						phoneNumber: "+18166776225",
						country: "US",
						status: "active",
						type: "sms",
						agentId: "cmpyckevf06qxf4t0y3bl2c69",
						createdAt: "2026-06-03T17:35:29.654000Z",
					},
				],
				hasMore: false,
				total: 1,
			}),
		);

		const number = await __test__.fetchAgentPhoneNumber({
			apiKey: "agentphone-key",
			agentId: "cmpyckevf06qxf4t0y3bl2c69",
			apiUrl: "https://api.agentphone.ai/",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		expect(fetchImpl).toHaveBeenCalledWith(
			"https://api.agentphone.ai/v1/numbers",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer agentphone-key",
				}),
			}),
		);
		expect(number).toMatchObject({
			id: "cmpyckhh106qzf4t0ct7xxgye",
			phoneNumber: "+18166776225",
			type: "sms",
		});
	});

	it("fails AgentPhone verification when no active number is assigned", async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({
				data: [
					{
						id: "num_1",
						phoneNumber: "+15550000001",
						status: "active",
						agentId: "other_agent",
					},
				],
			}),
		);

		await expect(
			__test__.fetchAgentPhoneNumber({
				apiKey: "agentphone-key",
				agentId: "agent_123",
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toThrow(
			"AgentPhone API verification failed: no phone number is assigned to agent agent_123.",
		);
	});

	it("resolves inbound SMS participants from contact data", () => {
		const participant = __test__.resolveAgentPhoneParticipant({
			messageId: "msg_123",
			conversationId: "conv_123",
			numberId: "num_123",
			from: "+15551234567",
			to: "+15557654321",
			contact: {
				id: "contact_123",
				name: "Alice",
				email: null,
				phoneNumber: "+15551234567",
			},
			message: "hello",
			mediaUrl: null,
			mediaUrls: [],
			direction: "inbound",
			receivedAt: "2026-03-17T00:00:00.000Z",
		});

		expect(participant).toEqual({
			key: "agentphone:user:+15551234567",
			label: "Alice",
		});
	});

	it("normalizes iMessage email participants", () => {
		const participant = __test__.resolveAgentPhoneParticipant({
			messageId: "msg_123",
			conversationId: "conv_123",
			numberId: "num_123",
			from: "Alice@Example.COM",
			to: "bot@example.com",
			contact: null,
			message: "hello",
			mediaUrl: null,
			mediaUrls: [],
			direction: "inbound",
			receivedAt: "2026-03-17T00:00:00.000Z",
		});

		expect(participant?.key).toBe("agentphone:user:alice@example.com");
	});

	it("resolves inbound SMS message payloads into synchronous webhook turns", () => {
		const turn = __test__.resolveAgentPhoneMessageTurnPayload({
			event: "agent.message",
			channel: "sms",
			timestamp: "2026-06-03T19:19:06.000Z",
			agentId: "agent_123",
			data: {
				messageId: "msg_123",
				conversationId: "conv_123",
				numberId: "num_123",
				from: "+15551234567",
				to: "+15557654321",
				contact: null,
				message: "Can Cline help?",
				mediaUrl: null,
				mediaUrls: [],
				direction: "inbound",
				receivedAt: "2026-06-03T19:19:06.000Z",
			},
		});

		expect(turn).toMatchObject({
			threadId: "agentphone:+15557654321:+15551234567",
			text: "Can Cline help?",
			rawMessage: {
				messageId: "msg_123",
				conversationId: "conv_123",
				from: "+15551234567",
				to: "+15557654321",
				message: "Can Cline help?",
				direction: "inbound",
			},
		});
	});

	it("formats AgentPhone request errors for webhook responses", () => {
		expect(
			__test__.formatAgentPhoneRequestError(
				new Error(
					"Auth failed: Outbound SMS is not enabled for this account. Complete 10DLC registration first.",
				),
			),
		).toBe(
			"Request failed. Outbound SMS is not enabled for this account. Complete 10DLC registration first.",
		);
	});

	it("returns JSON acknowledgements for non-JSON AgentPhone adapter responses", async () => {
		const response = await __test__.normalizeAgentPhoneWebhookResponse({
			response: new Response("OK", { status: 200 }),
			payload: {
				event: "agent.message",
				channel: "sms",
			},
		});

		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("posts non-voice AgentPhone replies through the thread", async () => {
		const post = vi.fn(async () => undefined);
		const logger = {
			core: {
				log: vi.fn(),
				error: vi.fn(),
			},
		};
		const io = { writeln: vi.fn() };

		await __test__.postAgentPhoneReply({
			thread: {
				id: "agentphone:+15557654321:+15551234567",
				channelId: "agentphone:+15557654321",
				post,
			} as unknown as Parameters<
				typeof __test__.postAgentPhoneReply
			>[0]["thread"],
			text: "  hello from cline  ",
			logger: logger as unknown as Parameters<
				typeof __test__.postAgentPhoneReply
			>[0]["logger"],
			io: io as unknown as Parameters<
				typeof __test__.postAgentPhoneReply
			>[0]["io"],
		});

		expect(post).toHaveBeenCalledWith("hello from cline");
		expect(logger.core.log).toHaveBeenCalledWith(
			"AgentPhone outbound reply sent",
			expect.objectContaining({
				outputLength: "hello from cline".length,
			}),
		);
		expect(logger.core.error).not.toHaveBeenCalled();
	});

	it("surfaces outbound AgentPhone reply send failures", async () => {
		const error = new Error("AgentPhone API rejected the message");
		const post = vi.fn(async () => {
			throw error;
		});
		const logger = {
			core: {
				log: vi.fn(),
				error: vi.fn(),
			},
		};
		const io = { writeln: vi.fn() };

		await expect(
			__test__.postAgentPhoneReply({
				thread: {
					id: "agentphone:+15557654321:+15551234567",
					channelId: "agentphone:+15557654321",
					post,
				} as unknown as Parameters<
					typeof __test__.postAgentPhoneReply
				>[0]["thread"],
				text: "hello from cline",
				logger: logger as unknown as Parameters<
					typeof __test__.postAgentPhoneReply
				>[0]["logger"],
				io: io as unknown as Parameters<
					typeof __test__.postAgentPhoneReply
				>[0]["io"],
			}),
		).rejects.toThrow("AgentPhone API rejected the message");

		expect(logger.core.error).toHaveBeenCalledWith(
			"AgentPhone outbound reply failed",
			expect.objectContaining({
				error,
			}),
		);
	});

	it("returns voice text for non-JSON voice webhook responses", async () => {
		const response = await __test__.normalizeAgentPhoneWebhookResponse({
			response: new Response("OK", { status: 200 }),
			payload: {
				event: "agent.message",
				channel: "voice",
			},
		});

		await expect(response.json()).resolves.toEqual({
			text: "Cline is connected. I will process the call transcript when this call ends.",
		});
	});

	it("preserves non-OK webhook response status as JSON", async () => {
		const response = await __test__.normalizeAgentPhoneWebhookResponse({
			response: new Response("Invalid signature", { status: 401 }),
			payload: undefined,
		});

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({
			error: "Invalid signature",
		});
	});

	it("streams interim and final voice responses as NDJSON", async () => {
		const response = __test__.agentPhoneVoiceResponse(
			async () => "The answer is 42.",
		);

		expect(response.headers.get("content-type")).toContain(
			"application/x-ndjson",
		);
		const lines = (await response.text())
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as unknown);
		expect(lines).toEqual([
			{ text: "One moment, let me check.", interim: true },
			{ text: "The answer is 42." },
		]);
	});

	it("resolves AgentPhone live voice message payloads into turn input", () => {
		const turn = __test__.resolveAgentPhoneVoiceTurnPayload({
			event: "agent.message",
			channel: "voice",
			timestamp: "2026-06-03T19:19:06.000Z",
			agentId: "agent_123",
			data: {
				conversationId: "conv_123",
				from: "+15551234567",
				to: "+15557654321",
				message: "What is my order status?",
				direction: "inbound",
				receivedAt: "2026-06-03T19:19:06.000Z",
			},
		});

		expect(turn).toMatchObject({
			threadId: "agentphone:+15557654321:+15551234567",
			text: "What is my order status?",
			rawMessage: {
				conversationId: "conv_123",
				from: "+15551234567",
				to: "+15557654321",
				message: "What is my order status?",
				direction: "inbound",
			},
		});
	});

	it("classifies voice lifecycle webhooks separately from voice message turns", () => {
		expect(
			__test__.isAgentPhoneVoiceMessagePayload({
				event: "agent.call.started",
				channel: "voice",
				data: {},
			}),
		).toBe(false);
		expect(
			__test__.resolveAgentPhoneVoiceTurnPayload({
				event: "agent.call.started",
				channel: "voice",
				data: {},
			}),
		).toBeUndefined();
	});

	it("verifies AgentPhone webhook signatures against the raw body", () => {
		const rawBody = JSON.stringify({ event: "agent.message" });
		const secret = "whsec_test";
		const signature = `sha256=${createHmac("sha256", secret)
			.update(rawBody)
			.digest("hex")}`;

		expect(
			__test__.verifyAgentPhoneWebhookSignature({
				rawBody,
				secret,
				signature,
			}),
		).toBe(true);
		expect(
			__test__.verifyAgentPhoneWebhookSignature({
				rawBody,
				secret,
				signature: "sha256=bad",
			}),
		).toBe(false);
	});

	it("rejects AgentPhone webhook signatures when no secret is configured", () => {
		expect(
			__test__.verifyAgentPhoneWebhookSignature({
				rawBody: JSON.stringify({ event: "agent.message" }),
				secret: undefined,
				signature: "sha256=abcd",
			}),
		).toBe(false);
	});
});

describe("agentphone binding lookup", () => {
	it("reuses a binding by participant key across different threads", () => {
		const result = __test__.findBindingForThread(
			{
				"agentphone:user:+15551234567": {
					channelId: "agentphone:+15557654321",
					isDM: true,
					participantKey: "agentphone:user:+15551234567",
					participantLabel: "Alice",
					serializedThread: "{}",
					sessionId: "sess-1",
					state: {
						sessionId: "sess-1",
						participantKey: "agentphone:user:+15551234567",
						participantLabel: "Alice",
					},
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "agentphone:+15557654321:+15551234567",
				channelId: "agentphone:+15557654321",
				isDM: true,
				participantKey: "agentphone:user:+15551234567",
			},
		);

		expect(result?.key).toBe("agentphone:user:+15551234567");
		expect(result?.binding.sessionId).toBe("sess-1");
	});
});
