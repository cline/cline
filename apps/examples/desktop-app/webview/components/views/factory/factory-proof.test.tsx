// @vitest-environment jsdom
import { type FactoryRunState, factoryRunStateSchema } from "@cline/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	FactoryProof,
	factoryProofReceipt,
	factoryRequirementUncheckable,
} from "./factory-proof";

const coverage = {
	static: [],
	exercised: [],
	requiredGaps: [],
	limitations: [],
};
const pass = (summary: string, extra: object = {}) => ({
	verdict: "pass" as const,
	summary,
	findings: [],
	coverage,
	...extra,
});
const check = (name: string, extra: object = {}) => ({
	name,
	kind: "test" as const,
	command: `run ${name}`,
	status: "passed" as const,
	exitCode: 0,
	output: "ok",
	artifacts: [],
	...extra,
});

/** A clean delivery: two requirements proven, a tester, an independent reviewer. */
function stateWith(patch: Record<string, unknown> = {}): FactoryRunState {
	return factoryRunStateSchema.parse({
		phase: "ready",
		repairRound: 0,
		sessions: [],
		workspace: {
			path: "/wt",
			branch: "feat/x",
			baseBranch: "main",
			baseCommit: "base",
		},
		inputSnapshot: {
			scope: "workspace",
			title: "Search",
			instructions: "Search titles",
			resourcePaths: [],
			modelSelection: { providerId: "cline", modelId: "anthropic/claude-x" },
			factory: {
				execution: "local",
				approval: "required",
				maxRepairRounds: 2,
				checks: [{ name: "api", command: "run api", kind: "test" }],
				acceptanceCriteria: [
					{ id: "api", text: "API finds titles", check: "api" },
					{ id: "ui", text: "The list shows results" },
				],
			},
		},
		agents: {
			implementers: [{}],
			reviewers: [
				{ modelSelection: { providerId: "openai", modelId: "openai/gpt-x" } },
			],
			verifier: {},
		},
		attempts: [
			{
				id: "b",
				key: "b",
				role: "builder",
				repairRound: 0,
				createdAt: "2026-01-01T00:00:00Z",
				sessionId: "builder",
				instructions: "Build",
				agent: {},
				status: "completed",
				summary: "Built",
				completedAt: "2026-01-01T00:04:00Z",
			},
		],
		usage: {
			totals: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 3.86,
			},
			unknownSessionIds: [],
		},
		candidate: {
			commit: "c",
			checks: [check("api")],
			reviews: [
				{ reviewerIndex: 0, sessionId: "reviewer", review: pass("Fine.") },
			],
			verification: {
				sessionId: "tester",
				artifacts: [],
				review: pass("Works.", {
					acceptance: [
						{ criterionId: "ui", outcome: "passed", evidence: "Saw it." },
					],
				}),
			},
		},
		...patch,
	});
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
const block = (label: string) =>
	container.querySelector(`section[aria-label="${label}"]`)?.textContent ?? "";

