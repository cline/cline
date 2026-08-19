/**
 * Outbound connector messaging (Gateway RFC, Phase 6): automatic replies
 * for completed connector runs (and ONLY completed ones), the persisted
 * outbound store with idempotency keys, delivery supervision with
 * transient backoff vs. permanent failures, crash recovery without
 * duplicates, platform message-length splitting, proactive-send
 * authorization and rate limits, and schedule notifications.
 */

import type { ConnectorReplyPort } from "@cline/bot";
import { createGatewayInstanceId, createRunId } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { openGatewayDatabase } from "../db";
import { ensureGatewayDataDir, resolveGatewayPaths } from "../paths";
import { GatewayRuntime } from "../runtime";
import { Scheduler } from "../schedules/scheduler";
import { createGatewayStores } from "../stores";
import { ScriptedEnginePort, tempDataRoot, waitFor } from "../test-support";
import type {
	ConnectorAdapter,
	ConnectorAdapterContext,
	ConnectorCredentialCheck,
} from "./adapter";
import { ConnectorDeliveryError } from "./adapter";
import { OutboundDeliveryWorker, splitMessageForPlatform } from "./delivery";
import { ConnectorMessenger, ProactiveSendRejectedError } from "./messenger";
import { ConnectorScopeViolationError } from "./store";
import { createSendConnectorMessageTool } from "./tool";

/** Delivery-only fake adapter with scriptable reply outcomes. */
class FakeDeliveryAdapter implements ConnectorAdapter {
	readonly kind = "scripted";
	maxMessageLength = 1_000;
	readonly replies: { conversation: string; text: string }[] = [];
	/** Errors thrown by upcoming reply calls (shifted per call). */
	readonly failures: (ConnectorDeliveryError | Error)[] = [];
	credentialCheck: ConnectorCredentialCheck = { ok: true, detail: "fake" };
	lastCredential: string | undefined;

	async run(context: ConnectorAdapterContext): Promise<void> {
		await new Promise<void>((resolve) => {
			context.signal.addEventListener("abort", () => resolve());
		});
	}

	createReplyPort(
		_config: Readonly<Record<string, unknown>>,
		credential: string | undefined,
	): ConnectorReplyPort {
		this.lastCredential = credential;
		return {
			reply: async (conversation, text) => {
				if (!credential) {
					throw new ConnectorDeliveryError("no credential configured", {
						retryable: false,
					});
				}
				const failure = this.failures.shift();
				if (failure) {
					throw failure;
				}
				this.replies.push({
					conversation: conversation.externalConversationId,
					text,
				});
				return { externalMessageIds: [`msg-${this.replies.length}`] };
			},
		};
	}

	async testCredentials(): Promise<ConnectorCredentialCheck> {
		return this.credentialCheck;
	}
}

function createHarness(
	options: {
		autoOutcome?: ConstructorParameters<typeof ScriptedEnginePort> extends never
			? never
			: (input: string) => Partial<{
					status: "completed" | "failed" | "aborted" | "interrupted";
					outputText: string;
				}>;
		credential?: string | null;
		rateLimit?: { max: number; windowMs: number };
		maxAttempts?: number;
	} = {},
) {
	const dataRoot = tempDataRoot();
	const paths = resolveGatewayPaths({ dataRoot, namespace: "default" });
	ensureGatewayDataDir(paths);
	const database = openGatewayDatabase(paths.databaseFile);
	const instanceId = createGatewayInstanceId();
	const stores = createGatewayStores(database, instanceId);
	const engine = new ScriptedEnginePort();
	engine.autoOutcome = (invocation) =>
		options.autoOutcome?.(invocation.input) ?? {
			outputText: `answer to: ${invocation.input}`,
		};
	let now = 1_000_000;
	const clock = { now: () => now };
	const runtime = new GatewayRuntime({
		database,
		stores,
		paths,
		instanceId,
		engine,
		clock,
	});
	runtime.bootstrap();
	const botId = runtime.defaultBotId;
	if (!botId) {
		throw new Error("bootstrap failed");
	}
	const adapter = new FakeDeliveryAdapter();
	const credential =
		options.credential === null ? undefined : (options.credential ?? "tok-123");
	const worker = new OutboundDeliveryWorker({
		database,
		stores,
		adapters: { scripted: adapter },
		readCredential: credential ? () => credential : undefined,
		instanceId,
		clock: () => now,
		claimTtlMs: 5_000,
		maxAttempts: options.maxAttempts ?? 3,
		backoff: { baseMs: 100, maxMs: 1_000 },
		tickIntervalMs: 0,
	});
	const messenger = new ConnectorMessenger({
		database,
		stores,
		approvals: () => runtime.approvals,
		clock: () => now,
		proactiveRateLimit: options.rateLimit,
	});
	runtime.onRunTerminal((record) => messenger.handleRunTerminal(record));
	const connector = runtime.registerConnector("test", {
		botId,
		kind: "scripted",
		name: "scripted",
		credentialRef: "scripted-token",
	});
	const submitInbound = (conversation: string, text: string) =>
		runtime.startConnectorRun({
			botId,
			prompt: text,
			connectorId: connector.connectorId,
			externalAccountId: "acct-1",
			externalConversationId: conversation,
			sessionId: stores.connectorRoutes.get(
				connector.connectorId,
				"acct-1",
				conversation,
			)?.sessionId,
		});
	const recordRoute = (
		conversation: string,
		sessionId: ReturnType<typeof submitInbound>["sessionId"],
	) =>
		stores.connectorRoutes.save({
			connectorId: connector.connectorId,
			externalAccountId: "acct-1",
			externalConversationId: conversation,
			botId,
			sessionId,
			createdAt: now,
		});
	return {
		database,
		stores,
		runtime,
		engine,
		adapter,
		worker,
		messenger,
		connector,
		botId,
		instanceId,
		submitInbound,
		recordRoute,
		advance: (ms: number) => {
			now += ms;
			return now;
		},
		now: () => now,
	};
}

