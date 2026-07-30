import { describe, expect, it } from "vitest";
import {
	DEFAULT_SHOW_PLANNER_COOLDOWN_MS,
	planShowIntents,
	workCategoryFromKind,
} from "./planShowIntents.js";
import { showItemFromTemplate } from "./showTemplates.js";

describe("planShowIntents", () => {
	const owner = "agent-1";

	it("enqueues arch.overview on first_act", () => {
		const result = planShowIntents({
			signal: { kind: "first_act" },
			ownerParticipantId: owner,
			existingShowBacklog: [],
			nowMs: 1_000,
		});
		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.produce.templateId).toBe("arch.overview");
		expect(result.reasons[0]).toContain("planner:first_act:arch.overview");
	});

	it("maps test work to doc.plan and skips command/decision", () => {
		const test = planShowIntents({
			signal: { kind: "work", category: "test" },
			ownerParticipantId: owner,
			existingShowBacklog: [],
			nowMs: 1_000,
		});
		expect(test.items.map((i) => i.produce.templateId)).toEqual(["doc.plan"]);

		const command = planShowIntents({
			signal: { kind: "work", category: "command" },
			ownerParticipantId: owner,
			existingShowBacklog: [],
			nowMs: 1_000,
		});
		expect(command.items).toEqual([]);
	});

	it("dedupes templates already on the backlog", () => {
		const existing = showItemFromTemplate({
			templateId: "doc.plan",
			ownerParticipantId: owner,
			linkedDoItemId: "do-1",
		});
		expect(existing).not.toBeNull();
		const result = planShowIntents({
			signal: { kind: "work", category: "test" },
			ownerParticipantId: owner,
			existingShowBacklog: [existing!],
			nowMs: 1_000,
		});
		expect(result.items).toEqual([]);
		expect(result.skippedTemplateIds).toEqual(["doc.plan"]);
	});

	it("respects per-template cooldown", () => {
		const nowMs = 50_000;
		const result = planShowIntents({
			signal: { kind: "work", category: "edit" },
			ownerParticipantId: owner,
			existingShowBacklog: [],
			nowMs,
			cooldownMs: DEFAULT_SHOW_PLANNER_COOLDOWN_MS,
			lastEnqueuedAtByTemplate: {
				"walk.code": new Date(nowMs - 5_000).toISOString(),
			},
		});
		expect(result.items).toEqual([]);
		expect(result.skippedTemplateIds).toEqual(["walk.code"]);
	});

	it("is a no-op when mode is off", () => {
		const result = planShowIntents({
			signal: { kind: "plan_mode" },
			ownerParticipantId: owner,
			existingShowBacklog: [],
			nowMs: 1,
			mode: "off",
		});
		expect(result.items).toEqual([]);
		expect(result.reasons).toEqual(["planner_off"]);
	});

	it("maps work kinds to planner categories", () => {
		expect(workCategoryFromKind("test_result")).toBe("test");
		expect(workCategoryFromKind("edit")).toBe("edit");
	});
});
