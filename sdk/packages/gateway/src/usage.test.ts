/**
 * Usage/statistics pipeline: WAL mode, one transaction for event +
 * aggregates, estimate flagging and price snapshots, recalculation
 * without mutating original events, streaks, and bounded aggregate-only
 * queries (summaries never rescan history tables).
 */

import { join } from "node:path";
import {
	createBotId,
	createRunId,
	createSessionId,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { openGatewayDatabase } from "./db";
import { tempDataRoot } from "./test-support";
import {
	MAX_STATISTICS_RANGE_DAYS,
	type NormalizedModelCall,
	type PriceResolver,
	UsageQueryError,
	UsageStore,
	utcDateOf,
} from "./usage";

const DAY_MS = 86_400_000;
const T0 = Date.parse("2026-08-10T12:00:00.000Z");

function openUsage(options: { prices?: PriceResolver; nowMs?: number } = {}) {
	const database = openGatewayDatabase(join(tempDataRoot(), "gateway.db"));
	const usage = new UsageStore(database, {
		prices: options.prices,
		now: () => options.nowMs ?? T0,
	});
	return { database, usage };
}

function call(
	overrides: Partial<NormalizedModelCall> = {},
): NormalizedModelCall {
	return {
		occurredAt: T0,
		botId: createBotId(),
		sessionId: createSessionId(),
		runId: createRunId(),
		providerId: "anthropic",
		modelId: "claude-x",
		inputTokens: 100,
		outputTokens: 40,
		status: "ok",
		...overrides,
	};
}

const FLAT_PRICES: PriceResolver = () => ({
	inputPerMTokens: 10,
	outputPerMTokens: 30,
	currency: "USD",
	source: "test-catalog-v1",
});

describe("storage mode", () => {
	it("runs in WAL mode with the usage indexes in place", () => {
		const { database } = openUsage();
		const mode = database.db.prepare("PRAGMA journal_mode;").get();
		expect(String(Object.values(mode ?? {})[0]).toLowerCase()).toBe("wal");
		const indexes = database.db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'usage_events';",
			)
			.all()
			.map((row) => String(row.name));
		expect(indexes).toEqual(
			expect.arrayContaining([
				"idx_usage_events_bot",
				"idx_usage_events_model",
				"idx_usage_events_topic",
			]),
		);
	});
});

describe("write path", () => {
	it("one model call writes one usage_event and bumps every aggregate", () => {
		const { database, usage } = openUsage({ prices: FLAT_PRICES });
		const botId = createBotId();
		const sessionId = createSessionId();
		database.transaction(() => {
			usage.recordModelCall(
				call({ botId, sessionId, inputTokens: 1000, outputTokens: 500 }),
			);
		});
		const date = utcDateOf(T0);

		const events = database.db.prepare("SELECT * FROM usage_events;").all();
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			bot_id: botId,
			session_id: sessionId,
			agent_id: botId, // documented mapping: agent := bot
			topic_id: sessionId, // documented mapping: topic := session
			input_tokens: 1000,
			output_tokens: 500,
			total_tokens: 1500,
			status: "ok",
		});

		const daily = database.db.prepare("SELECT * FROM daily_usage;").all();
		expect(daily).toHaveLength(1);
		expect(daily[0]).toMatchObject({
			date,
			bot_id: botId,
			tokens: 1500,
			model_calls: 1,
			active_sessions: 1,
		});
		expect(
			database.db.prepare("SELECT * FROM model_usage;").all()[0],
		).toMatchObject({
			date,
			model_id: "claude-x",
			provider_id: "anthropic",
			messages: 1,
			tokens: 1500,
		});
		expect(
			database.db.prepare("SELECT * FROM agent_usage;").all()[0],
		).toMatchObject({ date, agent_id: botId, tokens: 1500 });
		expect(
			database.db.prepare("SELECT * FROM topic_usage;").all()[0],
		).toMatchObject({ date, topic_id: sessionId, tokens: 1500 });
		expect(
			database.db.prepare("SELECT * FROM streak_usage;").all()[0],
		).toMatchObject({ date, active: 1 });
	});

	it("the event and its aggregates commit or roll back together", () => {
		const { database, usage } = openUsage({ prices: FLAT_PRICES });
		expect(() =>
			database.transaction(() => {
				usage.recordModelCall(call({}));
				throw new Error("crash between event and commit");
			}),
		).toThrow("crash between event and commit");
		// Nothing partial survived: no event, no aggregate rows.
		for (const table of [
			"usage_events",
			"daily_usage",
			"model_usage",
			"agent_usage",
			"topic_usage",
			"streak_usage",
		]) {
			expect(
				database.db.prepare(`SELECT COUNT(*) AS n FROM ${table};`).get()?.n,
			).toBe(0);
		}
	});

	it("counts distinct sessions incrementally and messages by role", () => {
		const { database, usage } = openUsage();
		const botId = createBotId();
		const sessionA = createSessionId();
		const sessionB = createSessionId();
		database.transaction(() => {
			usage.recordMessage({
				occurredAt: T0,
				botId,
				sessionId: sessionA,
				role: "user",
			});
			usage.recordMessage({
				occurredAt: T0,
				botId,
				sessionId: sessionA,
				role: "assistant",
			});
			usage.recordMessage({
				occurredAt: T0,
				botId,
				sessionId: sessionA,
				role: "tool",
			});
			usage.recordMessage({
				occurredAt: T0,
				botId,
				sessionId: sessionB,
				role: "user",
			});
		});
		const daily = database.db.prepare("SELECT * FROM daily_usage;").all()[0];
		// tool messages are not user/assistant traffic.
		expect(daily).toMatchObject({ messages: 3, active_sessions: 2 });
	});
});