describe("automatic run replies", () => {
	it("replies once to the originating conversation after a successful run", async () => {
		const h = createHarness();
		const accepted = h.submitInbound("conv-1", "what is 2+2?");
		h.recordRoute("conv-1", accepted.sessionId);
		await waitFor(
			() => h.stores.runs.get(accepted.runId)?.state === "completed",
		);
		// The settlement enqueued exactly one pending outbound reply.
		const pending = h.stores.connectorOutbound.list({ state: "pending" });
		expect(pending).toHaveLength(1);
		expect(pending[0].origin).toBe("run-reply");
		expect(pending[0].originRunId).toBe(accepted.runId);
		expect(pending[0].idempotencyKey).toBe(`run-reply:${accepted.runId}`);

		const report = await h.worker.tick();
		expect(report.delivered).toBe(1);
		expect(h.adapter.replies).toEqual([
			{ conversation: "conv-1", text: "answer to: what is 2+2?" },
		]);
		const delivered = h.stores.connectorOutbound.get(pending[0].outboundId);
		expect(delivered?.state).toBe("delivered");
		expect(delivered?.externalMessageIds).toEqual(["msg-1"]);
		expect(delivered?.deliveredAt).toBeDefined();

		// A second tick delivers nothing: exactly once.
		expect((await h.worker.tick()).delivered).toBe(0);
		expect(h.adapter.replies).toHaveLength(1);
	});

	it("never sends failed, aborted, or interrupted run output as a reply", async () => {
		for (const status of ["failed", "aborted", "interrupted"] as const) {
			const h = createHarness({
				autoOutcome: () => ({
					status,
					outputText: "partial output that must not leak",
				}),
			});
			const accepted = h.submitInbound("conv-1", "do something");
			h.recordRoute("conv-1", accepted.sessionId);
			await waitFor(() => h.stores.runs.get(accepted.runId)?.state === status);
			await h.worker.tick();
			expect(
				h.stores.connectorOutbound.list({}),
				`${status} runs must not reply`,
			).toHaveLength(0);
			expect(h.adapter.replies).toHaveLength(0);
		}
	});

	it("survives re-settlement/crash replay without duplicate replies", async () => {
		const h = createHarness();
		const accepted = h.submitInbound("conv-1", "hello");
		h.recordRoute("conv-1", accepted.sessionId);
		await waitFor(
			() => h.stores.runs.get(accepted.runId)?.state === "completed",
		);
		// Crash replay: the terminal hook fires again for the same run.
		const record = h.stores.runs.get(accepted.runId);
		if (!record) {
			throw new Error("run vanished");
		}
		h.messenger.handleRunTerminal(record);
		h.messenger.handleRunTerminal(record);
		expect(h.stores.connectorOutbound.list({})).toHaveLength(1);
		await h.worker.tick();
		expect(h.adapter.replies).toHaveLength(1);
	});
});

