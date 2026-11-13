// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
	defaultFactoryPanelTab,
	FACTORY_NARROW_CARD,
	FactoryArtifactPanel,
	FactoryChangesPane,
	FactoryCopyPathButton,
	type FactoryPanelCard,
	FactoryStageRows,
	factoryKnownSessions,
	useFactoryPanelTab,
} from "./factory-artifact-panel";

vi.mock("@/lib/desktop-client", () => ({
	// The diff never arrives: these tests only read the pane's header.
	desktopClient: { invoke: vi.fn(() => new Promise(() => {})) },
	openExternalUrl: vi.fn(),
}));

const idle: FactoryPanelCard = {
	working: false,
	delivered: false,
	needsReview: false,
	openFindings: false,
	failed: false,
	hasRun: false,
};

describe("defaultFactoryPanelTab", () => {
	it.each([
		["hands-off work not started", undefined, idle, null],
		["scoping", undefined, { ...idle, working: true }, "live"],
		["building", "build", { ...idle, working: true, hasRun: true }, "live"],
		["verifying", "verify", { ...idle, hasRun: true }, "live"],
		["reviewing", "review", { ...idle, hasRun: true }, "live"],
		[
			"delivered",
			"deliver",
			{ ...idle, delivered: true, hasRun: true },
			"changes",
		],
		[
			"needs review",
			"deliver",
			{ ...idle, delivered: true, needsReview: true, hasRun: true },
			"changes",
		],
		[
			"draft PR open with findings",
			"deliver",
			{ ...idle, failed: true, openFindings: true, hasRun: true },
			"changes",
		],
		["failed", "build", { ...idle, failed: true, hasRun: true }, "checks"],
		["scoping stopped", undefined, { ...idle, failed: true }, null],
		[
			"an earlier attempt's evidence",
			undefined,
			{ ...idle, hasRun: true },
			"checks",
		],
	] as const)("%s", (_name, stage, card, expected) => {
		expect(defaultFactoryPanelTab(stage, card)).toBe(expected);
	});
});

describe("factoryKnownSessions", () => {
	it("keeps finished sessions, the latest plan checkers and the latest round per role, oldest first", () => {
		const attempt = (
			sessionId: string,
			role: "builder" | "reviewer",
			repairRound: number,
			status: "running" | "completed",
		) =>
			({
				id: sessionId,
				key: sessionId,
				role,
				repairRound,
				createdAt: "2026-01-01T00:00:00Z",
				sessionId,
				instructions: "Work.",
				agent: {},
				status,
				...(status === "completed"
					? { summary: "Done.", completedAt: "2026-01-01T00:05:00Z" }
					: {}),
			}) as const;
		const sessions = factoryKnownSessions({
			task: {
				revision: 2,
				factoryDesignProgress: {
					phase: "complete",
					revision: 2,
					reviewerSessions: [
						{ reviewerIndex: 0, sessionId: "checker-old" },
						{ reviewerIndex: 0, sessionId: "checker" },
					],
				} as never,
			},
			designSession: "designer",
			state: {
				sessions: [],
				attempts: [
					attempt("builder-0", "builder", 0, "completed"),
					attempt("reviewer-0", "reviewer", 0, "completed"),
					attempt("builder-1", "builder", 1, "running"),
				],
			} as never,
		});
		expect(sessions.map((session) => session.sessionId)).toEqual([
			"designer",
			"checker",
			"reviewer-0",
			"builder-1",
		]);
	});

	it("names a repository stage's session by its stage, as its own lane", () => {
		const sessions = factoryKnownSessions({
			task: { revision: 1 },
			designSession: undefined,
			state: {
				sessions: [],
				stagePlan: {
					stages: [
						{
							hash: "a",
							stage: {
								id: "security-scan",
								name: "Security scan",
								kind: "agent",
								instruction: "Scan.",
							},
						},
					],
					unapproved: [],
				},
				attempts: [
					{
						id: "stage-0",
						key: "stage:security-scan:0:abc",
						role: "reviewer",
						stageId: "security-scan",
						repairRound: 0,
						createdAt: "2026-01-01T00:00:00Z",
						sessionId: "stage-0",
						instructions: "Scan.",
						agent: {},
						status: "running",
					},
					{
						id: "reviewer-1",
						key: "reviewer-1",
						role: "reviewer",
						repairRound: 1,
						createdAt: "2026-01-01T00:01:00Z",
						sessionId: "reviewer-1",
						instructions: "Review.",
						agent: {},
						status: "running",
					},
				],
			} as never,
		});
		expect(
			sessions.map((session) => [session.sessionId, session.stage]),
		).toEqual([
			["stage-0", "Security scan"],
			["reviewer-1", undefined],
		]);
	});
});

function PersistedPanel({ taskId }: { taskId: string }) {
	const [tab, setTab] = useFactoryPanelTab(taskId, "live");
	if (!tab) return null;
	return (
		<FactoryArtifactPanel
			tab={tab}
			onTabChange={setTab}
			panes={{
				live: <p>live pane</p>,
				changes: <p>changes pane</p>,
				checks: <p>checks pane</p>,
				pr: <p>pr pane</p>,
			}}
		/>
	);
}

