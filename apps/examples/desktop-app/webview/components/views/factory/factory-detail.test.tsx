// @vitest-environment jsdom
import type { AgendaTaskRecord, AgendaTaskRunRecord } from "@cline/shared";
import { factoryRunStateSchema } from "@cline/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FeatureDetail } from "./factory-detail";

const mocks = vi.hoisted(() => ({
	getFactoryTask: vi.fn<() => Promise<{ runs: AgendaTaskRunRecord[] }>>(),
	updateAgendaTask: vi.fn(),
	invoke: vi.fn(async (_command: string): Promise<unknown> => []),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: mocks,
	openExternalUrl: vi.fn(),
}));

const task: AgendaTaskRecord = {
	taskId: "feature",
	title: "Search notes",
	instructions: "# Search plan\n\nUse **titles**.",
	type: "todo",
	scope: "workspace",
	workspaceRoot: "/repo",
	status: "approved",
	resourcePaths: [],
	priority: 2,
	availableAt: "2026-01-01T00:00:00Z",
	expiresAt: "2027-01-01T00:00:00Z",
	automationEligible: false,
	revision: 1,
	createdBy: { kind: "user" },
	updatedBy: { kind: "user" },
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	factory: {
		execution: "local",
		approval: "required",
		maxRepairRounds: 2,
		checks: [
			{ name: "API", command: "node check.mjs", kind: "api", artifacts: [] },
		],
		publishPullRequest: false,
	},
};
const run: AgendaTaskRunRecord = {
	runId: "run",
	taskId: task.taskId,
	taskRevision: 1,
	attempt: 1,
	status: "completed",
	claimedAt: task.createdAt,
	createdAt: task.createdAt,
	updatedAt: task.updatedAt,
	factory: factoryRunStateSchema.parse({
		phase: "ready",
		repairRound: 0,
		sessions: [{ role: "verifier", sessionId: "verifier" }],
		workspace: {
			path: "/candidate",
			branch: "feat/example",
			baseBranch: "main",
			baseCommit: "base",
		},
		candidate: {
			commit: "candidate",
			checks: [],
			reviews: [],
			verification: {
				sessionId: "verifier",
				review: {
					verdict: "pass",
					summary: "## Browser results\n\nThe **search** works.",
					findings: ["Checked `empty` state."],
					coverage: { static: [], exercised: ["browser"], unverified: [] },
				},
				artifacts: [
					{
						path: "screen.png",
						label: "Browser screenshot",
						mimeType: "image/png",
					},
				],
			},
		},
	}),
};
let root: Root;
let container: HTMLDivElement;
const onOpenSession = vi.fn(async () => {});
beforeEach(() => {
	vi.clearAllMocks();
	mocks.getFactoryTask.mockResolvedValue({ runs: [] });
	mocks.invoke.mockResolvedValue([]);
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	HTMLElement.prototype.scrollTo = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function render(value: AgendaTaskRecord) {
	await act(async () =>
		root.render(
			<Dialog open>
				<DialogContent>
					<FeatureDetail
						task={value}
						onRefresh={vi.fn(async () => {})}
						onOpenSession={onOpenSession}
						questions={[
							{
								requestId: "q",
								sessionId: "designer",
								question: "Which title?",
								options: [],
								createdAt: task.createdAt,
							},
						]}
						onAnswer={vi.fn(async () => {})}
					/>
				</DialogContent>
			</Dialog>,
		),
	);
}
function button(text: string) {
	const item = [...document.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === text,
	);
	if (!item) throw new Error(`Missing button: ${text}`);
	return item;
}
async function tab(text: string) {
	await act(async () => {
		const item = button(text);
		item.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
		item.click();
	});
}
it("previews Markdown, preserves draft edits across tabs, and retains revision conflict handling", async () => {
	await render(task);
	expect(
		document.querySelector('[data-streamdown="heading-1"]')?.textContent,
	).toBe("Search plan");
	expect(
		document.querySelector('textarea[aria-label="Design brief"]'),
	).toBeNull();
	await act(async () => button("Edit").click());
	const editor = document.querySelector('textarea[aria-label="Design brief"]');
	if (!(editor instanceof HTMLTextAreaElement))
		throw new Error("Missing plan editor");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(editor, "# My draft");
		editor.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await act(async () => button("Preview").click());
	expect(document.body.textContent).toContain("Unsaved draft");
	await tab("Verification");
	expect(document.body.textContent).toContain("Which title?");
	expect(document.body.textContent).toContain(
		"No verification has been recorded yet.",
	);
	await tab("Plan");
	expect(
		document.querySelector('[data-streamdown="heading-1"]')?.textContent,
	).toBe("My draft");
	expect(mocks.getFactoryTask).toHaveBeenCalledTimes(1);
	await render({ ...task, revision: 2, instructions: "# Agent revision" });
	expect(
		document.querySelector('[data-streamdown="heading-1"]')?.textContent,
	).toBe("My draft");
	expect(document.body.textContent).toContain("The agent saved a newer brief");
	mocks.updateAgendaTask.mockRejectedValueOnce(new Error("Revision conflict"));
	await act(async () => button("Save brief").click());
	expect(mocks.updateAgendaTask).toHaveBeenCalledWith(
		expect.objectContaining({
			expectedRevision: 1,
			instructions: "# My draft",
		}),
	);
	expect(document.body.textContent).toContain("Revision conflict");
	await act(async () => button("Load saved brief").click());
	expect(
		document.querySelector('[data-streamdown="heading-1"]')?.textContent,
	).toBe("Agent revision");
});

it("renders saved reports, opens the exact role session, and keeps failed or late evidence honest", async () => {
	let resolveOld = (_value: { runs: AgendaTaskRunRecord[] }) => {};
	mocks.getFactoryTask.mockReturnValueOnce(
		new Promise((resolve) => {
			resolveOld = resolve;
		}),
	);
	const completed = { ...task, status: "completed" as const, lastRunId: "run" };
	await render(completed);
	await tab("Verification");
	expect(document.body.textContent).toContain("Loading verification…");
	mocks.getFactoryTask.mockResolvedValueOnce({ runs: [run] });
	await render({ ...completed, revision: 2 });
	expect(
		document.querySelector('[data-streamdown="heading-2"]')?.textContent,
	).toBe("Browser results");
	expect(document.body.textContent).toContain(
		"previous execution — not current evidence",
	);
	expect(document.body.textContent).not.toContain("Check off this result");
	await act(async () => button("Open agent verification session").click());
	expect(onOpenSession).toHaveBeenCalledWith("verifier");
	await act(async () => resolveOld({ runs: [{ ...run, taskRevision: 2 }] }));
	expect(document.body.textContent).toContain(
		"previous execution — not current evidence",
	);
	mocks.invoke.mockRejectedValueOnce(new Error("Artifact unavailable"));
	await act(async () => button("Browser screenshot").click());
	expect(document.body.textContent).toContain("Artifact unavailable");
	mocks.getFactoryTask.mockRejectedValueOnce(
		new Error("Evidence refresh failed"),
	);
	await render({ ...completed, revision: 3 });
	expect(document.body.textContent).toContain("Evidence refresh failed");
	expect(document.body.textContent).toContain("cached; refresh failed");
	expect(document.body.textContent).not.toContain("Check off this result");
});
