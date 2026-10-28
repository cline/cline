import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FixtureFaults,
	holdFixtureWorkspaceMutation,
} from "../e2e/native-fixture/faults";

afterEach(() => vi.useRealTimers());
describe("scoped native management pending controls", () => {
	it("rejects global and unbounded controls, recording the exact request before holding its handler", async () => {
		vi.useFakeTimers();
		const faults = new FixtureFaults();
		expect(() => faults.set("global", "mutation-delay-ms", 100)).toThrow(
			"exact workspace id",
		);
		expect(() => faults.set("owned", "mutation-delay-ms", 60_001)).toThrow(
			"invalid value",
		);
		faults.set("owned", "mutation-delay-ms", 12_000);
		const events: unknown[] = [];
		const sleep = vi.fn(
			(milliseconds: number) =>
				new Promise((resolve) => setTimeout(resolve, milliseconds)),
		);
		const held = holdFixtureWorkspaceMutation({
			faults,
			id: "owned",
			method: "PATCH",
			record: (kind, detail) => events.push({ kind, detail }),
			sleep,
		}).then(() => {
			events.push({ kind: "existing-handler" });
		});
		expect(events).toEqual([
			{
				kind: "workspace-mutation-requested",
				detail: { id: "owned", method: "PATCH", action: "rename" },
			},
		]);
		expect(sleep).toHaveBeenCalledExactlyOnceWith(12_000);
		await vi.advanceTimersByTimeAsync(11_999);
		expect(events).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		await held;
		expect(events.at(-1)).toEqual({ kind: "existing-handler" });
	});
	it.each([
		["PATCH", undefined, "rename"],
		["DELETE", undefined, "delete"],
		["POST", "suspend", "suspend"],
		["POST", "resume", "resume"],
	] as const)("records %s/%s without delaying other workspace IDs", async (method, action, expectedAction) => {
		const faults = new FixtureFaults();
		faults.set("owned", "mutation-delay-ms", 100);
		const record = vi.fn();
		const sleep = vi.fn(async () => {});
		await holdFixtureWorkspaceMutation({
			faults,
			id: "other-owned",
			method,
			action,
			record,
			sleep,
		});
		expect(record).toHaveBeenCalledExactlyOnceWith(
			"workspace-mutation-requested",
			{ id: "other-owned", method, action: expectedAction },
		);
		expect(sleep).not.toHaveBeenCalled();
	});
	it.each([
		["GET", "status"],
		["GET", undefined],
		["POST", "status"],
		["POST", undefined],
		["PATCH", "suspend"],
	] as const)("does not hold or log a nonmanagement %s/%s request", async (method, action) => {
		const faults = new FixtureFaults();
		faults.set("owned", "mutation-delay-ms", 100);
		const record = vi.fn();
		const sleep = vi.fn(async () => {});
		await holdFixtureWorkspaceMutation({
			faults,
			id: "owned",
			method,
			action,
			record,
			sleep,
		});
		expect(record).not.toHaveBeenCalled();
		expect(sleep).not.toHaveBeenCalled();
	});
});
