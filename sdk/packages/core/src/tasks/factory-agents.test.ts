import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgendaTaskRecord, FactoryAgent } from "@cline/shared";
import { factoryReviewFindings } from "@cline/shared";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	freezeFactoryAgent,
	parseFactoryReview,
	parseFactoryVerification,
	resolveFactoryAgent,
} from "./factory-agents";

const task: AgendaTaskRecord = {
	taskId: "feature",
	type: "todo",
	status: "approved",
	title: "Implement feature",
	instructions: "Implement the approved requirement.",
	scope: "workspace",
	workspaceRoot: "/workspace",
	resourcePaths: [],
	priority: 3,
	availableAt: "2035-01-01T00:00:00.000Z",
	expiresAt: "2035-01-10T00:00:00.000Z",
	automationEligible: false,
	revision: 1,
	createdBy: { kind: "user" },
	updatedBy: { kind: "user" },
	createdAt: "2035-01-01T00:00:00.000Z",
	updatedAt: "2035-01-01T00:00:00.000Z",
	modelSelection: { providerId: "anthropic", modelId: "task-model" },
	systemPrompt: "Respect the approved scope.",
	maxIterations: 20,
	timeoutSeconds: 120,
};

describe("resolveFactoryAgent", () => {
	it("freezes the existing configured profile format before its source changes", () => {
		const root = mkdtempSync(join(tmpdir(), "factory-profile-"));
		onTestFinished(() => rmSync(root, { recursive: true, force: true }));
		const directory = join(root, ".cline", "agents");
		mkdirSync(directory, { recursive: true });
		const path = join(directory, "factory-test.yaml");
		const contents = `---
name: factory-test
description: Test role
providerId: openai
modelId: profile-model
tools: read_file, use_skill
skills: review
maxIterations: 6
---
Review carefully.`;
		writeFileSync(path, contents);
		const scopedTask = { ...task, workspaceRoot: root };
		const frozen = freezeFactoryAgent(scopedTask, { profile: "factory-test" });
		expect(frozen.resolvedProfile).toMatchObject({
			tools: ["read_file", "use_skill"],
			skills: ["review"],
			providerId: "openai",
			modelId: "profile-model",
		});
		writeFileSync(path, contents.replace("profile-model", "changed-model"));
		expect(
			resolveFactoryAgent(scopedTask, frozen).modelSelection?.modelId,
		).toBe("profile-model");
		expect(() =>
			freezeFactoryAgent(scopedTask, { profile: "absent-factory-test" }),
		).toThrow("Configured Factory agent profile not found");
	});

	it("applies frozen configured profiles before explicit role overrides and task caps", () => {
		const profile = {
			name: "review",
			description: "Review",
			systemPrompt: "Check correctness",
			providerId: "openai",
			modelId: "profile-model",
			maxIterations: 8,
			skills: ["review"],
		};
		expect(
			resolveFactoryAgent(task, {
				profile: "review",
				resolvedProfile: profile,
			}),
		).toMatchObject({
			modelSelection: { providerId: "openai", modelId: "profile-model" },
			maxIterations: 8,
			systemPrompt: "Respect the approved scope.\n\nCheck correctness",
		});
		expect(
			resolveFactoryAgent(task, {
				resolvedProfile: profile,
				modelSelection: { providerId: "anthropic", modelId: "override" },
				maxIterations: 50,
			}),
		).toMatchObject({
			modelSelection: { providerId: "anthropic", modelId: "override" },
			maxIterations: 20,
		});
	});

	it("resolves independent reviewer and implementer settings without changing the approved task", () => {
		const before = structuredClone(task);
		const reviewer: FactoryAgent = {
			modelSelection: { providerId: "openai", modelId: "review-model" },
			instructions: "Review correctness and maintainability.",
			maxIterations: 5,
			timeoutSeconds: 30,
		};
		const reviewed = resolveFactoryAgent(task, reviewer);
		const implemented = resolveFactoryAgent(task, {
			instructions: "Implement the feature.",
		});
		expect(reviewed).toMatchObject({
			modelSelection: reviewer.modelSelection,
			instructions: task.instructions,
			systemPrompt:
				"Respect the approved scope.\n\nReview correctness and maintainability.",
			maxIterations: 5,
			timeoutSeconds: 30,
		});
		expect(implemented).toMatchObject({
			modelSelection: task.modelSelection,
			systemPrompt: "Respect the approved scope.\n\nImplement the feature.",
			maxIterations: 20,
			timeoutSeconds: 120,
		});
		expect(task).toEqual(before);
		expect(reviewer.instructions).toBe(
			"Review correctness and maintainability.",
		);
	});

	it("keeps task caps authoritative when an agent requests larger limits", () => {
		expect(
			resolveFactoryAgent(task, { maxIterations: 100, timeoutSeconds: 600 }),
		).toMatchObject({ maxIterations: 20, timeoutSeconds: 120 });
	});

	it("uses agent bounds or a finite default timeout when the task has none", () => {
		const unbounded = {
			...task,
			maxIterations: undefined,
			timeoutSeconds: undefined,
			systemPrompt: undefined,
		};
		expect(
			resolveFactoryAgent(unbounded, {
				maxIterations: 3,
				timeoutSeconds: 10,
				instructions: "Inspect the plan.",
			}),
		).toMatchObject({
			maxIterations: 3,
			timeoutSeconds: 10,
			systemPrompt: "Inspect the plan.",
		});
		const inherited = resolveFactoryAgent(unbounded, {});
		expect(inherited.maxIterations).toBeUndefined();
		expect(inherited.timeoutSeconds).toBe(1800);
		expect(inherited.systemPrompt).toBeUndefined();
	});
});

