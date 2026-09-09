// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PullRequestStatus } from "@/lib/pull-request";
import { PullRequestBar } from "./pull-request-bar";

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
		root.render(<PullRequestBar cwd={cwd} branch={branch} />),
	);
}
async function click(label: string) {
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
			.click(),
	);
}

it("opens the PR, shows conflicts and expands CI details", async () => {
	await render();
	expect(container.textContent).toContain("Conflicts");
	expect(container.textContent).toContain("+1,234");
	expect(container.textContent).toContain("CI failed");
	await click("Open pull request #42: Feature");
	expect(openExternalUrl).toHaveBeenCalledWith(data.pullRequest!.url);
	await click("CI failed");
	expect(document.body.textContent).toContain("Tests");
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
		status: { mergeable: "UNKNOWN" },
		label: "Merge status pending",
		color: "text-muted-foreground",
	},
	{
		status: { mergeStateStatus: "UNKNOWN" },
		label: "No conflicts",
		color: "text-muted-foreground",
	},
	{
		status: { mergeStateStatus: "DIRTY" },
		label: "Conflicts",
		color: "text-red-400",
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
	{ status: { state: "CLOSED" }, label: "Closed", color: "text-red-400" },
	{ status: {}, label: "Ready to merge", color: "text-green-500" },
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
	const statusLabel = [...container.querySelectorAll("span")].find(
		(element) => element.textContent === label,
	);
	expect(statusLabel).toBeDefined();
	expect(statusLabel?.classList.contains(color)).toBe(true);
	expect(container.querySelector("svg")?.classList.contains(color)).toBe(true);
});

it("offers the compare form when no PR exists", async () => {
	invoke.mockResolvedValue({ ...data, pullRequest: null });
	await render();
	await act(async () =>
		[...container.querySelectorAll("button")]
			.find((button) => button.textContent?.includes("Create PR"))!
			.click(),
	);
	expect(openExternalUrl).toHaveBeenCalledWith(data.createUrl);
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
	expect(container.textContent).toContain("Check GitHub CLI access");
	expect(container.textContent).not.toContain("#42");
	invoke.mockResolvedValue(data);
	await click("Refresh pull request status");
	expect(container.textContent).toContain("#42");
});
it("does not fetch for a non-repository", async () => {
	await render("/repo", "no-git");
	expect(invoke).not.toHaveBeenCalled();
});
