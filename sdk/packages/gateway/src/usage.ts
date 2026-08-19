/**
 * Usage/statistics pipeline (Gateway RFC, Phase 3 write path; the Phase 7
 * Statistics surface reads it).
 *
 * Data is collected at run/message completion time and folded into daily
 * aggregates immediately — statistics queries NEVER rescan session
 * message history:
 *
 *   engine model response -> `model-call-completed` (per-call deltas)
 *     -> usage normalizer -> ONE SQLite transaction that appends the
 *        immutable `usage_events` row and bumps `daily_usage`,
 *        `model_usage`, `agent_usage`, `topic_usage`, `streak_usage`.
 *
 * Identity mapping (documented, no parallel agent system): `agent_id` IS
 * the existing `botId` and `topic_id` IS the existing `sessionId`. Both
 * are denormalized onto every usage event so a later phase can diverge
 * the mapping without rewriting history.
 *
 * Cost accuracy: provider-reported token counts and costs are recorded
 * verbatim (`costIsEstimate = false`). Otherwise a price snapshot from
 * the injected resolver is captured ON THE EVENT and the cost is flagged
 * as an estimate. Price changes recalculate into `recalculated_*`
 * columns and adjust aggregates by the delta — the original event fields
 * are never overwritten.
 */

import type {
	BotId,
	GatewayError,
	RunId,
	SessionId,
} from "@cline/shared/gateway";
import { createGatewayError } from "@cline/shared/gateway";
import type { GatewayDatabase } from "./db";

/** A statistics query failure that already knows its wire error. */
export class UsageQueryError extends Error {
	readonly gatewayError: GatewayError;

	constructor(message: string) {
		super(message);
		this.name = "UsageQueryError";
		this.gatewayError = createGatewayError("invalid_request", message);
	}
}

// -----------------------------------------------------------------------------
// Pricing
// -----------------------------------------------------------------------------

export interface PriceSnapshot {
	/** USD per million input tokens. */
	readonly inputPerMTokens: number;
	/** USD per million output tokens. */
	readonly outputPerMTokens: number;
	readonly currency: "USD";
	/** Where this price came from (catalog name/version, config, ...). */
	readonly source: string;
}

export type PriceResolver = (
	providerId: string | undefined,
	modelId: string | undefined,
) => PriceSnapshot | undefined;

function computeCost(
	price: PriceSnapshot,
	inputTokens: number,
	outputTokens: number,
): number {
	return (
		(inputTokens * price.inputPerMTokens +
			outputTokens * price.outputPerMTokens) /
		1_000_000
	);
}

// -----------------------------------------------------------------------------
// Normalized records
// -----------------------------------------------------------------------------

/** One normalized usage record per model call (the write-path input). */
export interface NormalizedModelCall {
	readonly occurredAt: number;
	readonly botId: BotId;
	readonly sessionId: SessionId;
	readonly runId: RunId;
	readonly providerId?: string;
	readonly modelId?: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	/** Provider-reported cost for this call, when available. */
	readonly providerCost?: number;
	readonly durationMs?: number;
	readonly status: "ok" | "error";
}

export interface UsageEventRecord {
	readonly eventId: number;
	readonly date: string;
	readonly estimatedCost: number | undefined;
	readonly costIsEstimate: boolean;
	readonly priceSnapshot: PriceSnapshot | undefined;
}