describe("delivery supervision", () => {
	it("retries transient failures with backoff, without rerunning the model", async () => {
		const h = createHarness();
		const accepted = h.submitInbound("conv-1", "flaky");
		h.recordRoute("conv-1", accepted.sessionId);
		await waitFor(
			() => h.stores.runs.get(accepted.runId)?.state === "completed",
		);
		const attemptsBefore = h.engine.handles.length;
		h.adapter.failures.push(
			new ConnectorDeliveryError("HTTP 429", { retryable: true }),
			new ConnectorDeliveryError("HTTP 503", { retryable: true }),
		);
		// First attempt fails transiently and reschedules with backoff.
		let report = await h.worker.tick();
		expect(report.retried).toBe(1);
		const outbound = h.stores.connectorOutbound.list({})[0];
		expect(outbound.state).toBe("pending");
		expect(outbound.nextAttemptAt).toBeGreaterThan(h.now());
		// Not due yet: nothing claimed.
		expect((await h.worker.tick()).claimed).toBe(0);
		// Second attempt (after backoff) fails again → longer backoff.
		h.advance(150);
		report = await h.worker.tick();
		expect(report.retried).toBe(1);
		// Third attempt succeeds.
		h.advance(1_100);
		report = await h.worker.tick();
		expect(report.delivered).toBe(1);
		expect(h.adapter.replies).toHaveLength(1);
		// The model never reran: no new engine executions.
		expect(h.engine.handles.length).toBe(attemptsBefore);
	});

	it("exhausts bounded transient retries into a failed state", async () => {
		const h = createHarness({ maxAttempts: 2 });
		const accepted = h.submitInbound("conv-1", "never works");
		h.recordRoute("conv-1", accepted.sessionId);
		await waitFor(
			() => h.stores.runs.get(accepted.runId)?.state === "completed",
		);
		h.adapter.failures.push(
			new ConnectorDeliveryError("HTTP 500", { retryable: true }),
			new ConnectorDeliveryError("HTTP 500", { retryable: true }),
		);
		await h.worker.tick();
		h.advance(200);
		const final = await h.worker.tick();
		expect(final.failed).toBe(1);
		const outbound = h.stores.connectorOutbound.list({})[0];
		expect(outbound.state).toBe("failed");
		expect(outbound.lastError).toContain("Retries exhausted");
	});

	it("settles permanent failures (revoked credential) immediately", async () => {
		const h = createHarness();
		const accepted = h.submitInbound("conv-1", "auth problem");
		h.recordRoute("conv-1", accepted.sessionId);
		await waitFor(
			() => h.stores.runs.get(accepted.runId)?.state === "completed",
		);
		h.adapter.failures.push(
			new ConnectorDeliveryError("HTTP 401", { retryable: false }),
		);
		const report = await h.worker.tick();
		expect(report.failed).toBe(1);
		const outbound = h.stores.connectorOutbound.list({})[0];
		expect(outbound.state).toBe("failed");
		expect(outbound.attempts).toBe(1);
		// Never retried afterwards.
		h.advance(10_000);
		expect((await h.worker.tick()).claimed).toBe(0);
	});

	it("fails permanently when the credential is missing", async () => {
		const h = createHarness({ credential: null });
		const accepted = h.submitInbound("conv-1", "no credential");
		h.recordRoute("conv-1", accepted.sessionId);
		await waitFor(
			() => h.stores.runs.get(accepted.runId)?.state === "completed",
		);
		const report = await h.worker.tick();
		expect(report.failed).toBe(1);
		expect(h.stores.connectorOutbound.list({})[0].lastError).toContain(
			"no credential",
		);
	});

	it("resumes pending deliveries after a restart without duplicates", async () => {
		const h = createHarness();
		const accepted = h.submitInbound("conv-1", "restart me");
		h.recordRoute("conv-1", accepted.sessionId);
		await waitFor(
			() => h.stores.runs.get(accepted.runId)?.state === "completed",
		);
		// Instance A claims the message, then "crashes" before delivering.
		const outbound = h.stores.connectorOutbound.list({})[0];
		expect(
			h.stores.connectorOutbound.claim(
				outbound.outboundId,
				"gwi_deadinstance00",
				h.now(),
				5_000,
			),
		).toBe(true);
		// A fresh worker (new Gateway instance) cannot steal a LIVE claim...
		expect((await h.worker.tick()).claimed).toBe(0);
		// ...but takes over once the claim expires, delivering exactly once.
		h.advance(6_000);
		const report = await h.worker.tick();
		expect(report.delivered).toBe(1);
		expect(h.adapter.replies).toHaveLength(1);
		expect((await h.worker.tick()).claimed).toBe(0);
	});
});

