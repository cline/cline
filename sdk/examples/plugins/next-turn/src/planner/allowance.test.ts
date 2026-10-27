import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Allowance, fileLedgerStore, type LedgerLine } from "./allowance";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
const ledgerPath = () => {
	const dir = mkdtempSync(join(tmpdir(), "allowance-"));
	dirs.push(dir);
	return join(dir, "nested", "planner.jsonl");
};

const HOUR = 3_600_000;

test("a chat gets its calls per hour, in flight calls included, then none until the oldest ages out", () => {
	let now = 1_000_000;
	const allowance = new Allowance(fileLedgerStore(ledgerPath()), 2, () => now);
	const first = allowance.reserve("a");
	expect(first).toBeDefined();
	expect(allowance.reserve("a")).toBeDefined();
	expect(allowance.reserve("a")).toBeUndefined();
	expect(allowance.reserve("b")).toBeDefined();
	now += HOUR - 1;
	expect(allowance.reserve("a")).toBeUndefined();
	now += 2;
	expect(allowance.reserve("a")).toBeDefined();
});

test("a released call is not counted", () => {
	const allowance = new Allowance(fileLedgerStore(ledgerPath()), 1);
	allowance.reserve("a")?.release();
	expect(allowance.reserve("a")).toBeDefined();
});

test("a recorded call is appended once with its outcome and survives into a new process", () => {
	const path = ledgerPath();
	const now = () => 5_000;
	const first = new Allowance(fileLedgerStore(path), 1, now);
	first.reserve("a")?.record({ outcome: "ok", totalMs: 12, inputTokens: 3 });
	expect(
		readFileSync(path, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as LedgerLine),
	).toEqual([
		{ sessionId: "a", at: 5_000, outcome: "ok", totalMs: 12, inputTokens: 3 },
	]);
	const second = new Allowance(fileLedgerStore(path), 1, now);
	expect(second.reserve("a")).toBeUndefined();
	expect(second.reserve("b")).toBeDefined();
});

test("torn and foreign ledger lines are skipped", () => {
	const path = ledgerPath();
	const store = fileLedgerStore(path);
	store.append({ sessionId: "a", at: 1 });
	writeFileSync(
		path,
		`${readFileSync(path, "utf8")}{"torn":\nnot json\n{"x":1}\n`,
	);
	expect(store.read()).toEqual([{ sessionId: "a", at: 1 }]);
});