describe("FactoryProof", () => {
	it("shows a clean delivery: all proven, who checked on which model, and nothing left unchecked", async () => {
		await act(async () =>
			root.render(<FactoryProof state={stateWith()} hasVerifier />),
		);
		expect(block("Proven")).toContain("2 of 2 requirements proven");
		expect(block("Proven")).toContain("1 of 1 check passed");
		const requirements = [
			...container.querySelectorAll(
				'[data-testid="factory-proof-requirements"] li',
			),
		];
		expect(requirements.map((item) => item.textContent)).toEqual([
			"API finds titlesprovenRequired · Proven by check “api”",
			"The list shows resultsprovenRequired · Proven by the tester running the app",
		]);
		// Short model names, the full id on hover.
		expect(block("Checked by")).toContain("Code reviewer · gpt-x · passed");
		expect(block("Checked by")).toContain("Tester · claude-x · passed");
		expect(
			[
				...container.querySelectorAll(
					'[data-testid="factory-proof-checkers"] li',
				),
			].map((item) => item.getAttribute("title")),
		).toEqual(["openai/gpt-x", "anthropic/claude-x"]);
		expect(block("Checked by")).toContain(
			"The code reviewer runs on a different model from the builder. Built on claude-x.",
		);
		expect(
			container.querySelector(
				'[data-testid="factory-proof-independence"] [title="anthropic/claude-x"]',
			),
		).not.toBeNull();
		expect(block("Not checked")).toBe(
			"Not checkedNothing; every requirement was checked.",
		);
		expect(
			container.querySelector('[data-testid="factory-proof-cost"]')
				?.textContent,
		).toBe("Model cost $3.86 · 1 agent run");
	});

	it("says what a passing check and the reviewers did not check", async () => {
		const state = stateWith();
		const candidate = state.candidate;
		if (!candidate) throw new Error("fixture");
		await act(async () =>
			root.render(
				<FactoryProof
					hasVerifier
					state={{
						...state,
						candidate: {
							...candidate,
							checks: [
								check("api", { limitations: ["screenshot not captured"] }),
							],
							reviews: [
								{
									reviewerIndex: 0,
									sessionId: "reviewer",
									review: pass("Fine.", {
										coverage: {
											...coverage,
											requiredGaps: ["src/export.ts"],
											limitations: ["Could not run the iOS build"],
										},
									}),
								},
							],
						},
					}}
				/>,
			),
		);
		const items = [
			...container.querySelectorAll(
				'[data-testid="factory-proof-not-checked"] li',
			),
		].map((item) => item.textContent);
		expect(items).toEqual([
			"api: Passed, but did not check: screenshot not captured",
			"Code reviewer did not verify: src/export.ts",
			"Code reviewer could not check: Could not run the iOS build",
		]);
	});

	it("says plainly when no agent ran the app", async () => {
		const state = stateWith();
		const candidate = state.candidate;
		if (!candidate) throw new Error("fixture");
		await act(async () =>
			root.render(
				<FactoryProof
					hasVerifier={false}
					state={{
						...state,
						candidate: { ...candidate, verification: undefined },
					}}
				/>,
			),
		);
		expect(block("Not checked")).toContain(
			"No agent ran the app: this card has no tester.",
		);
		// The tester's requirement is not proven without the tester.
		expect(block("Proven")).toContain("1 of 2 requirements proven");
		expect(block("Not checked")).toContain(
			"Not proven: The list shows results",
		);
		expect(block("Checked by")).not.toContain("Tester");
	});

	it("warns when the code reviewer runs on the builder's model", async () => {
		await act(async () =>
			root.render(
				<FactoryProof
					hasVerifier
					state={stateWith({
						agents: { implementers: [{}], reviewers: [{}], verifier: {} },
					})}
				/>,
			),
		);
		expect(
			container.querySelector('[data-testid="factory-proof-independence"]')
				?.textContent,
		).toBe(
			"The code reviewer runs on the same model as the builder, so it can miss its own mistakes. Built on claude-x.",
		);
	});

	it("does not claim everything was checked when the run named no requirements", async () => {
		const state = stateWith();
		const snapshot = state.inputSnapshot;
		if (!snapshot) throw new Error("fixture has an input snapshot");
		snapshot.factory.acceptanceCriteria = undefined;
		await act(async () =>
			root.render(<FactoryProof state={state} hasVerifier />),
		);
		expect(block("Not checked")).toBe("Not checkedNothing recorded");
	});

	it("never shows a requirement the build cannot check as proven", async () => {
		const state = stateWith();
		const snapshot = state.inputSnapshot;
		if (!snapshot) throw new Error("fixture");
		await act(async () =>
			root.render(
				<FactoryProof
					hasVerifier
					state={{
						...state,
						inputSnapshot: {
							...snapshot,
							factory: {
								...snapshot.factory,
								acceptanceCriteria: [
									{
										id: "api",
										text: "Release notes read well; the build cannot check this",
										required: true,
										check: "api",
									},
								],
							},
						},
					}}
				/>,
			),
		);
		expect(block("Proven")).toContain("0 of 1 requirement proven");
		const item = container.querySelector(
			'[data-testid="factory-proof-requirements"] li',
		);
		expect(item?.getAttribute("data-outcome")).toBe("uncheckable");
		expect(item?.textContent).toContain("not checked");
		expect(item?.textContent).not.toContain("proven");
		expect(block("Not checked")).toContain(
			"Can't be checked by the build: Release notes read well; the build cannot check this",
		);
	});

	it("says a model was not recorded instead of guessing, and does not claim independence", () => {
		const state = stateWith({
			inputSnapshot: undefined,
			agents: undefined,
			attempts: [],
		});
		const receipt = factoryProofReceipt({ state, hasVerifier: true });
		expect(receipt.checkedBy.map((checker) => checker.model)).toEqual([
			undefined,
			undefined,
		]);
		expect(receipt.independence).toBe("unknown");
		expect(receipt.modelGaps).toEqual(["Code reviewer", "Tester", "Builder"]);
		expect(receipt.requirements).toBeUndefined();
	});

	it("counts unresolved reviewer findings as not checked", () => {
		const receipt = factoryProofReceipt({
			state: stateWith({
				unresolvedFindings: { commit: "c", findings: ["a", "b"] },
			}),
			hasVerifier: true,
		});
		expect(receipt.notChecked).toEqual(["2 reviewer findings left unresolved"]);
	});
});