describe("platform message limits", () => {
	it("splits long content preferring newline boundaries", () => {
		const chunks = splitMessageForPlatform(
			`${"a".repeat(90)}\n${"b".repeat(90)}`,
			100,
		);
		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toBe("a".repeat(90));
		expect(chunks[1]).toBe("b".repeat(90));
		// Hard-splits content without any boundary.
		const hard = splitMessageForPlatform("x".repeat(250), 100);
		expect(hard.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
		// Telegram/Slack limits are respected end-to-end below.
		expect(
			splitMessageForPlatform("y".repeat(5_000), 4_096).every(
				(chunk) => chunk.length <= 4_096,
			),
		).toBe(true);
	});

	it("delivers oversized replies as multiple platform messages", async () => {
		const h = createHarness({
			autoOutcome: () => ({ outputText: "z".repeat(2_500) }),
		});
		h.adapter.maxMessageLength = 1_000;
		const accepted = h.submitInbound("conv-1", "long answer please");
		h.recordRoute("conv-1", accepted.sessionId);
		await waitFor(
			() => h.stores.runs.get(accepted.runId)?.state === "completed",
		);
		const report = await h.worker.tick();
		expect(report.delivered).toBe(1);
		expect(h.adapter.replies).toHaveLength(3);
		expect(h.adapter.replies.every((reply) => reply.text.length <= 1_000)).toBe(
			true,
		);
		// All platform message ids are recorded on the one outbound record.
		expect(
			h.stores.connectorOutbound.list({})[0].externalMessageIds,
		).toHaveLength(3);
	});
});

describe("proactive sends (send_connector_message)", () => {
	async function connectorRun(h: ReturnType<typeof createHarness>) {
		const accepted = h.submitInbound("conv-1", "origin message");
		h.recordRoute("conv-1", accepted.sessionId);
		await waitFor(
			() => h.stores.runs.get(accepted.runId)?.state === "completed",
		);
		return accepted;
	}

	it("defaults to the originating conversation and reports delivery status", async () => {
		const h = createHarness();
		const accepted = await connectorRun(h);
		const tool = createSendConnectorMessageTool(
			{ botId: h.botId, runId: accepted.runId },
			{ messenger: h.messenger, deliveryWorker: h.worker },
		);
		const output = await tool.execute(
			{ text: "progress: halfway there" },
			{ agentId: h.botId, iteration: 1, toolCallId: "call_1" },
		);
		expect(output.state).toBe("delivered");
		expect(output.created).toBe(true);
		expect(output.externalMessageIds).toBeDefined();
		expect(
			h.adapter.replies.some(
				(reply) =>
					reply.conversation === "conv-1" &&
					reply.text === "progress: halfway there",
			),
		).toBe(true);
		// The tool result never carries credentials.
		expect(JSON.stringify(output)).not.toContain("tok-123");
	});

	it("is idempotent per tool call key", async () => {
		const h = createHarness();
		const accepted = await connectorRun(h);
		const tool = createSendConnectorMessageTool(
			{ botId: h.botId, runId: accepted.runId },
			{ messenger: h.messenger, deliveryWorker: h.worker },
		);
		const context = { agentId: h.botId, iteration: 1, toolCallId: "call_x" };
		const first = await tool.execute({ text: "once" }, context);
		const second = await tool.execute({ text: "once" }, context);
		expect(second.created).toBe(false);
		expect(second.outboundId).toBe(first.outboundId);
		expect(
			h.adapter.replies.filter((reply) => reply.text === "once"),
		).toHaveLength(1);
	});

	it("rejects proactive sends without any destination", async () => {
		const h = createHarness();
		// An interactive (non-connector) run has no originating conversation.
		const interactive = h.runtime.startRun("cli", {
			botId: h.botId,
			prompt: "desktop run",
		});
		await waitFor(
			() => h.stores.runs.get(interactive.runId)?.state === "completed",
		);
		await expect(
			h.messenger.sendProactive({
				botId: h.botId,
				originRunId: interactive.runId,
				text: "to whom?",
				idempotencyKey: "p1",
				requestedBy: "test",
			}),
		).rejects.toThrow(ProactiveSendRejectedError);
	});

	it("refuses destinations on another bot's connector", async () => {
		const h = createHarness();
		const accepted = await connectorRun(h);
		const otherBot = h.runtime.delegateBot("test", {
			parentBotId: h.botId,
			name: "other",
			role: "worker",
		});
		const foreign = h.runtime.registerConnector("test", {
			botId: otherBot.identity.botId,
			kind: "scripted",
			name: "foreign",
		});
		await expect(
			h.messenger.sendProactive({
				botId: h.botId,
				originRunId: accepted.runId,
				text: "cross-bot",
				destination: {
					connectorId: foreign.connectorId,
					externalConversationId: "conv-x",
					externalAccountId: "acct-x",
				},
				idempotencyKey: "p2",
				requestedBy: "test",
			}),
		).rejects.toThrow(ConnectorScopeViolationError);
	});

	it("requires approval for unrelated destinations and honors denial", async () => {
		const h = createHarness();
		const accepted = await connectorRun(h);
		// Another known conversation of the SAME bot (unrelated to the run).
		const other = h.submitInbound("conv-2", "other conversation");
		h.recordRoute("conv-2", other.sessionId);
		await waitFor(() => h.stores.runs.get(other.runId)?.state === "completed");

		// Denied approval → rejected.
		const denied = h.messenger.sendProactive({
			botId: h.botId,
			originRunId: accepted.runId,
			text: "cross-conversation",
			destination: {
				connectorId: h.connector.connectorId,
				externalConversationId: "conv-2",
			},
			idempotencyKey: "p3",
			requestedBy: "test",
		});
		await waitFor(() => h.runtime.approvals.pendingCount === 1);
		const pending = h.runtime.approvals.pendingForScope({});
		expect(pending[0].method).toBe("connector.sendApproval");
		h.runtime.approvals.respond(pending[0].id, { approved: false });
		await expect(denied).rejects.toThrow(/not approved/);

		// Granted approval → enqueued to the unrelated conversation.
		const granted = h.messenger.sendProactive({
			botId: h.botId,
			originRunId: accepted.runId,
			text: "cross-conversation",
			destination: {
				connectorId: h.connector.connectorId,
				externalConversationId: "conv-2",
			},
			idempotencyKey: "p4",
			requestedBy: "test",
		});
		await waitFor(() => h.runtime.approvals.pendingCount === 1);
		const request = h.runtime.approvals.pendingForScope({})[0];
		h.runtime.approvals.respond(request.id, { approved: true });
		const { record } = await granted;
		expect(record.externalConversationId).toBe("conv-2");
	});

	it("enforces the per-conversation rate limit", async () => {
		const h = createHarness({ rateLimit: { max: 2, windowMs: 60_000 } });
		const accepted = await connectorRun(h);
		for (const key of ["r1", "r2"]) {
			await h.messenger.sendProactive({
				botId: h.botId,
				originRunId: accepted.runId,
				text: `ping ${key}`,
				idempotencyKey: key,
				requestedBy: "test",
			});
		}
		await expect(
			h.messenger.sendProactive({
				botId: h.botId,
				originRunId: accepted.runId,
				text: "one too many",
				idempotencyKey: "r3",
				requestedBy: "test",
			}),
		).rejects.toThrow(/rate limit/i);
		// The window slides: after it passes, sending resumes.
		h.advance(61_000);
		const { record } = await h.messenger.sendProactive({
			botId: h.botId,
			originRunId: accepted.runId,
			text: "later is fine",
			idempotencyKey: "r4",
			requestedBy: "test",
		});
		expect(record.state).toBe("pending");
	});
});

describe("schedule notifications", () => {
	it("delivers firing outcomes to the schedule's connector route", async () => {
		const h = createHarness();
		// A known conversation to notify.
		const seed = h.submitInbound("conv-9", "seed conversation");
		h.recordRoute("conv-9", seed.sessionId);
		await waitFor(() => h.stores.runs.get(seed.runId)?.state === "completed");
		// Flush the seed conversation's auto-reply so the assertions below
		// see only schedule-notification traffic.
		await h.worker.tick();
		const scheduler = new Scheduler({
			database: h.database,
			stores: h.stores,
			admitAutomationRun: (schedule) => h.runtime.startAutomationRun(schedule),
			notifyOutcome: (notification) => {
				if (!notification.schedule.notify) {
					return;
				}
				h.messenger.notify({
					botId: notification.schedule.botId,
					connectorId: notification.schedule.notify.connectorId,
					externalAccountId: notification.schedule.notify.externalAccountId,
					externalConversationId:
						notification.schedule.notify.externalConversationId,
					text: `[schedule:${notification.schedule.name}] ${notification.summary}`,
					origin: "schedule",
					originScheduleId: notification.schedule.scheduleId,
					idempotencyKey: `schedule-notify:${notification.schedule.scheduleId}:${notification.jobId}:${notification.state}`,
				});
			},
			instanceId: h.instanceId,
			clock: h.now,
			tickIntervalMs: 0,
		});
		const schedule = h.runtime.createSchedule("test", {
			botId: h.botId,
			name: "daily-summary",
			prompt: "summarize the day",
			intervalMs: 60_000,
			notify: {
				connectorId: h.connector.connectorId,
				externalAccountId: "acct-1",
				externalConversationId: "conv-9",
			},
		});
		h.advance(61_000);
		scheduler.tick(); // materialize + claim + admit
		const job = h.stores.scheduleJobs.report(schedule.scheduleId)[0];
		if (!job.runId) {
			throw new Error("no run admitted");
		}
		const runId = job.runId;
		await waitFor(() => h.stores.runs.get(runId)?.state === "completed");
		scheduler.tick(); // settle + notify
		const outbound = h.stores.connectorOutbound.list({ state: "pending" });
		expect(outbound).toHaveLength(1);
		expect(outbound[0].origin).toBe("schedule");
		expect(outbound[0].originScheduleId).toBe(schedule.scheduleId);
		// Repeated settles never duplicate the notification.
		scheduler.tick();
		expect(
			h.stores.connectorOutbound
				.list({})
				.filter((message) => message.origin === "schedule"),
		).toHaveLength(1);
		await h.worker.tick();
		expect(
			h.adapter.replies.some(
				(reply) =>
					reply.conversation === "conv-9" &&
					reply.text.startsWith("[schedule:daily-summary]"),
			),
		).toBe(true);
	});

	it("rejects notify targets on connectors of other bots", () => {
		const h = createHarness();
		const otherBot = h.runtime.delegateBot("test", {
			parentBotId: h.botId,
			name: "other",
			role: "worker",
		});
		const foreign = h.runtime.registerConnector("test", {
			botId: otherBot.identity.botId,
			kind: "scripted",
			name: "foreign",
		});
		expect(() =>
			h.runtime.createSchedule("test", {
				botId: h.botId,
				name: "sneaky",
				prompt: "x",
				intervalMs: 1_000,
				notify: {
					connectorId: foreign.connectorId,
					externalAccountId: "a",
					externalConversationId: "c",
				},
			}),
		).toThrow(/does not belong to bot/);
	});
});

describe("outbound store durability", () => {
	it("dedupes by idempotency key at the store level", () => {
		const h = createHarness();
		const params = {
			botId: h.botId,
			connectorId: h.connector.connectorId,
			externalAccountId: "acct-1",
			externalConversationId: "conv-1",
			origin: "event" as const,
			idempotencyKey: "same-key",
			content: "hello",
		};
		const first = h.stores.connectorOutbound.enqueue(params, h.now());
		const second = h.stores.connectorOutbound.enqueue(params, h.now());
		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
		expect(second.record.outboundId).toBe(first.record.outboundId);
	});

	it("records the full durable surface on delivery", async () => {
		const h = createHarness();
		const enqueued = h.messenger.notify({
			botId: h.botId,
			connectorId: h.connector.connectorId,
			externalAccountId: "acct-1",
			externalConversationId: "conv-1",
			text: "notification",
			origin: "event",
			originRunId: createRunId(),
			idempotencyKey: "surface-check",
		});
		await h.worker.tick();
		const record = h.stores.connectorOutbound.get(enqueued.record.outboundId);
		expect(record).toMatchObject({
			botId: h.botId,
			connectorId: h.connector.connectorId,
			externalConversationId: "conv-1",
			idempotencyKey: "surface-check",
			state: "delivered",
			attempts: 1,
		});
		expect(record?.createdAt).toBeDefined();
		expect(record?.lastAttemptAt).toBeDefined();
		expect(record?.deliveredAt).toBeDefined();
		expect(record?.externalMessageIds).toHaveLength(1);
	});
});