it("keeps the chosen tab per card for the session", async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	sessionStorage.clear();
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => root.render(<PersistedPanel taskId="a" />));
	expect(container.textContent).toContain("live pane");
	expect(container.textContent).not.toContain("changes pane");
	const tab = [...container.querySelectorAll('[role="tab"]')].find(
		(item) => item.textContent === "Checks",
	);
	await act(async () => {
		tab?.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
	});
	expect(container.textContent).toContain("checks pane");
	expect(sessionStorage.getItem("factory.panelTab.a")).toBe("checks");
	await act(async () => root.render(<PersistedPanel key="b" taskId="b" />));
	expect(container.textContent).toContain("live pane");
	await act(async () => root.render(<PersistedPanel key="a" taskId="a" />));
	expect(container.textContent).toContain("checks pane");
	await act(async () => root.unmount());
	container.remove();
});

it("switches to two columns at 700px of card width", () => {
	expect(FACTORY_NARROW_CARD).toBe(700);
});

it("shows the branch and short commit above the diff; the worktree path is only in Details", async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const writeText = vi.fn(async () => {});
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	const worktree =
		"/Users/someone/native-profile/data/db/factory/factory-worktrees/abc/repo";
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () =>
		root.render(
			<FactoryChangesPane
				taskId="task"
				runId="run"
				commit="98a6076eae00f00d"
				workspacePath={worktree}
				branch="feat/factory-c246d13addded7faf96585c0"
				onClose={vi.fn()}
			/>,
		),
	);
	const header = container.querySelector(
		'[data-testid="factory-changes-branch"]',
	);
	expect(header?.textContent).toContain(
		"feat/factory-c246d13addded7faf96585c0",
	);
	expect(header?.textContent).toContain("98a6076");
	expect(header?.textContent).not.toContain("98a6076eae00");
	expect(container.textContent).not.toContain(worktree);
	// The branch truncates on one line instead of wrapping mid-hash.
	const branch = header?.querySelector('[title^="feat/"]');
	expect(branch?.className).toContain("truncate");
	// The copy action moved to More → Details.
	expect(
		container.querySelector('button[aria-label="Copy worktree path"]'),
	).toBeNull();
	await act(async () => root.render(<FactoryCopyPathButton path={worktree} />));
	const copy = container.querySelector<HTMLButtonElement>(
		'button[aria-label="Copy worktree path"]',
	);
	await act(async () => copy?.click());
	expect(writeText).toHaveBeenCalledWith(worktree);
	expect(copy?.textContent).toContain("Copied");
	await act(async () => root.unmount());
	container.remove();
});

describe("FactoryStageRows", () => {
	it("lists stage results under the checks, with skipped reasons and unapproved stages", async () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		const base = { kind: "command" as const, hash: "h", blocking: true };
		await act(async () =>
			root.render(
				<FactoryStageRows
					stages={[
						{
							...base,
							id: "todo",
							name: "No TODO left",
							status: "failed",
							command: "! git diff | grep TODO",
							exitCode: 1,
							reason: "exit 1: src/a.ts:+// TODO",
							output: "src/a.ts:+// TODO",
						},
						{
							...base,
							id: "docs",
							name: "Docs links",
							status: "skipped",
							reason: "no matching files",
						},
					]}
					unapproved={[
						{
							id: "scan",
							name: "Security scan",
							reason: "its definition is not approved yet",
						},
					]}
					taskId="t"
					runId="r"
					commit="c"
				/>,
			),
		);
		const rows = [...container.querySelectorAll("li")].map(
			(row) => row.textContent,
		);
		expect(rows[0]).toContain("No TODO left");
		expect(rows[0]).toContain("failed");
		expect(rows[0]).toContain("! git diff | grep TODO");
		// Failed output is open; it is what the user came for.
		expect(rows[0]).toContain("Hide output · exit 1");
		expect(rows[1]).toContain("Skipped: no matching files");
		expect(rows[2]).toContain("Security scan");
		expect(rows[2]).toContain("Needs approval");
		// The output toggle is a disclosure naming the output it opens.
		const toggle = container.querySelector<HTMLButtonElement>(
			"button[aria-expanded]",
		);
		const outputId = toggle?.getAttribute("aria-controls");
		expect(toggle?.getAttribute("aria-expanded")).toBe("true");
		expect(outputId && document.getElementById(outputId)).toBeTruthy();
		await act(async () => toggle?.click());
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");
		expect(toggle?.textContent).toBe("Show output · exit 1");
		await act(async () =>
			root.render(
				<FactoryStageRows
					stages={undefined}
					unapproved={[]}
					taskId="t"
					runId="r"
					commit="c"
				/>,
			),
		);
		expect(container.textContent).toBe("");
		await act(async () => root.unmount());
		container.remove();
	});
});
