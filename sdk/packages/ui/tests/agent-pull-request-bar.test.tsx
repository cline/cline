// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	AgentPullRequestBar,
	type AgentPullRequestData,
} from "../components/agent-pull-request-bar.js";

let container: HTMLDivElement;
let root: Root;
const data: AgentPullRequestData = {
	repository: "cline/core",
	branch: "feature",
	pullRequest: {
		number: 7,
		title: "Fix",
		url: "https://github.com/cline/core/pull/7",
		state: "OPEN",
		isDraft: false,
		mergeable: "UNKNOWN",
		mergeStateStatus: "CLEAN",
		checks: [
			{ name: "build", state: "failure", url: "https://github.com/check/1" },
			{ name: "test", state: "pending" },
		],
		additions: 5,
		deletions: 2,
	},
};
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
it("shares readiness precedence, CI summary, counts and ordinary web navigation", async () => {
	await act(async () =>
		root.render(
			<AgentPullRequestBar
				data={data}
				onRefresh={() => {}}
				renderChecks={(trigger, content) => (
					<>
						{trigger}
						{content}
					</>
				)}
			/>,
		),
	);
	expect(container.textContent).toContain("Merge status pending");
	expect(container.querySelector('[aria-label="CI failed"]')).not.toBeNull();
	expect(
		container.querySelector('[aria-label="5 additions, 2 deletions"]'),
	).not.toBeNull();
	expect(container.querySelector("a")?.getAttribute("href")).toBe(
		data.pullRequest?.url,
	);
	expect(container.querySelector("a")?.getAttribute("rel")).toBe(
		"noopener noreferrer",
	);
});
it("delegates native links and refresh to its host without owning popover state", async () => {
	const onNavigate = vi.fn(),
		onRefresh = vi.fn();
	await act(async () =>
		root.render(
			<AgentPullRequestBar
				data={data}
				onNavigate={onNavigate}
				onRefresh={onRefresh}
				renderChecks={(trigger, content) => (
					<>
						{trigger}
						{content}
					</>
				)}
			/>,
		),
	);
	await act(async () => {
		container
			.querySelector<HTMLButtonElement>('[aria-label^="Open pull request"]')
			?.click();
		Array.from(container.querySelectorAll("button"))
			.find((b) => b.textContent?.trim() === "build")
			?.click();
		container
			.querySelector<HTMLButtonElement>(
				'[aria-label="Refresh pull request status"]',
			)
			?.click();
	});
	expect(onNavigate.mock.calls).toEqual([
		[data.pullRequest?.url, "open"],
		["https://github.com/check/1", "check"],
	]);
	expect(onRefresh).toHaveBeenCalledOnce();
});
it("distinguishes unavailable checks from a successfully loaded empty list", async () => {
	for (const checks of [undefined, []]) {
		await act(async () =>
			root.render(
				<AgentPullRequestBar
					data={{ ...data, pullRequest: { ...data.pullRequest!, checks } }}
					onRefresh={() => {}}
					renderChecks={(trigger, content) => (
						<>
							{trigger}
							{content}
						</>
					)}
				/>,
			),
		);
		expect(
			container.querySelector(
				`button[aria-label="${checks ? "No CI checks" : "CI unavailable"}"]`,
			),
		).not.toBeNull();
	}
});

it("keeps the missing-branch fallback and refresh without showing a misleading PR", async () => {
	await act(async () =>
		root.render(
			<AgentPullRequestBar
				data={{ ...data, branch: "" }}
				onRefresh={() => {}}
				renderChecks={(trigger) => trigger}
			/>,
		),
	);
	expect(container.textContent).toContain("Task branch unavailable.");
	expect(
		container.querySelector('[aria-label^="Open pull request"]'),
	).toBeNull();
	expect(
		container.querySelector('[aria-label="Refresh pull request status"]'),
	).not.toBeNull();
});