describe("token and spend accuracy", () => {
	it("provider-reported cost is recorded verbatim and not flagged as estimate", () => {
		const { database, usage } = openUsage({ prices: FLAT_PRICES });
		const record = database.transaction(() =>
			usage.recordModelCall(call({ providerCost: 0.1234 })),
		);
		expect(record.estimatedCost).toBe(0.1234);
		expect(record.costIsEstimate).toBe(false);
		const row = database.db.prepare("SELECT * FROM usage_events;").get();
		expect(row).toMatchObject({ estimated_cost: 0.1234, cost_is_estimate: 0 });
	});

	it("resolver pricing produces a flagged estimate with the snapshot on the event", () => {
		const { database, usage } = openUsage({ prices: FLAT_PRICES });
		const record = database.transaction(() =>
			usage.recordModelCall(
				call({ inputTokens: 1_000_000, outputTokens: 100_000 }),
			),
		);
		// 1M input @ $10/M + 0.1M output @ $30/M = $13.
		expect(record.estimatedCost).toBeCloseTo(13, 10);
		expect(record.costIsEstimate).toBe(true);
		const row = database.db.prepare("SELECT * FROM usage_events;").get();
		expect(row?.cost_is_estimate).toBe(1);
		expect(JSON.parse(String(row?.price_snapshot_json))).toMatchObject({
			source: "test-catalog-v1",
			inputPerMTokens: 10,
		});
	});

	it("missing pricing stores a NULL flagged estimate, never a fake number", () => {
		const { database, usage } = openUsage();
		const record = database.transaction(() => usage.recordModelCall(call({})));
		expect(record.estimatedCost).toBeUndefined();
		expect(record.costIsEstimate).toBe(true);
		const row = database.db.prepare("SELECT * FROM usage_events;").get();
		expect(row?.estimated_cost).toBeNull();
		expect(row?.price_snapshot_json).toBeNull();
	});

	it("a price change recalculates aggregates without mutating the original event", () => {
		const { database, usage } = openUsage({ prices: FLAT_PRICES });
		database.transaction(() =>
			usage.recordModelCall(call({ inputTokens: 1_000_000, outputTokens: 0 })),
		);
		const before = database.db.prepare("SELECT * FROM usage_events;").get();
		expect(before?.estimated_cost).toBeCloseTo(10, 10);

		const doubled: PriceResolver = () => ({
			inputPerMTokens: 20,
			outputPerMTokens: 60,
			currency: "USD",
			source: "test-catalog-v2",
		});
		const outcome = usage.recalculateEstimates(doubled, {
			from: utcDateOf(T0),
			to: utcDateOf(T0),
		});
		expect(outcome.updatedEvents).toBe(1);
		expect(outcome.costDelta).toBeCloseTo(10, 10);

		const after = database.db.prepare("SELECT * FROM usage_events;").get();
		// Original fields untouched; recalculation lives beside them.
		expect(after?.estimated_cost).toBeCloseTo(10, 10);
		expect(JSON.parse(String(after?.price_snapshot_json)).source).toBe(
			"test-catalog-v1",
		);
		expect(after?.recalculated_cost).toBeCloseTo(20, 10);
		expect(JSON.parse(String(after?.recalculated_price_json)).source).toBe(
			"test-catalog-v2",
		);
		// Aggregates moved by the delta.
		expect(
			database.db.prepare("SELECT estimated_cost FROM daily_usage;").get()
				?.estimated_cost,
		).toBeCloseTo(20, 10);
		expect(
			database.db.prepare("SELECT estimated_cost FROM model_usage;").get()
				?.estimated_cost,
		).toBeCloseTo(20, 10);

		// Provider-reported costs are never re-priced.
		database.transaction(() =>
			usage.recordModelCall(call({ providerCost: 1 })),
		);
		const second = usage.recalculateEstimates(doubled, {
			from: utcDateOf(T0),
			to: utcDateOf(T0),
		});
		expect(second.updatedEvents).toBe(0);
	});
});

