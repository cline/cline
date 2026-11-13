import { describe, expect, test } from "bun:test";
import {
	gradeManager,
	gradeScoper,
	type ManagerToolCall,
	type ManagerTrial,
	requestedPriority,
	type ScoperTrial,
} from "./grade";

const scoper = (outcome: ScoperTrial["outcome"]): ScoperTrial => ({
	suite: "scoper",
	scenarioId: "s",
	trial: 1,
	outcome,
	seconds: 1,
	modelRequests: 1,
	designerRuns: 1,
	formatRetries: 0,
	toolCalls: {},
});

const manager = (fields: Partial<ManagerTrial> = {}): ManagerTrial => ({
	suite: "manager",
	scenarioId: "m",
	trial: 1,
	outcome: "1 card",
	seconds: 1,
	modelRequests: 1,
	toolCalls: [],
	cards: [{ title: "A", project: "storefront" }],
	priorityConfirmations: [],
	questions: [],
	seeded: [],
	judgeSessions: 0,
	...fields,
});

const call = (name: string, input: unknown): ManagerToolCall => ({
	name,
	input,
});

describe("gradeScoper", () => {
	test("passes only the expected outcome; a withdrawn breakdown matches neither", () => {
		expect(gradeScoper("plan", scoper("plan"))?.pass).toBe(true);
		expect(gradeScoper("split", scoper("plan"))?.pass).toBe(false);
		expect(gradeScoper("plan", scoper("split_withdrawn_then_plan"))?.pass).toBe(
			false,
		);
		expect(
			gradeScoper("split", scoper("split_withdrawn_then_plan"))?.pass,
		).toBe(false);
	});

	test("does not grade either-scenarios or the harness's own outcomes", () => {
		expect(gradeScoper("either", scoper("split"))).toBeUndefined();
		expect(gradeScoper("plan", scoper("aborted"))).toBeUndefined();
		expect(gradeScoper("plan", scoper("harness_error"))).toBeUndefined();
		expect(gradeScoper("plan", scoper("timeout"))?.pass).toBe(false);
	});
});

describe("gradeManager", () => {
	test("checks the card count against a number or a range", () => {
		expect(gradeManager({ cardsFiled: 1 }, manager())?.pass).toBe(true);
		expect(gradeManager({ cardsFiled: 2 }, manager())?.reasons).toEqual([
			"expected 2 card(s), got 1",
		]);
		expect(
			gradeManager({ cardsFiled: { min: 0, max: 1 } }, manager())?.pass,
		).toBe(true);
	});

	test("checks every card's project and deliverable", () => {
		const trial = manager({
			cards: [
				{ title: "A", project: "storefront", deliverable: "pr_review" },
				{ title: "B", project: "billing-service" },
			],
		});
		expect(
			gradeManager(
				{ cardsFiled: 2, project: "storefront", deliverable: "pr_review" },
				trial,
			)?.reasons,
		).toEqual(['"B" filed in billing-service', '"B" delivers change']);
	});

	test("grades the priority the model asked for, filing or by factory_status", () => {
		const urgent = manager({
			toolCalls: [
				call("factory", { title: "A", priority: "high" }),
				call("factory_status", { action: "priority", priority: "urgent" }),
			],
		});
		expect(
			gradeManager({ cardsFiled: 1, priority: "urgent" }, urgent)?.pass,
		).toBe(true);
		expect(
			gradeManager({ cardsFiled: 1, priorityNot: "urgent" }, urgent)?.pass,
		).toBe(false);
		expect(
			gradeManager({ cardsFiled: 1, priority: "urgent" }, manager())?.reasons,
		).toEqual(["expected priority urgent, asked for none"]);
	});

	test("allowDuplicate false looks only at the first filing", () => {
		const insisted = manager({
			toolCalls: [
				call("factory", { title: "A" }),
				call("factory", { title: "A", allow_duplicate: true }),
			],
		});
		expect(
			gradeManager({ cardsFiled: 1, allowDuplicate: false }, insisted)?.pass,
		).toBe(true);
		const eager = manager({
			toolCalls: [call("factory", { title: "A", allow_duplicate: true })],
		});
		expect(
			gradeManager({ cardsFiled: 1, allowDuplicate: false }, eager)?.pass,
		).toBe(false);
	});

	test("read-only: no filing and at least one of the named tools", () => {
		const expectation = {
			cardsFiled: 0,
			noFiling: true as const,
			calledTools: ["factory_status", "factory_list"],
		};
		expect(
			gradeManager(
				expectation,
				manager({ cards: [], toolCalls: [call("factory_list", {})] }),
			)?.pass,
		).toBe(true);
		expect(
			gradeManager(
				expectation,
				manager({ cards: [], toolCalls: [call("factory", { title: "A" })] }),
			)?.reasons,
		).toEqual([
			"called none of factory_status, factory_list",
			"called factory 1 time(s)",
		]);
	});

	test("mentionsSeeded accepts the short id or the title", () => {
		const seeded = [{ shortId: "F1", title: "Dark mode toggle" }];
		const grade = (finalText: string) =>
			gradeManager(
				{ cardsFiled: 0, mentionsSeeded: true },
				manager({ cards: [], seeded, finalText }),
			)?.pass;
		expect(grade("F1 already covers this.")).toBe(true);
		expect(grade("The dark mode toggle card covers it.")).toBe(true);
		expect(grade("Done.")).toBe(false);
	});

	test("does not grade either-scenarios or aborted trials", () => {
		expect(gradeManager("either", manager())).toBeUndefined();
		expect(
			gradeManager({ cardsFiled: 1 }, manager({ outcome: "aborted" })),
		).toBeUndefined();
	});
});

test("requestedPriority ignores factory_status calls that are not priority actions", () => {
	expect(
		requestedPriority([
			call("factory_status", { action: "hold", priority: "urgent" }),
			call("factory", { priority: "low" }),
		]),
	).toBe("low");
});