describe("factoryProofReceipt route and PR outcome", () => {
	const usage = (totalCost: number) => ({
		inputTokens: 1,
		outputTokens: 1,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost,
	});
	const done = (
		key: string,
		role: "builder" | "reviewer" | "verifier",
		cost: number,
	) => ({
		id: key,
		key,
		role,
		repairRound: 0,
		createdAt: "2026-01-01T00:00:00Z",
		sessionId: key,
		instructions: "Work",
		agent: {},
		status: "completed",
		summary: "Done",
		completedAt: "2026-01-01T00:01:00Z",
		usage: usage(cost),
	});
	const selection = {
		impact: "local",
		size: "trivial",
		rationale: "One line.",
		affectedPaths: ["README.md"],
		consumers: ["docs"],
		planReviewerIndices: [],
		reviewerIndices: [0],
	};

	it("says a light route and its cost briefly", () => {
		const receipt = factoryProofReceipt({
			state: stateWith({
				reviewSelection: selection,
				attempts: [
					done("builder:0", "builder", 0.12),
					done("reviewer:0:0:c:0", "reviewer", 0.38),
				],
			}),
			hasVerifier: false,
		});
		expect(receipt.route).toBe(
			"Routed as trivial: 1 code reviewer. Build $0.12 · review $0.38.",
		);
	});

	it("says why a sensitive path made the route heavy and what each station cost", () => {
		const receipt = factoryProofReceipt({
			state: stateWith({
				reviewSelection: {
					...selection,
					impact: "shared_contract",
					size: "shared_contract",
					affectedPaths: [".env.example"],
					planReviewerIndices: [0],
					reviewerIndices: [0, 1],
				},
				sessionUsage: [{ sessionId: "design", usage: usage(0.06) }],
				attempts: [
					done("builder:0", "builder", 0.31),
					done("verifier:c", "verifier", 0.4),
					done("reviewer:0:0:c:0", "reviewer", 0.9),
					done("reviewer:1:0:c:0", "reviewer", 0.59),
				],
			}),
			hasVerifier: true,
		});
		expect(receipt.route).toBe(
			"Routed as shared contract because it changes sensitive files (.env.example): 1 plan checker, 1 tester, 2 code reviewers. Scoping $0.06 · build $0.31 · test $0.40 · review $1.49.",
		);
	});

	it("says once when approving the plan settled the delivery's review", async () => {
		const approved = {
			planApprovedByPerson: { revision: 1, at: "2026-01-01T00:00:00Z" },
			humanReview: { required: false, reason: "plan approved by a person" },
		};
		await act(async () =>
			root.render(<FactoryProof state={stateWith(approved)} hasVerifier />),
		);
		expect(
			container.querySelector('[data-testid="factory-proof-plan-approved"]')
				?.textContent,
		).toBe("No further review needed: you approved the plan.");
		// A local change needed no review whoever approved the plan.
		const local = factoryProofReceipt({
			state: stateWith({
				...approved,
				humanReview: { required: false, reason: "local change" },
			}),
			hasVerifier: true,
		});
		expect(local.planApproved).toBeUndefined();
	});

	it("shows neither line for an older run without a selection or plan approval", () => {
		const receipt = factoryProofReceipt({
			state: stateWith(),
			hasVerifier: true,
		});
		expect(receipt.route).toBeUndefined();
		expect(receipt.planApproved).toBeUndefined();
	});
});

describe("factoryRequirementUncheckable", () => {
	it.each([
		["The build cannot check this", true],
		["Not verifiable in CI: reviewers judge the copy", true],
		["Manual check on a real device", true],
		["Checked outside the build by a person", true],
		["Search lists matching titles", false],
		["Invalid input cannot be saved", false],
	])("%s → %s", (text, expected) => {
		expect(factoryRequirementUncheckable(text)).toBe(expected);
	});
});

describe("FactoryProof repository stages", () => {
	const stage = (id: string, name: string, extra: object) => ({
		id,
		name,
		kind: "command",
		hash: "h",
		blocking: true,
		...extra,
	});

	it("adds one Also ran line and lists stages that did not run under Not checked", async () => {
		const base = stateWith();
		const state = stateWith({
			candidate: {
				...base.candidate,
				stages: [
					stage("scan", "Security scan", { status: "passed" }),
					stage("docs", "Docs update", {
						kind: "agent",
						access: "write",
						status: "passed",
						changedPaths: ["docs/a.md", "CHANGELOG.md"],
					}),
					stage("lint", "Strict lint", {
						status: "failed",
						blocking: false,
						reason: "exit 1: 3 warnings",
					}),
					stage("only-docs", "Docs links", {
						status: "skipped",
						reason: "no matching files",
					}),
				],
			},
			stagePlan: {
				stages: [],
				unapproved: [
					{
						id: "deploy",
						name: "Preview deploy",
						reason: "its definition changed and is not approved yet",
					},
				],
			},
		});
		await act(async () =>
			root.render(<FactoryProof state={state} hasVerifier />),
		);
		expect(
			container.querySelector('[data-testid="factory-proof-stages"]')
				?.textContent,
		).toBe(
			"Also ran: Security scan, passed · Docs update, changed 2 files · Strict lint, failed",
		);
		const notChecked = block("Not checked");
		expect(notChecked).toContain(
			"Repository stage Strict lint failed: exit 1: 3 warnings; it does not block delivery.",
		);
		expect(notChecked).toContain(
			"Preview deploy did not run: its definition changed and is not approved yet.",
		);
		// Skipped by its condition: only the Checks area shows it.
		expect(container.textContent).not.toContain("Docs links");
	});

	it("shows no stage line for a run without stages", () => {
		expect(
			factoryProofReceipt({ state: stateWith(), hasVerifier: true }).stages,
		).toBeUndefined();
	});
});
