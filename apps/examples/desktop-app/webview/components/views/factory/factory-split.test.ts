import type { AgendaTaskRecord } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { factorySplitContext } from "./factory-split";

const record = (extra: object = {}) =>
	({
		taskId: "parent",
		title: "Export and link activity",
		status: "completed",
		factorySplit: {
			splitId: "split-1",
			revision: 1,
			approvedAt: "2026-11-12T00:00:00.000Z",
			goal: "Export and link activity",
			parts: [
				{
					title: "Add CSV export",
					brief: "Export.",
					paths: ["src/export"],
					dependsOn: [],
					taskId: "p1",
				},
			],
			...extra,
		},
	}) as unknown as AgendaTaskRecord;

describe("a parent's part with no card", () => {
	it.each([
		["is being created before every part exists", {}, "Being created"],
		[
			"was not created once the rest were cancelled",
			{ cancelledAt: "2026-11-12T00:01:00.000Z" },
			"Not created",
		],
		[
			"was removed after every part existed",
			{ createdAt: "2026-11-12T00:00:01.000Z" },
			"Removed",
		],
	])("%s", (_name, extra, missing) => {
		const context = factorySplitContext(record(extra), {
			tasks: new Map(),
			links: {},
			card: () => {
				throw new Error("no other card is listed");
			},
		});
		expect(context?.parts?.[0]).toMatchObject({ number: 1, missing });
	});
});