/** Epoch ms -> UTC calendar date (aggregate key). */
export function utcDateOf(epochMs: number): string {
	return new Date(epochMs).toISOString().slice(0, 10);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
/** Hard bound on any statistics query range. */
export const MAX_STATISTICS_RANGE_DAYS = 400;
const DEFAULT_RANGE_DAYS = 30;
const UNKNOWN = "unknown";

function addDays(date: string, days: number): string {
	const ms = Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000;
	return utcDateOf(ms);
}

function daySpan(from: string, to: string): number {
	return (
		(Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
			86_400_000 +
		1
	);
}

export interface StatisticsRange {
	readonly from: string;
	readonly to: string;
}

// -----------------------------------------------------------------------------
// Store
// -----------------------------------------------------------------------------

export interface UsageStoreOptions {
	/** Price snapshots for providers that do not report costs. */
	prices?: PriceResolver;
	/** "Today" source for range defaults (injected for tests). */
	now?: () => number;
}

export class UsageStore {
	private readonly database: GatewayDatabase;
	private readonly prices: PriceResolver | undefined;
	private readonly now: () => number;

	constructor(database: GatewayDatabase, options: UsageStoreOptions = {}) {
		this.database = database;
		this.prices = options.prices;
		this.now = options.now ?? (() => Date.now());
	}

	// -------------------------------------------------------------------
	// Write path (call inside the enclosing gateway transaction)
	// -------------------------------------------------------------------

	/**
	 * Append one immutable usage event and bump every aggregate. The
	 * caller wraps this in the same transaction as the triggering state
	 * change, so the event and its aggregates commit atomically.
	 */
	recordModelCall(call: NormalizedModelCall): UsageEventRecord {
		const date = utcDateOf(call.occurredAt);
		const totalTokens = call.inputTokens + call.outputTokens;

		let estimatedCost: number | undefined;
		let costIsEstimate = true;
		let priceSnapshot: PriceSnapshot | undefined;
		if (call.providerCost !== undefined) {
			estimatedCost = call.providerCost;
			costIsEstimate = false;
		} else {
			priceSnapshot = this.prices?.(call.providerId, call.modelId);
			if (priceSnapshot) {
				estimatedCost = computeCost(
					priceSnapshot,
					call.inputTokens,
					call.outputTokens,
				);
			}
		}

		this.database.db
			.prepare(
				`INSERT INTO usage_events (
					occurred_at, date, bot_id, session_id, run_id,
					provider_id, model_id, agent_id, topic_id,
					input_tokens, output_tokens, total_tokens,
					estimated_cost, cost_is_estimate, price_snapshot_json,
					duration_ms, status
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
			)
			.run(
				call.occurredAt,
				date,
				call.botId,
				call.sessionId,
				call.runId,
				call.providerId ?? null,
				call.modelId ?? null,
				// agent_id := botId, topic_id := sessionId (see module doc).
				call.botId,
				call.sessionId,
				call.inputTokens,
				call.outputTokens,
				totalTokens,
				estimatedCost ?? null,
				costIsEstimate ? 1 : 0,
				priceSnapshot ? JSON.stringify(priceSnapshot) : null,
				call.durationMs ?? null,
				call.status,
			);
		const eventRow = this.database.db
			.prepare("SELECT MAX(event_id) AS id FROM usage_events;")
			.get();

		const cost = estimatedCost ?? 0;
		this.database.db
			.prepare(
				`INSERT INTO daily_usage (
					date, bot_id, tokens, input_tokens, output_tokens,
					messages, model_calls, estimated_cost
				) VALUES (?, ?, ?, ?, ?, 0, 1, ?)
				ON CONFLICT(date, bot_id) DO UPDATE SET
					tokens = tokens + excluded.tokens,
					input_tokens = input_tokens + excluded.input_tokens,
					output_tokens = output_tokens + excluded.output_tokens,
					model_calls = model_calls + 1,
					estimated_cost = estimated_cost + excluded.estimated_cost;`,
			)
			.run(
				date,
				call.botId,
				totalTokens,
				call.inputTokens,
				call.outputTokens,
				cost,
			);
		this.database.db
			.prepare(
				`INSERT INTO model_usage (date, model_id, provider_id, messages, tokens, estimated_cost)
				VALUES (?, ?, ?, 1, ?, ?)
				ON CONFLICT(date, model_id, provider_id) DO UPDATE SET
					messages = messages + 1,
					tokens = tokens + excluded.tokens,
					estimated_cost = estimated_cost + excluded.estimated_cost;`,
			)
			.run(
				date,
				call.modelId ?? UNKNOWN,
				call.providerId ?? UNKNOWN,
				totalTokens,
				cost,
			);
		this.database.db
			.prepare(
				`INSERT INTO agent_usage (date, agent_id, messages, tokens)
				VALUES (?, ?, 0, ?)
				ON CONFLICT(date, agent_id) DO UPDATE SET
					tokens = tokens + excluded.tokens;`,
			)
			.run(date, call.botId, totalTokens);
		this.database.db
			.prepare(
				`INSERT INTO topic_usage (date, topic_id, messages, tokens)
				VALUES (?, ?, 0, ?)
				ON CONFLICT(date, topic_id) DO UPDATE SET
					tokens = tokens + excluded.tokens;`,
			)
			.run(date, call.sessionId, totalTokens);
		this.markActive(date, call.botId, call.sessionId);

		return {
			eventId: Number(eventRow?.id ?? 0),
			date,
			estimatedCost,
			costIsEstimate,
			priceSnapshot,
		};
	}

	/** Count one canonical user/assistant message into the aggregates. */
	recordMessage(entry: {
		occurredAt: number;
		botId: BotId;
		sessionId: SessionId;
		role: string;
	}): void {
		if (entry.role !== "user" && entry.role !== "assistant") {
			return;
		}
		const date = utcDateOf(entry.occurredAt);
		this.database.db
			.prepare(
				`INSERT INTO daily_usage (date, bot_id, messages)
				VALUES (?, ?, 1)
				ON CONFLICT(date, bot_id) DO UPDATE SET messages = messages + 1;`,
			)
			.run(date, entry.botId);
		this.database.db
			.prepare(
				`INSERT INTO agent_usage (date, agent_id, messages, tokens)
				VALUES (?, ?, 1, 0)
				ON CONFLICT(date, agent_id) DO UPDATE SET messages = messages + 1;`,
			)
			.run(date, entry.botId);
		this.database.db
			.prepare(
				`INSERT INTO topic_usage (date, topic_id, messages, tokens)
				VALUES (?, ?, 1, 0)
				ON CONFLICT(date, topic_id) DO UPDATE SET messages = messages + 1;`,
			)
			.run(date, entry.sessionId);
		this.markActive(date, entry.botId, entry.sessionId);
	}

	/** Track the longest run per day (Statistics "Longest Task"). */
	recordRunDuration(
		botId: BotId,
		occurredAt: number,
		durationMs: number,
	): void {
		const date = utcDateOf(occurredAt);
		this.database.db
			.prepare(
				`INSERT INTO daily_usage (date, bot_id, max_run_duration_ms)
				VALUES (?, ?, ?)
				ON CONFLICT(date, bot_id) DO UPDATE SET
					max_run_duration_ms = MAX(max_run_duration_ms, excluded.max_run_duration_ms);`,
			)
			.run(date, botId, Math.max(0, durationMs));
	}

	/**
	 * Re-price estimated events after a pricing change. Immutable event
	 * fields (`estimated_cost`, `price_snapshot_json`) are never touched:
	 * new values land in `recalculated_*` and aggregates shift by the
	 * delta. Provider-reported costs are authoritative and are skipped.
	 */
	recalculateEstimates(
		prices: PriceResolver,
		range?: Partial<StatisticsRange>,
	): { updatedEvents: number; costDelta: number } {
		const { from, to } = this.clampRange(range ?? {});
		return this.database.transaction(() => {
			const rows = this.database.db
				.prepare(
					`SELECT event_id, date, bot_id, provider_id, model_id,
						input_tokens, output_tokens, estimated_cost, recalculated_cost
					FROM usage_events
					WHERE cost_is_estimate = 1 AND date >= ? AND date <= ?
					ORDER BY event_id;`,
				)
				.all(from, to);
			let updatedEvents = 0;
			let costDelta = 0;
			for (const row of rows) {
				const providerId =
					row.provider_id === null ? undefined : String(row.provider_id);
				const modelId =
					row.model_id === null ? undefined : String(row.model_id);
				const price = prices(providerId, modelId);
				if (!price) {
					continue;
				}
				const newCost = computeCost(
					price,
					Number(row.input_tokens),
					Number(row.output_tokens),
				);
				const previousEffective = Number(
					row.recalculated_cost ?? row.estimated_cost ?? 0,
				);
				const delta = newCost - previousEffective;
				if (Math.abs(delta) < 1e-12) {
					continue;
				}
				this.database.db
					.prepare(
						`UPDATE usage_events
						SET recalculated_cost = ?, recalculated_price_json = ?
						WHERE event_id = ?;`,
					)
					.run(newCost, JSON.stringify(price), Number(row.event_id));
				this.database.db
					.prepare(
						"UPDATE daily_usage SET estimated_cost = estimated_cost + ? WHERE date = ? AND bot_id = ?;",
					)
					.run(delta, String(row.date), String(row.bot_id));
				this.database.db
					.prepare(
						"UPDATE model_usage SET estimated_cost = estimated_cost + ? WHERE date = ? AND model_id = ? AND provider_id = ?;",
					)
					.run(
						delta,
						String(row.date),
						modelId ?? UNKNOWN,
						providerId ?? UNKNOWN,
					);
				updatedEvents += 1;
				costDelta += delta;
			}
			return { updatedEvents, costDelta };
		});
	}

	// -------------------------------------------------------------------
	// Bounded read surface (aggregates only; no history rescans)
	// -------------------------------------------------------------------

	/** Validate and bound a query range; defaults to the last 30 days. */
	clampRange(range: Partial<StatisticsRange>): StatisticsRange {
		for (const [name, value] of [
			["from", range.from],
			["to", range.to],
		] as const) {
			if (value !== undefined && !DATE_PATTERN.test(value)) {
				throw new UsageQueryError(
					`Invalid "${name}" date: expected YYYY-MM-DD`,
				);
			}
		}
		const to = range.to ?? utcDateOf(this.now());
		const from = range.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
		if (from > to) {
			throw new UsageQueryError(`Range is inverted: ${from} > ${to}`);
		}
		if (daySpan(from, to) > MAX_STATISTICS_RANGE_DAYS) {
			throw new UsageQueryError(
				`Range exceeds ${MAX_STATISTICS_RANGE_DAYS} days; narrow the window`,
			);
		}
		return { from, to };
	}

	summary(range: Partial<StatisticsRange> = {}): Record<string, unknown> {
		const { from, to } = this.clampRange(range);
		const totals = this.database.db
			.prepare(
				`SELECT
					COALESCE(SUM(tokens), 0) AS tokens,
					COALESCE(SUM(input_tokens), 0) AS input_tokens,
					COALESCE(SUM(output_tokens), 0) AS output_tokens,
					COALESCE(SUM(messages), 0) AS messages,
					COALESCE(SUM(model_calls), 0) AS model_calls,
					COALESCE(SUM(estimated_cost), 0) AS estimated_cost,
					COALESCE(MAX(max_run_duration_ms), 0) AS longest_task_ms
				FROM daily_usage WHERE date >= ? AND date <= ?;`,
			)
			.get(from, to);
		const peak = this.database.db
			.prepare(
				`SELECT COALESCE(MAX(day_tokens), 0) AS peak FROM (
					SELECT SUM(tokens) AS day_tokens FROM daily_usage
					WHERE date >= ? AND date <= ? GROUP BY date
				);`,
			)
			.get(from, to);
		const agents = this.database.db
			.prepare(
				"SELECT COUNT(DISTINCT agent_id) AS n FROM agent_usage WHERE date >= ? AND date <= ?;",
			)
			.get(from, to);
		const topics = this.database.db
			.prepare(
				"SELECT COUNT(DISTINCT topic_id) AS n FROM topic_usage WHERE date >= ? AND date <= ?;",
			)
			.get(from, to);
		const activeModels = this.database.db
			.prepare(
				`SELECT DISTINCT model_id, provider_id FROM model_usage
				WHERE date >= ? AND date <= ? ORDER BY model_id, provider_id;`,
			)
			.all(from, to)
			.map((row) => ({
				modelId: String(row.model_id),
				providerId: String(row.provider_id),
			}));
		return {
			from,
			to,
			totals: {
				tokens: Number(totals?.tokens ?? 0),
				inputTokens: Number(totals?.input_tokens ?? 0),
				outputTokens: Number(totals?.output_tokens ?? 0),
				messages: Number(totals?.messages ?? 0),
				modelCalls: Number(totals?.model_calls ?? 0),
				estimatedCost: Number(totals?.estimated_cost ?? 0),
			},
			agents: Number(agents?.n ?? 0),
			topics: Number(topics?.n ?? 0),
			activeModels,
			peakDailyTokens: Number(peak?.peak ?? 0),
			longestTaskMs: Number(totals?.longest_task_ms ?? 0),
			streak: this.streaks(),
		};
	}

	/** One row per active day — the heatmap source. */
	activity(range: Partial<StatisticsRange> = {}): Record<string, unknown> {
		const { from, to } = this.clampRange(range);
		const days = this.database.db
			.prepare(
				`SELECT date,
					SUM(tokens) AS tokens,
					SUM(messages) AS messages,
					SUM(model_calls) AS model_calls,
					SUM(estimated_cost) AS estimated_cost,
					SUM(active_sessions) AS active_sessions,
					COUNT(*) AS active_agents,
					MAX(max_run_duration_ms) AS max_run_duration_ms
				FROM daily_usage
				WHERE date >= ? AND date <= ?
				GROUP BY date ORDER BY date;`,
			)
			.all(from, to)
			.map((row) => ({
				date: String(row.date),
				tokens: Number(row.tokens),
				messages: Number(row.messages),
				modelCalls: Number(row.model_calls),
				estimatedCost: Number(row.estimated_cost),
				activeSessions: Number(row.active_sessions),
				activeAgents: Number(row.active_agents),
				maxRunDurationMs: Number(row.max_run_duration_ms),
			}));
		return { from, to, days };
	}

	rankings(params: {
		dimension: "model" | "agent" | "topic";
		from?: string;
		to?: string;
		limit?: number;
	}): Record<string, unknown> {
		const { from, to } = this.clampRange(params);
		const limit = Math.max(1, Math.min(100, params.limit ?? 20));
		let rows: Record<string, unknown>[];
		switch (params.dimension) {
			case "model":
				rows = this.database.db
					.prepare(
						`SELECT model_id, provider_id,
							SUM(messages) AS messages, SUM(tokens) AS tokens,
							SUM(estimated_cost) AS estimated_cost
						FROM model_usage WHERE date >= ? AND date <= ?
						GROUP BY model_id, provider_id
						ORDER BY tokens DESC, model_id LIMIT ?;`,
					)
					.all(from, to, limit)
					.map((row) => ({
						modelId: String(row.model_id),
						providerId: String(row.provider_id),
						messages: Number(row.messages),
						tokens: Number(row.tokens),
						estimatedCost: Number(row.estimated_cost),
					}));
				break;
			case "agent":
				rows = this.database.db
					.prepare(
						`SELECT agent_id, SUM(messages) AS messages, SUM(tokens) AS tokens
						FROM agent_usage WHERE date >= ? AND date <= ?
						GROUP BY agent_id ORDER BY tokens DESC, agent_id LIMIT ?;`,
					)
					.all(from, to, limit)
					.map((row) => ({
						agentId: String(row.agent_id),
						messages: Number(row.messages),
						tokens: Number(row.tokens),
					}));
				break;
			case "topic":
				rows = this.database.db
					.prepare(
						`SELECT topic_id, SUM(messages) AS messages, SUM(tokens) AS tokens
						FROM topic_usage WHERE date >= ? AND date <= ?
						GROUP BY topic_id ORDER BY tokens DESC, topic_id LIMIT ?;`,
					)
					.all(from, to, limit)
					.map((row) => ({
						topicId: String(row.topic_id),
						messages: Number(row.messages),
						tokens: Number(row.tokens),
					}));
				break;
		}
		return { from, to, dimension: params.dimension, rows };
	}

	/** Calendar-month view (spend-by-date, month totals). */
	month(month: string): Record<string, unknown> {
		if (!MONTH_PATTERN.test(month)) {
			throw new UsageQueryError('Invalid "month": expected YYYY-MM');
		}
		const from = `${month}-01`;
		const to = addDays(addDays(from, 32).slice(0, 8).concat("01"), -1);
		const activity = this.activity({ from, to }) as {
			days: { date: string; tokens: number; estimatedCost: number }[];
		};
		const today = utcDateOf(this.now());
		const totals = {
			tokens: 0,
			estimatedCost: 0,
		};
		for (const day of activity.days) {
			totals.tokens += day.tokens;
			totals.estimatedCost += day.estimatedCost;
		}
		return {
			month,
			from,
			to,
			days: activity.days,
			totals,
			todaySpend:
				activity.days.find((day) => day.date === today)?.estimatedCost ?? 0,
			monthSpend: totals.estimatedCost,
		};
	}

	// -------------------------------------------------------------------
	// Internals
	// -------------------------------------------------------------------

	/** Mark the day active + count distinct sessions incrementally. */
	private markActive(date: string, botId: BotId, sessionId: SessionId): void {
		this.database.db
			.prepare(
				"INSERT OR IGNORE INTO streak_usage (date, active) VALUES (?, 1);",
			)
			.run(date);
		const seen = this.database.db
			.prepare(
				"INSERT OR IGNORE INTO usage_seen_sessions (date, session_id, bot_id) VALUES (?, ?, ?);",
			)
			.run(date, sessionId, botId);
		if (seen.changes) {
			this.database.db
				.prepare(
					"UPDATE daily_usage SET active_sessions = active_sessions + 1 WHERE date = ? AND bot_id = ?;",
				)
				.run(date, botId);
		}
	}

	/** Current/longest streak of consecutive active dates. */
	private streaks(): { current: number; longest: number } {
		const dates = this.database.db
			.prepare("SELECT date FROM streak_usage WHERE active = 1 ORDER BY date;")
			.all()
			.map((row) => String(row.date));
		let longest = 0;
		let runLength = 0;
		let previous: string | undefined;
		for (const date of dates) {
			runLength = previous && addDays(previous, 1) === date ? runLength + 1 : 1;
			longest = Math.max(longest, runLength);
			previous = date;
		}
		const active = new Set(dates);
		const today = utcDateOf(this.now());
		// The current streak may end today or (grace) yesterday.
		let cursor = active.has(today) ? today : addDays(today, -1);
		let current = 0;
		while (active.has(cursor)) {
			current += 1;
			cursor = addDays(cursor, -1);
		}
		return { current, longest };
	}
}
