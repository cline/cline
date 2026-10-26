// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PullRequestStatus } from "@/lib/pull-request";
import { PullRequestMenu } from "./pull-request-menu";

const { invoke, openExternalUrl } = vi.hoisted(() => ({
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	openExternalUrl,
}));
const data: PullRequestStatus = {
	repository: "cline/cline",
	branch: "feature",
	createUrl: "https://github.com/cline/cline/compare/main...feature?expand=1",
	pullRequest: {
		number: 42,
		title: "Feature",
		url: "https://github.com/cline/cline/pull/42",
		state: "OPEN",
		isDraft: false,
		mergeable: "CONFLICTING",
		mergeStateStatus: "DIRTY",
		additions: 1234,
		deletions: 12,
		checks: [
			{
				name: "Tests",
				state: "failure",
				url: "https://github.com/cline/cline/actions/runs/1",
			},
		],
	},
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.useFakeTimers();
	invoke.mockReset().mockResolvedValue(data);
	openExternalUrl.mockReset().mockResolvedValue(undefined);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});
async function render(cwd = "/repo", branch = "feature") {
	await act(async () =>
		root.render(<PullRequestMenu cwd={cwd} branch={branch} />),
	);
}
function trigger() {
	return container.querySelector<HTMLButtonElement>("#pull-request-menu");
}
async function openMenu() {
	await act(async () =>
		trigger()?.dispatchEvent(
			new MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		),
	);
}
function menuItem(text: string) {
	const item = [
		...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	].find((element) => element.textContent?.includes(text));
	if (!item) throw new Error(`Expected menu item "${text}"`);
	return item;
}
async function select(text: string) {
	await act(async () => menuItem(text).click());
}

it("opens the PR from the menu", async () => {
	await render();
	expect(trigger()?.getAttribute("aria-label")).toBe(
		"Pull request #42: Conflicts",
	);
	await openMenu();
	expect(document.body.textContent).toContain("Feature");
	expect(document.body.textContent).toContain("+1,234");
	expect(document.body.textContent).toContain("1 of 1 checks failed");
	await select("Open on GitHub");
	expect(openExternalUrl).toHaveBeenCalledWith(data.pullRequest?.url);
});

it("lists checks in a submenu, failures first, and opens a check", async () => {
	invoke.mockResolvedValue({
		...data,
		pullRequest: {
			...data.pullRequest,
			checks: [
				{ name: "Lint", state: "success" },
				...(data.pullRequest?.checks ?? []),
			],
		},
	});
	await render();
	await openMenu();
	await select("1 of 2 checks failed");
	const checks = [
		...document.body.querySelectorAll(
			'[data-slot="dropdown-menu-sub-content"] [role="menuitem"]',
		),
	].map((item) => item.textContent);
	expect(checks).toEqual(["Testsfailure", "Lintsuccess"]);
	await select("Tests");
	expect(openExternalUrl).toHaveBeenCalledWith(data.pullRequest?.checks[0].url);
});

it.each<{
	status: Partial<NonNullable<PullRequestStatus["pullRequest"]>>;
	label: string;
	color: string;
}>([
	{
		status: { mergeStateStatus: "BLOCKED" },
		label: "Blocked",
		color: "text-yellow-500",
	},
	{
		status: { mergeStateStatus: "BEHIND" },
		label: "Behind base",
		color: "text-yellow-500",
	},
	{
		status: { mergeStateStatus: "UNSTABLE" },
		label: "Checks failing",
		color: "text-red-400",
	},
	{
		status: { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" },
		label: "Merge status pending",
		color: "text-muted-foreground",
	},
	{
		status: { mergeStateStatus: "UNKNOWN" },
		label: "No conflicts",
		color: "text-muted-foreground",
	},
	{
		status: { mergeable: "CONFLICTING" },
		label: "Conflicts",
		color: "text-red-400",
	},
	{
		status: { isDraft: true, mergeable: "CONFLICTING" },
		label: "Draft",
		color: "text-muted-foreground",
	},
	{
		status: { state: "MERGED", mergeable: "CONFLICTING" },
		label: "Merged",
		color: "text-purple-400",
	},
	{
		status: { state: "CLOSED" },
		label: "Closed",
		color: "text-red-400",
	},
	{
		status: {},
		label: "Ready to merge",
		color: "text-green-500",
	},
])("uses $color for the $label label and PR icon", async ({
	status,
	label,
	color,
}) => {
	invoke.mockResolvedValue({
		...data,
		pullRequest: {
			...data.pullRequest,
			mergeable: "MERGEABLE",
			mergeStateStatus: "CLEAN",
			...status,
		},
	});
	await render();
	expect(trigger()?.querySelector("svg")?.classList.contains(color)).toBe(true);
	await openMenu();
	const statusLabel = [...document.body.querySelectorAll("span")].find(
		(element) => element.textContent === label,
	);
	expect(statusLabel?.classList.contains(color)).toBe(true);
});

it("offers the compare form when no PR exists", async () => {
	invoke.mockResolvedValue({ ...data, pullRequest: null });
	await render();
	expect(trigger()?.getAttribute("aria-label")).toBe("Create a pull request");
	await openMenu();
	await select("Create pull request");
	expect(openExternalUrl).toHaveBeenCalledWith(data.createUrl);
});

it("copies the branch name", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.assign(navigator, { clipboard: { writeText } });
	await render();
	await openMenu();
	await select("Copy branch name");
	expect(writeText).toHaveBeenCalledWith("feature");
});

