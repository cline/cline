import { describe, expect, it } from "vitest";
import {
	clampFactoryPriority,
	compareFactoryNeedsYou,
	compareFactoryQueue,
	type FactoryPriority,
	factoryPriorityRank,
} from "./factory-priority";

const level = (value?: FactoryPriority) =>
	value ? { factoryPriority: { level: value } } : {};

describe("Factory priority", () => {
	it("ranks no priority with Medium, so Low demotes and unmarked boards keep their order", () => {
		expect(
			(["urgent", "high", "medium", undefined, "low"] as const).map((value) =>
				factoryPriorityRank(level(value)),
			),
		).toEqual([0, 1, 2, 2, 3]);
	});

	it("lets only a person set Urgent", () => {
		expect(clampFactoryPriority("urgent", "person")).toBe("urgent");
		expect(clampFactoryPriority("urgent", "agent")).toBe("high");
		expect(clampFactoryPriority("urgent", "scoper")).toBe("high");
		expect(clampFactoryPriority("low", "agent")).toBe("low");
	});

	it("orders the queue by rank, then enqueue time, then task id", () => {
		const entries = [
			{ taskId: "b", factoryQueuedAt: "2026-01-01T00:00:02Z", ...level("low") },
			{ taskId: "d", factoryQueuedAt: "2026-01-01T00:00:01Z" },
			{ taskId: "c", factoryQueuedAt: "2026-01-01T00:00:01Z" },
			{
				taskId: "a",
				factoryQueuedAt: "2026-01-01T00:00:00Z",
				...level("medium"),
			},
			{
				taskId: "e",
				factoryQueuedAt: "2026-01-01T00:00:09Z",
				...level("urgent"),
			},
		];
		expect(
			entries.sort(compareFactoryQueue).map((entry) => entry.taskId),
		).toEqual(["e", "a", "c", "d", "b"]);
	});

	it("orders Needs you by priority, then urgency class, then the agenda's order", () => {
		const entry = (
			id: string,
			urgency: number,
			createdAt: string,
			priority?: FactoryPriority,
			status: "failed" | "pending_approval" | "completed" = "failed",
		) => ({
			id,
			urgency,
			task: {
				taskId: id,
				status,
				priority: 3 as const,
				availableAt: createdAt,
				createdAt,
				...level(priority),
			},
		});
		const entries = [
			entry("question", 1, "2026-01-01T00:00:00Z"),
			entry("new stop", 0, "2026-01-03T00:00:00Z"),
			entry("old stop", 0, "2026-01-01T00:00:00Z"),
			entry("low stop", 0, "2026-01-01T00:00:00Z", "low"),
			entry("high review", 3, "2026-01-02T00:00:00Z", "high", "completed"),
			// Same urgency: the agenda lists a card awaiting approval before a
			// failed one, whatever their age.
			entry(
				"blocked plan",
				0,
				"2026-01-04T00:00:00Z",
				undefined,
				"pending_approval",
			),
		];
		expect(entries.sort(compareFactoryNeedsYou).map((item) => item.id)).toEqual(
			[
				"high review",
				"blocked plan",
				"old stop",
				"new stop",
				"question",
				"low stop",
			],
		);
	});
});
