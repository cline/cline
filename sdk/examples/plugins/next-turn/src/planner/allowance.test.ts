import { describe, expect, test } from "bun:test";
import { appendFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { useTempDirs } from "../test-support";
import {
	PlannerLedger,
	parseLedger,
	pausedUntil,
	readLedgerTail,
} from "./allowance";

const HOUR = 3_600_000;
const tempDir = useTempDirs("next-turn-ledger-");

describe("the planner allowance", () => {
	test("counts only calls in the rolling hour", () => {
		const now = 10 * HOUR;
		const calls = [
			{ sessionId: "a", at: now - HOUR - 1 },
			{ sessionId: "a", at: now - 30 * 60_000 },
		];
		expect(pausedUntil(calls, 2, now)).toBeUndefined();
	});

	test("used up: resets when the oldest counted call leaves the window", () => {
		const now = 10 * HOUR;
		const calls = [
			{ sessionId: "a", at: now - 50 * 60_000 },
			{ sessionId: "a", at: now - 20 * 60_000 },
			{ sessionId: "a", at: now - 10 * 60_000 },
		];
		expect(pausedUntil(calls, 2, now)).toBe(now - 20 * 60_000 + HOUR);
	});
});

describe("the ledger", () => {
	test("appends owner-only lines and skips torn or foreign ones", () => {
		const dir = tempDir();
		const path = join(dir, "nested", "planner.jsonl");
		const ledger = new PlannerLedger(path, () => 42);
		ledger.record("a", {
			costUsd: 0.5,
			providerId: "cline",
			modelId: "claude-sonnet",
		});
		appendFileSync(path, '{"sessionId":"b","at":\n{"note":"not a call"}\n');
		ledger.record("b");
		expect(readLedgerTail(path)).toEqual([
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
		expect(readLedgerTail(join(dir, "none.jsonl"))).toEqual([]);
		expect(parseLedger('{"sessionId":"x","at":1,"costUsd":"free"}')).toEqual(
			[],
		);
	});

	test("callsForSession reads a bounded tail once and keeps new calls in memory", () => {
		const dir = tempDir("tail-");
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
		expect(pausedUntil(recent, 20, now)).toBe(now - 20_000 + HOUR);
		ledger.record("mine", { costUsd: 0.01 });
		expect(ledger.callsForSession("mine")).toHaveLength(21);
	});
});