it("renders nothing without a PR or compare form", async () => {
	invoke.mockResolvedValue({ ...data, pullRequest: null, createUrl: null });
	await render();
	expect(container.textContent).toBe("");
	expect(trigger()).toBeNull();
});

it("discards late responses after switching workspaces", async () => {
	let finish!: (value: PullRequestStatus) => void;
	invoke
		.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			}),
		)
		.mockResolvedValue(null);
	await render();
	await render("/other");
	await act(async () => finish(data));
	expect(container.textContent).toBe("");
});

it("refreshes and replaces stale status with an actionable error on failure", async () => {
	await render();
	invoke.mockRejectedValue(new Error("Check GitHub CLI access"));
	await act(async () => {
		await vi.advanceTimersByTimeAsync(30_000);
	});
	expect(trigger()?.getAttribute("aria-label")).toBe(
		"Pull request status unavailable",
	);
	await openMenu();
	expect(document.body.textContent).toContain("Check GitHub CLI access");
	invoke.mockResolvedValue(data);
	await select("Refresh status");
	expect(trigger()?.textContent).toContain("#42");
});

it("silently hides initial lookup failures and can recover on a later refresh", async () => {
	invoke.mockRejectedValue(new Error("GitHub unavailable"));
	await render();
	expect(trigger()).toBeNull();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(30_000);
	});
	expect(trigger()).toBeNull();
	invoke.mockResolvedValue(data);
	await refreshViaFocus();
	expect(trigger()?.textContent).toContain("#42");
});

it("keeps a dismissed error hidden through polling and focus until recovery", async () => {
	await render();
	invoke.mockRejectedValue(new Error("Connection failed"));
	await refreshViaFocus();
	await openMenu();
	expect(document.body.textContent).toContain("Connection failed");
	await select("Dismiss");
	expect(trigger()).toBeNull();
	await refreshViaFocus();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(30_000);
	});
	expect(trigger()).toBeNull();
	invoke.mockResolvedValue(data);
	await refreshViaFocus();
	expect(trigger()?.textContent).toContain("#42");
	invoke.mockRejectedValue(new Error("New connection failure"));
	await refreshViaFocus();
	await openMenu();
	expect(document.body.textContent).toContain("New connection failure");
});

it("hides a formerly working menu when GitHub becomes unavailable", async () => {
	await render();
	invoke.mockResolvedValue(null);
	await refreshViaFocus();
	expect(trigger()).toBeNull();
	invoke.mockRejectedValue(new Error("Connection failed"));
	await refreshViaFocus();
	expect(trigger()).toBeNull();
});

it("does not fetch for a non-repository", async () => {
	await render("/repo", "no-git");
	expect(invoke).not.toHaveBeenCalled();
	expect(container.textContent).toBe("");
});

function telemetryEvents() {
	return invoke.mock.calls
		.filter(([command]) => command === "capture_pull_request_event")
		.map(([, event]) => event);
}

it("reports exposure once per workspace/branch, without polling impressions", async () => {
	await render();
	expect(telemetryEvents()).toEqual([
		{
			action: "shown",
			prState: "open",
			ciState: "failure",
			mergeTone: "failure",
		},
	]);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(60_000);
	});
	expect(telemetryEvents()).toHaveLength(1);
	await render("/other");
	expect(telemetryEvents()).toHaveLength(2);
	await render("/other", "another-branch");
	expect(telemetryEvents()).toHaveLength(3);
});

it("reports PR, CI, check, and refresh interactions without identifying data", async () => {
	await render();
	await openMenu();
	await select("Open on GitHub");
	await openMenu();
	await select("1 of 1 checks failed");
	await select("Tests");
	await openMenu();
	await select("Refresh status");
	expect(telemetryEvents().map((event) => event.action)).toEqual([
		"shown",
		"open_clicked",
		"checks_expanded",
		"check_clicked",
		"refresh_clicked",
	]);
	for (const event of telemetryEvents()) {
		expect(Object.keys(event).sort()).toEqual([
			"action",
			"ciState",
			"mergeTone",
			"prState",
		]);
	}
});

it("records create intent without claiming a PR was created", async () => {
	invoke.mockResolvedValue({ ...data, pullRequest: null });
	await render();
	await openMenu();
	await select("Create pull request");
	expect(telemetryEvents()).toEqual([
		{
			action: "shown",
			prState: "none",
			ciState: "none",
			mergeTone: "neutral",
		},
		{
			action: "create_clicked",
			prState: "none",
			ciState: "none",
			mergeTone: "neutral",
		},
	]);
});

it("keeps PR links usable when telemetry delivery fails", async () => {
	invoke.mockImplementation(async (command) => {
		if (command === "capture_pull_request_event")
			throw new Error("Telemetry unavailable");
		return data;
	});
	await render();
	await openMenu();
	await select("Open on GitHub");
	expect(openExternalUrl).toHaveBeenCalledWith(data.pullRequest?.url);
});

it("does not record exposure for hidden or failed status", async () => {
	invoke.mockResolvedValue(null);
	await render();
	expect(telemetryEvents()).toEqual([]);
	invoke.mockRejectedValue(new Error("GitHub unavailable"));
	await refreshViaFocus();
	expect(telemetryEvents()).toEqual([]);
});

async function refreshViaFocus() {
	await act(async () => {
		window.dispatchEvent(new Event("focus"));
	});
}
