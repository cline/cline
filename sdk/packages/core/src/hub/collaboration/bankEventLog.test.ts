/**
 * Bank family log envelope (ARD-0013 phase 6).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBankStore, createMemoryBankFs } from "@cline/drive";
import { afterEach, describe, expect, it } from "vitest";
import { appendBankLogEvent, readBankLogSince } from "./bankEventLog";

describe("bankEventLog", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("appends bank mutations and reads gaps by seq", async () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-bank-log-"));
		dirs.push(dir);
		const fs = createMemoryBankFs();
		const store = createBankStore(fs, dir, {
			onBankEvent: (event) => {
				appendBankLogEvent(dir, event);
			},
		});
		await store.createTask({
			id: "t1",
			title: "One",
			body: "body",
		});
		await store.createPlan({
			id: "p1",
			title: "Plan",
			taskIds: ["t1"],
			activate: true,
		});
		const gaps = readBankLogSince(dir, 0);
		expect(gaps.length).toBeGreaterThanOrEqual(1);
		const first = gaps[0];
		expect(first?.family).toBe("bank");
		expect(first?.seq).toBe(1);
		const last = gaps[gaps.length - 1];
		const after = readBankLogSince(dir, last?.seq ?? 0);
		expect(after).toHaveLength(0);
	});
});