describe("bounded statistics queries (aggregates only)", () => {
	function seedWeek(
		usage: UsageStore,
		database: ReturnType<typeof openGatewayDatabase>,
	) {
		const botId = createBotId();
		const sessionId = createSessionId();
		database.transaction(() => {
			for (let day = 0; day < 3; day += 1) {
				usage.recordModelCall(
					call({
						botId,
						sessionId,
						occurredAt: T0 - day * DAY_MS,
						inputTokens: 100 * (day + 1),
						outputTokens: 10,
						providerCost: day + 1,
					}),
				);
				usage.recordMessage({
					occurredAt: T0 - day * DAY_MS,
					botId,
					sessionId,
					role: "assistant",
				});
			}
			usage.recordRunDuration(botId, T0, 45_000);
		});
		return { botId, sessionId };
	}

	it("summary/activity/rankings/month derive everything from aggregates", () => {
		const { database, usage } = openUsage();
		seedWeek(usage, database);

		// Prove there is no history rescan: wipe every raw history table the
		// gateway keeps; only usage_* aggregates remain.
		for (const table of [
			"messages",
			"events",
			"runs",
			"run_attempts",
			"sessions",
		]) {
			database.db.exec(`DELETE FROM ${table};`);
		}

		const summary = usage.summary({
			from: utcDateOf(T0 - 6 * DAY_MS),
			to: utcDateOf(T0),
		}) as {
			totals: Record<string, number>;
			agents: number;
			topics: number;
			activeModels: unknown[];
			peakDailyTokens: number;
			longestTaskMs: number;
			streak: { current: number; longest: number };
		};
		expect(summary.totals.tokens).toBe(110 + 210 + 310);
		expect(summary.totals.messages).toBe(3);
		expect(summary.totals.modelCalls).toBe(3);
		expect(summary.totals.estimatedCost).toBeCloseTo(6, 10);
		expect(summary.agents).toBe(1);
		expect(summary.topics).toBe(1);
		expect(summary.activeModels).toEqual([
			{ modelId: "claude-x", providerId: "anthropic" },
		]);
		expect(summary.peakDailyTokens).toBe(310);
		expect(summary.longestTaskMs).toBe(45_000);
		expect(summary.streak).toEqual({ current: 3, longest: 3 });

		const activity = usage.activity({
			from: utcDateOf(T0 - 6 * DAY_MS),
			to: utcDateOf(T0),
		}) as {
			days: { date: string; tokens: number; activeSessions: number }[];
		};
		expect(activity.days).toHaveLength(3);
		expect(activity.days.at(-1)).toMatchObject({
			date: utcDateOf(T0),
			tokens: 110,
			activeSessions: 1,
		});

		const rankings = usage.rankings({
			dimension: "model",
			from: utcDateOf(T0 - 6 * DAY_MS),
			to: utcDateOf(T0),
		}) as { rows: { modelId: string; tokens: number }[] };
		expect(rankings.rows[0]).toMatchObject({
			modelId: "claude-x",
			tokens: 630,
		});

		const month = usage.month("2026-08") as {
			days: unknown[];
			monthSpend: number;
			todaySpend: number;
		};
		expect(month.days).toHaveLength(3);
		expect(month.monthSpend).toBeCloseTo(6, 10);
		expect(month.todaySpend).toBeCloseTo(1, 10); // "today" = T0's date
	});

	it("agent and topic rankings group their aggregate tables", () => {
		const { database, usage } = openUsage();
		const { botId, sessionId } = seedWeek(usage, database);
		const agent = usage.rankings({
			dimension: "agent",
			from: utcDateOf(T0 - 6 * DAY_MS),
			to: utcDateOf(T0),
		}) as {
			rows: { agentId: string; tokens: number; messages: number }[];
		};
		expect(agent.rows[0]).toMatchObject({
			agentId: botId,
			tokens: 630,
			messages: 3,
		});
		const topic = usage.rankings({
			dimension: "topic",
			from: utcDateOf(T0 - 6 * DAY_MS),
			to: utcDateOf(T0),
		}) as {
			rows: { topicId: string }[];
		};
		expect(topic.rows[0]).toMatchObject({ topicId: sessionId });
	});

	it("rejects malformed and unbounded ranges", () => {
		const { usage } = openUsage();
		expect(() => usage.summary({ from: "08/10/2026" })).toThrow(
			UsageQueryError,
		);
		expect(() =>
			usage.summary({ from: "2026-08-10", to: "2026-08-01" }),
		).toThrow(UsageQueryError);
		expect(() =>
			usage.summary({
				from: utcDateOf(T0 - (MAX_STATISTICS_RANGE_DAYS + 5) * DAY_MS),
				to: utcDateOf(T0),
			}),
		).toThrow(UsageQueryError);
		expect(() => usage.month("2026-8")).toThrow(UsageQueryError);
		expect(() => usage.month("august")).toThrow(UsageQueryError);
	});

	it("streaks track consecutive active dates with a gap reset", () => {
		const { database, usage } = openUsage();
		database.transaction(() => {
			for (const daysAgo of [0, 1, 2, 4, 5, 6, 7]) {
				usage.recordMessage({
					occurredAt: T0 - daysAgo * DAY_MS,
					botId: createBotId(),
					sessionId: createSessionId(),
					role: "user",
				});
			}
		});
		const summary = usage.summary({}) as {
			streak: { current: number; longest: number };
		};
		expect(summary.streak).toEqual({ current: 3, longest: 4 });
	});
});