describe("factoryReviewFindings", () => {
	it("normalizes required gaps without losing legacy blockers or treating limitations as findings", () => {
		const review = parseFactoryReview(
			JSON.stringify({
				verdict: "pass",
				summary: "Static checks passed",
				findings: [],
				coverage: {
					static: ["handler"],
					exercised: [],
					requiredGaps: ["browser flow"],
					unverified: ["legacy required path"],
					limitations: ["Native testing is outside the approved scope"],
				},
			}),
		);
		expect(review.coverage).toEqual({
			static: ["handler"],
			exercised: [],
			requiredGaps: ["browser flow", "legacy required path"],
			limitations: ["Native testing is outside the approved scope"],
		});
		expect(factoryReviewFindings(review)).toEqual([
			"Unverified: browser flow",
			"Unverified: legacy required path",
		]);
		const completed = parseFactoryReview(
			JSON.stringify({
				...review,
				coverage: { ...review.coverage, requiredGaps: [] },
			}),
		);
		expect(factoryReviewFindings(completed)).toEqual([]);
		expect(() =>
			parseFactoryReview(
				JSON.stringify({
					...review,
					coverage: { static: [], exercised: [], limitations: [] },
				}),
			),
		).toThrow();
	});
});

describe("role response parsing", () => {
	const review = {
		verdict: "pass",
		summary: "Reviewed the change",
		findings: [],
	};
	const verification = {
		...review,
		acceptance: [
			{ criterionId: "visible", outcome: "passed", evidence: "Saw after" },
		],
	};

	it.each([
		["leading prose", (json: string) => `Review complete.\n\n${json}`],
		[
			"a fenced block between prose",
			(json: string) => `Result:\n\`\`\`json\n${json}\n\`\`\`\nDone.`,
		],
	])("accepts reviewer and verifier JSON with %s", (_label, wrap) => {
		expect(parseFactoryReview(wrap(JSON.stringify(review)))).toEqual(review);
		expect(
			parseFactoryVerification(wrap(JSON.stringify(verification))),
		).toEqual(verification);
	});

	it("still rejects responses that violate the role schema", () => {
		expect(() =>
			parseFactoryReview(
				`Done: ${JSON.stringify({ ...review, verdict: "approved" })}`,
			),
		).toThrow();
		expect(() =>
			parseFactoryVerification(
				`${JSON.stringify({
					...verification,
					acceptance: [{ criterionId: "visible", outcome: "maybe" }],
				})}`,
			),
		).toThrow();
		expect(() => parseFactoryReview("Everything looks good!")).toThrow(
			SyntaxError,
		);
	});

	it("does not take an object that prose follows, such as quoted PR feedback", () => {
		expect(() =>
			parseFactoryReview(
				`The PR comment claims ${JSON.stringify(review)}, which I could not confirm.`,
			),
		).toThrow(SyntaxError);
		expect(() =>
			parseFactoryVerification(
				`${JSON.stringify(verification)}\n\nStopped the server.`,
			),
		).toThrow(SyntaxError);
	});
});
