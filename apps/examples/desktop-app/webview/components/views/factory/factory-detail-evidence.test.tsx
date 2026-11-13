// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
	AcceptanceResults,
	acceptanceSummary,
	CheckResultSummary,
	ReviewResult,
	summarizeFactoryError,
} from "./factory-detail-evidence";

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: vi.fn(async () => ({})) },
}));

describe("summarizeFactoryError", () => {
	it("keeps a short structured summary as the headline with nothing to unfold", () => {
		expect(summarizeFactoryError("Checks did not pass.")).toEqual({
			headline: "Checks did not pass.",
			checks: [],
		});
	});

	it("splits a long raw log into a first-sentence headline, per-check lines and details", () => {
		const text = [
			"Required checks failed. The run stopped after 2 repair rounds.",
			"- “API tests”: failed exit 1",
			"Lint: blocked; Types: failed",
			"error: failed to compile",
			"=== RUN   TestSearch",
			"--- PASS: TestSearch (0.00s)",
		].join("\n");
		const summary = summarizeFactoryError(text);
		expect(summary.headline).toBe("Required checks failed.");
		expect(summary.checks).toEqual([
			{ name: "API tests", status: "failed", detail: "exit 1" },
			{ name: "Lint", status: "blocked" },
			{ name: "Types", status: "failed" },
		]);
		expect(summary.details).toBe(text);
	});

	it("names the failed checks when the text starts with one, and caps a run-on headline", () => {
		expect(summarizeFactoryError("API: failed\nLint: failed").headline).toBe(
			"2 checks did not pass.",
		);
		const headline = summarizeFactoryError("x".repeat(500)).headline;
		expect(headline).toHaveLength(200);
		expect(headline.endsWith("…")).toBe(true);
	});
});

describe("CheckResultSummary", () => {
	async function render(element: ReactElement) {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		await act(async () => root.render(element));
		return {
			container,
			unmount: async () => {
				await act(async () => root.unmount());
				container.remove();
			},
		};
	}

	it("names what a passing check could not capture beside its result", async () => {
		const view = await render(
			<CheckResultSummary
				check={{
					name: "UI evidence",
					status: "passed",
					limitations: ["evidence file not captured"],
				}}
			/>,
		);
		expect(view.container.textContent).toContain("passed");
		expect(
			view.container.querySelector('[data-testid="factory-check-limitations"]')
				?.textContent,
		).toBe("Passed, but did not check: evidence file not captured");
		await view.unmount();
	});

	it("shows a check blocked by its own setup as a plan problem with Edit plan", async () => {
		const onEditPlan = vi.fn();
		const view = await render(
			<CheckResultSummary
				check={{
					name: "Screenshot",
					status: "blocked",
					blockedBy: "configuration",
				}}
				onEditPlan={onEditPlan}
			/>,
		);
		const text = view.container.textContent ?? "";
		expect(text).toContain("Plan problem");
		expect(text).toContain("This check's setup needs fixing in the plan");
		expect(text).not.toContain("blocked");
		const edit = Array.from(view.container.querySelectorAll("button")).find(
			(button) => button.textContent === "Edit plan",
		);
		await act(async () => edit?.click());
		expect(onEditPlan).toHaveBeenCalledOnce();
		await view.unmount();

		const failed = await render(
			<CheckResultSummary check={{ name: "API", status: "failed" }} />,
		);
		expect(failed.container.textContent).toContain("failed");
		expect(failed.container.textContent).not.toContain("Plan problem");
		await failed.unmount();
	});
});

describe("AcceptanceResults", () => {
	const criteria = [
		{ id: "api", text: "API finds titles", required: true, check: "api" },
		{
			id: "copy",
			text: "Copy reads well; the build cannot check this",
			required: true,
			check: "api",
		},
		{ id: "ui", text: "The list shows results", required: true },
	];
	const candidate = {
		checks: [
			{
				name: "api",
				kind: "test" as const,
				command: "run",
				status: "passed" as const,
				exitCode: 0,
				output: "",
				artifacts: [],
			},
		],
		verification: undefined,
	};
	async function renderResults(inProgress: boolean) {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		await act(async () =>
			root.render(
				<AcceptanceResults
					criteria={criteria}
					candidate={candidate}
					inProgress={inProgress}
				/>,
			),
		);
		const outcomes = [...container.querySelectorAll("li[data-outcome]")].map(
			(item) => item.getAttribute("data-outcome"),
		);
		const text = container.textContent ?? "";
		await act(async () => root.unmount());
		container.remove();
		return { outcomes, text };
	}

	it("never shows a requirement the build cannot check as passed", async () => {
		const { outcomes, text } = await renderResults(false);
		expect(outcomes).toEqual(["passed", "uncheckable", "unverified"]);
		expect(text).toContain("not checked");
		expect(acceptanceSummary(criteria, candidate)).toBe(
			"1/3 required proven · 1 unverified · 1 not checked",
		);
		// The plan's criterion ids stay internal.
		for (const id of ["copy", "ui"])
			expect(text).not.toMatch(new RegExp(`\\b${id}\\b`));
	});

	it("fills in as a checklist while work runs: no result yet is not unverified", async () => {
		const { outcomes } = await renderResults(true);
		expect(outcomes).toEqual(["passed", "uncheckable", "pending"]);
	});
});

describe("ReviewResult", () => {
	it("says passed or asked for changes, never the raw verdict", async () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const pills = async (verdict: "pass" | "changes_requested") => {
			await act(async () =>
				root.render(
					<ReviewResult
						label="App test"
						review={{ verdict, summary: "Works.", findings: [] }}
						sessionId="s"
						onOpenSession={vi.fn(async () => {})}
						collapsed
					/>,
				),
			);
			return container.querySelector("summary")?.textContent ?? "";
		};
		expect(await pills("pass")).toMatch(/^passedApp test/);
		expect(await pills("changes_requested")).toMatch(
			/^asked for changesApp test/,
		);
		await act(async () => root.unmount());
		container.remove();
	});
});
