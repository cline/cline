import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowance, PlannerLedger, parseLedger, spendByDay } from "./allowance";

const HOUR = 3_600_000;
const temps: string[] = [];
afterEach(() => {
	for (const dir of temps.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe("the planner allowance", () => {
	test("counts only this chat's calls in the rolling hour", () => {
		const now = 10 * HOUR;
		const calls = [
			{ sessionId: "a", at: now - HOUR - 1 },
			{ sessionId: "a", at: now - 30 * 60_000 },
			{ sessionId: "b", at: now - 1000 },
		];
		expect(allowance(calls, "a", 2, now)).toEqual({
			kind: "available",
			remaining: 1,
		});
	});

	test("used up: resets when the oldest counted call leaves the window", () => {
		const now = 10 * HOUR;
		const calls = [
			{ sessionId: "a", at: now - 50 * 60_000 },
			{ sessionId: "a", at: now - 20 * 60_000 },
			{ sessionId: "a", at: now - 10 * 60_000 },
		];
		expect(allowance(calls, "a", 2, now)).toEqual({
			kind: "used",
			resetsAt: now - 20 * 60_000 + HOUR,
		});
	});

	test("spend groups by UTC day, overall or for one chat", () => {
		const day = Date.parse("2026-10-08T12:00:00.000Z");
		const calls = [
			{ sessionId: "a", at: day, costUsd: 0.01 },
			{ sessionId: "b", at: day + 1000, costUsd: 0.02 },
			{ sessionId: "a", at: day + 86_400_000 },
		];
		expect(spendByDay(calls)["2026-10-08"]).toEqual({
			calls: 2,
			costUsd: 0.03,
		});
		expect(spendByDay(calls, "a")).toEqual({
			"2026-10-08": { calls: 1, costUsd: 0.01 },
			"2026-10-09": { calls: 1, costUsd: 0 },
		});
	});
});

describe("the ledger", () => {
	test("appends owner-only lines and skips torn or foreign ones", () => {
		const dir = mkdtempSync(join(tmpdir(), "next-turn-ledger-"));
		temps.push(dir);
		const path = join(dir, "nested", "planner.jsonl");
		const ledger = new PlannerLedger(path, () => 42);
		ledger.record("a", 0.5, { providerId: "cline", modelId: "claude-sonnet" });
		appendFileSync(path, '{"sessionId":"b","at":\n{"note":"not a call"}\n');
		ledger.record("b");
		expect(ledger.calls()).toEqual([
			{
				sessionId: "a",
				at: 42,
				costUsd: 0.5,
				providerId: "cline",
				modelId: "claude-sonnet",
			},
			{ sessionId: "b", at: 42 },
		]);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(new PlannerLedger(join(dir, "none.jsonl")).calls()).toEqual([]);
		expect(parseLedger('{"sessionId":"x","at":1,"costUsd":"free"}')).toEqual(
			[],
		);
	});

	test("callsForSession reads a bounded tail once and keeps new calls in memory", () => {
		const dir = mkdtempSync(join(tmpdir(), "next-turn-ledger-tail-"));
		temps.push(dir);
		const path = join(dir, "planner.jsonl");
		const now = 10 * HOUR;
		const lines: string[] = [];
		for (let i = 0; i < 2_000; i += 1) {
			lines.push(JSON.stringify({ sessionId: "other", at: now - 2 * HOUR }));
		}
		for (let i = 0; i < 20; i += 1) {
			lines.push(
				JSON.stringify({ sessionId: "mine", at: now - (20 - i) * 1_000 }),
			);
		}
		appendFileSync(path, `${lines.join("\n")}\n`);
		const ledger = new PlannerLedger(path, () => now, 4_096);
		const recent = ledger.callsForSession("mine");
		expect(recent).toHaveLength(20);
		expect(allowance(recent, "mine", 20, now).kind).toBe("used");
		ledger.record("mine", 0.01);
		expect(ledger.callsForSession("mine")).toHaveLength(21);
	});
});
