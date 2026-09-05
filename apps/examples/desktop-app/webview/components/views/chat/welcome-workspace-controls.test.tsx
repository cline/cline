// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomeWorkspaceControls } from "./welcome-workspace-controls";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const values = new Map<string, string>();
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
			clear: () => values.clear(),
		},
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function button(text: string): HTMLButtonElement {
	const match = [
		...container.querySelectorAll<HTMLButtonElement>("button"),
	].find((candidate) => candidate.textContent?.includes(text));
	expect(match).toBeDefined();
	return match as HTMLButtonElement;
}

async function click(target: HTMLElement) {
	await act(async () => {
		target.click();
		await Promise.resolve();
	});
}

function renderControls(
	overrides: Partial<ComponentProps<typeof WelcomeWorkspaceControls>> = {},
) {
	const props: ComponentProps<typeof WelcomeWorkspaceControls> = {
		cloudEnabled: true,
		executionTarget: "local",
		repoUrl: "",
		cloudBranch: "",
		onCloudBranchChange: vi.fn(),
		signedIn: true,
		signingIn: false,
		onExecutionTargetChange: vi.fn(),
		onRepoUrlChange: vi.fn(),
		onListCloudRepositories: vi.fn(async () => ({
			connected: true,
			connectUrl: "https://app.example/dashboard/integrations",
			repositories: [
				{
					id: 42,
					name: "cline",
					fullName: "cline/cline",
					url: "https://github.com/cline/cline",
					defaultBranch: "main",
				},
			],
		})),
		onListCloudBranches: vi.fn(async () => ({
			available: true,
			branches: ["main", "feature/cloud"],
		})),
		onOpenExternalUrl: vi.fn(async () => undefined),
		onSignIn: vi.fn(),
		workspaceRoot: "/projects/cline",
		workspaces: ["/projects/cline"],
		onRefreshWorkspaces: vi.fn(async () => undefined),
		onSwitchWorkspace: vi.fn(async () => true),
		onPickWorkspaceDirectory: vi.fn(async () => null),
		onSelectChat: vi.fn(async () => true),
		currentBranch: "main",
		onListGitBranches: vi.fn(async () => ({
			current: "main",
			branches: ["main"],
		})),
		onSwitchGitBranch: vi.fn(async () => true),
		...overrides,
	};
	act(() => root.render(<WelcomeWorkspaceControls {...props} />));
	return props;
}

describe("WelcomeWorkspaceControls cloud mode", () => {
	it("selects Cloud from the same workspace control row", async () => {
		const props = renderControls();
		await click(button("Cloud"));
		expect(props.onExecutionTargetChange).toHaveBeenCalledWith("cloud");
	});

	it("hides the Local/Cloud selector when the feature flag is off", () => {
		renderControls({ cloudEnabled: false });
		const buttons = [...container.querySelectorAll("button")].map(
			(candidate) => candidate.textContent ?? "",
		);
		expect(buttons.some((text) => text.includes("Cloud"))).toBe(false);
		// Local workspace controls still render.
		expect(buttons.some((text) => text.includes("cline"))).toBe(true);
	});

	it("requires sign in before choosing a cloud repository", async () => {
		const props = renderControls({
			executionTarget: "cloud",
			signedIn: false,
		});
		expect(container.textContent).toContain("Sign in to use Cloud");
		expect(container.textContent).not.toContain("Select repository");
		await click(button("Sign in to use Cloud"));
		expect(props.onSignIn).toHaveBeenCalledOnce();
	});

	it("selects a connected GitHub repository and its default branch", async () => {
		const onRepoUrlChange = vi.fn();
		const onCloudBranchChange = vi.fn();
		const props = renderControls({
			executionTarget: "cloud",
			onRepoUrlChange,
			onCloudBranchChange,
		});
		await act(async () => {
			button("Select repository").click();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(props.onListCloudRepositories).toHaveBeenCalledOnce();
		await click(button("cline/cline"));
		expect(onRepoUrlChange).toHaveBeenLastCalledWith(
			"https://github.com/cline/cline",
		);
		expect(onCloudBranchChange).toHaveBeenLastCalledWith("main");
	});

	it("loads and selects a branch for the connected repository", async () => {
		const onCloudBranchChange = vi.fn();
		const props = renderControls({
			executionTarget: "cloud",
			onCloudBranchChange,
		});
		await act(async () => {
			button("Select repository").click();
			await Promise.resolve();
			await Promise.resolve();
		});
		await click(button("cline/cline"));
		renderControls({
			executionTarget: "cloud",
			repoUrl: "https://github.com/cline/cline",
			cloudBranch: "main",
			onCloudBranchChange,
			onListCloudRepositories: props.onListCloudRepositories,
			onListCloudBranches: props.onListCloudBranches,
		});
		await act(async () => {
			button("main").click();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(props.onListCloudBranches).toHaveBeenCalledWith(42);
		await click(button("feature/cloud"));
		expect(onCloudBranchChange).toHaveBeenLastCalledWith("feature/cloud");
	});

	it("loads additional branch pages as the user scrolls", async () => {
		let intersectionCallback:
			| ((entries: IntersectionObserverEntry[]) => void)
			| undefined;
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
					intersectionCallback = callback;
				}
				observe() {}
				disconnect() {}
			},
		);
		const onListCloudBranches = vi.fn(
			async (_repositoryId: number, options?: { cursor?: string }) =>
				options?.cursor
					? { available: true, branches: ["feature/cloud"], nextToken: "" }
					: { available: true, branches: ["main"], nextToken: "2" },
		);
		const props = renderControls({
			executionTarget: "cloud",
			onListCloudBranches,
		});
		await act(async () => {
			button("Select repository").click();
			await Promise.resolve();
			await Promise.resolve();
		});
		await click(button("cline/cline"));
		renderControls({
			executionTarget: "cloud",
			repoUrl: "https://github.com/cline/cline",
			cloudBranch: "main",
			onListCloudRepositories: props.onListCloudRepositories,
			onListCloudBranches,
		});
		await vi.waitFor(() =>
			expect(onListCloudBranches).toHaveBeenCalledWith(42),
		);
		await click(button("main"));
		await vi.waitFor(() => expect(intersectionCallback).toBeDefined());
		await act(async () => {
			intersectionCallback?.([
				{ isIntersecting: true } as IntersectionObserverEntry,
			]);
		});

		await vi.waitFor(() =>
			expect(onListCloudBranches).toHaveBeenCalledWith(42, { cursor: "2" }),
		);
		await vi.waitFor(() =>
			expect(container.textContent).toContain("feature/cloud"),
		);
	});

	it("recovers pagination when the search changes while a page fetch is in flight", async () => {
		let intersectionCallback:
			| ((entries: IntersectionObserverEntry[]) => void)
			| undefined;
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
					intersectionCallback = callback;
				}
				observe() {}
				disconnect() {}
			},
		);
		let releaseHungPage:
			| ((result: {
					available: boolean;
					branches: string[];
					nextToken?: string;
			  }) => void)
			| undefined;
		let cursorFetches = 0;
		const onListCloudBranches = vi.fn(
			async (
				_repositoryId: number,
				options?: { cursor?: string; query?: string },
			) => {
				if (options?.cursor) {
					cursorFetches += 1;
					if (cursorFetches === 1) {
						// First page fetch hangs until the test releases it.
						return new Promise<{
							available: boolean;
							branches: string[];
							nextToken?: string;
						}>((resolve) => {
							releaseHungPage = resolve;
						});
					}
					return {
						available: true,
						branches: ["feature/cloud"],
						nextToken: "",
					};
				}
				if (options?.query) {
					return {
						available: true,
						branches: ["feature/cloud"],
						nextToken: "",
					};
				}
				return { available: true, branches: ["main"], nextToken: "2" };
			},
		);
		const props = renderControls({
			executionTarget: "cloud",
			onListCloudBranches,
		});
		await act(async () => {
			button("Select repository").click();
			await Promise.resolve();
			await Promise.resolve();
		});
		await click(button("cline/cline"));
		renderControls({
			executionTarget: "cloud",
			repoUrl: "https://github.com/cline/cline",
			cloudBranch: "main",
			onListCloudRepositories: props.onListCloudRepositories,
			onListCloudBranches,
		});
		await vi.waitFor(() =>
			expect(onListCloudBranches).toHaveBeenCalledWith(42),
		);
		await click(button("main"));
		await vi.waitFor(() => expect(intersectionCallback).toBeDefined());
		await act(async () => {
			intersectionCallback?.([
				{ isIntersecting: true } as IntersectionObserverEntry,
			]);
		});
		await vi.waitFor(() => expect(releaseHungPage).toBeDefined());

		// Type a search character while the page fetch is still in flight; the
		// request key changes under it.
		const search = container.querySelector<HTMLInputElement>(
			'input[placeholder="Search branches…"]',
		);
		expect(search).not.toBeNull();
		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			valueSetter?.call(search, "feature");
			search?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await vi.waitFor(() =>
			expect(onListCloudBranches).toHaveBeenCalledWith(42, {
				query: "feature",
			}),
		);
		// The stale page fetch settles after the key changed; its results are
		// discarded but the loading flag must be released.
		await act(async () => {
			releaseHungPage?.({
				available: true,
				branches: ["stale/page"],
				nextToken: "3",
			});
			await Promise.resolve();
		});
		expect(container.textContent).not.toContain("stale/page");

		// Clear the search and scroll again: pagination must still work. Drop
		// the captured observer first: the effect only re-creates one after
		// the post-clear base list applied (nextToken set again), so waiting
		// for it guarantees the scroll uses fresh state instead of racing the
		// base fetch with a stale closure.
		intersectionCallback = undefined;
		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			valueSetter?.call(search, "");
			search?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await vi.waitFor(() => expect(intersectionCallback).toBeDefined());
		await act(async () => {
			intersectionCallback?.([
				{ isIntersecting: true } as IntersectionObserverEntry,
			]);
		});
		await vi.waitFor(() => expect(cursorFetches).toBe(2));
		await vi.waitFor(() =>
			expect(container.textContent).toContain("feature/cloud"),
		);
	});

	it("searches branches through the server", async () => {
		const onListCloudBranches = vi.fn(
			async (_repositoryId: number, options?: { query?: string }) =>
				options?.query
					? { available: true, branches: ["feature/cloud"] }
					: { available: true, branches: ["main"] },
		);
		const props = renderControls({
			executionTarget: "cloud",
			onListCloudBranches,
		});
		await act(async () => {
			button("Select repository").click();
			await Promise.resolve();
			await Promise.resolve();
		});
		await click(button("cline/cline"));
		renderControls({
			executionTarget: "cloud",
			repoUrl: "https://github.com/cline/cline",
			cloudBranch: "main",
			onListCloudRepositories: props.onListCloudRepositories,
			onListCloudBranches,
		});
		await vi.waitFor(() =>
			expect(onListCloudBranches).toHaveBeenCalledWith(42),
		);
		await click(button("main"));
		const search = container.querySelector<HTMLInputElement>(
			'input[placeholder="Search branches…"]',
		);
		expect(search).not.toBeNull();
		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			valueSetter?.call(search, "feature");
			search?.dispatchEvent(new Event("input", { bubbles: true }));
		});

		await vi.waitFor(() =>
			expect(onListCloudBranches).toHaveBeenCalledWith(42, {
				query: "feature",
			}),
		);
		await vi.waitFor(() =>
			expect(container.textContent).toContain("feature/cloud"),
		);
	});

	it("uses and labels the repository default when branch selection is unavailable", async () => {
		const onCloudBranchChange = vi.fn();
		const onListCloudBranches = vi.fn(async () => ({
			available: false,
			branches: [],
		}));
		const props = renderControls({
			executionTarget: "cloud",
			onCloudBranchChange,
			onListCloudBranches,
		});
		await act(async () => {
			button("Select repository").click();
			await Promise.resolve();
			await Promise.resolve();
		});
		await click(button("cline/cline"));
		renderControls({
			executionTarget: "cloud",
			repoUrl: "https://github.com/cline/cline",
			cloudBranch: "main",
			onCloudBranchChange,
			onListCloudRepositories: props.onListCloudRepositories,
			onListCloudBranches,
		});
		await act(async () => {
			await vi.waitFor(() => {
				expect(onListCloudBranches).toHaveBeenCalledWith(42);
				expect(container.textContent).toContain("main (default)");
			});
		});

		const branchButton = button("main (default)");
		expect(branchButton.disabled).toBe(true);
		expect(branchButton.title).toBe(
			"Using the repository default branch: main",
		);
		expect(container.textContent).not.toContain("Could not load branches.");
	});

	it("uses a clear fallback label before default-branch metadata is deployed", async () => {
		const onListCloudRepositories = vi.fn(async () => ({
			connected: true,
			connectUrl: "https://app.example/dashboard/integrations",
			repositories: [
				{
					id: 42,
					name: "cline",
					fullName: "cline/cline",
					url: "https://github.com/cline/cline",
					defaultBranch: "",
				},
			],
		}));
		const onListCloudBranches = vi.fn(async () => ({
			available: false,
			branches: [],
		}));
		const props = renderControls({
			executionTarget: "cloud",
			onListCloudRepositories,
			onListCloudBranches,
		});
		await act(async () => {
			button("Select repository").click();
			await Promise.resolve();
			await Promise.resolve();
		});
		await click(button("cline/cline"));
		renderControls({
			executionTarget: "cloud",
			repoUrl: "https://github.com/cline/cline",
			cloudBranch: "",
			onListCloudRepositories,
			onListCloudBranches,
			onCloudBranchChange: props.onCloudBranchChange,
		});

		await vi.waitFor(() => {
			expect(button("Default branch").disabled).toBe(true);
		});
		expect(container.textContent).not.toContain("Select branch… (default)");
	});

	it("links to GitHub setup when no integration is connected", async () => {
		const props = renderControls({
			executionTarget: "cloud",
			onListCloudRepositories: vi.fn(async () => ({
				connected: false,
				connectUrl: "https://app.example/dashboard/integrations",
				repositories: [],
			})),
		});
		await act(async () => {
			button("Select repository").click();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(container.textContent).toContain(
			"Connect GitHub to select a repository.",
		);
		await click(button("Connect GitHub"));
		expect(props.onOpenExternalUrl).toHaveBeenCalledWith(
			"https://app.example/dashboard/integrations",
		);
	});
});

async function clickButton(text: string): Promise<void> {
	const button = [
		...container.querySelectorAll<HTMLButtonElement>("button"),
	].find((candidate) => candidate.textContent?.includes(text));
	expect(button).toBeDefined();
	await act(async () => {
		button?.click();
		await Promise.resolve();
	});
}

async function openWorkspaceMenu(): Promise<void> {
	await clickButton(
		container.textContent?.includes("project-1") ? "project-1" : "cline",
	);
}

async function typeInSearch(value: string): Promise<void> {
	const input = container.querySelector<HTMLInputElement>("input");
	expect(input).toBeDefined();
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setter?.call(input, value);
		input?.dispatchEvent(new Event("input", { bubbles: true }));
		await Promise.resolve();
	});
}

describe("WelcomeWorkspaceControls manual path entry", () => {
	it("offers to open a typed absolute path and switches to it", async () => {
		const onSwitchWorkspace = vi.fn(async () => true);
		await renderControls({ onSwitchWorkspace });
		await openWorkspaceMenu();
		await typeInSearch("/home/user/personal-stuff");

		await clickButton("Open folder \u201c/home/user/personal-stuff\u201d");

		expect(onSwitchWorkspace).toHaveBeenCalledWith("/home/user/personal-stuff");
	});

	it("shows a visible error when the typed path cannot be opened", async () => {
		const onSwitchWorkspace = vi.fn(async () => false);
		await renderControls({ onSwitchWorkspace });
		await openWorkspaceMenu();
		await typeInSearch("/does/not/exist");

		await clickButton("Open folder \u201c/does/not/exist\u201d");

		expect(container.textContent).toContain('Couldn\'t open "/does/not/exist"');
	});

	it("does not offer path entry for plain search text", async () => {
		await renderControls();
		await openWorkspaceMenu();
		await typeInSearch("project");

		const pathOption = [
			...container.querySelectorAll<HTMLButtonElement>("button"),
		].find((candidate) =>
			candidate.textContent?.includes("Open folder \u201c"),
		);
		expect(pathOption).toBeUndefined();
	});

	it("keeps typed path and errors when the workspace catalog refreshes mid-open", async () => {
		// The workspace catalog re-derives on a timer (session-history refresh),
		// handing the picker a new onRefreshWorkspaces identity. That must not
		// wipe the menu's typed path or a visible error while it is open.
		const onSwitchWorkspace = vi.fn(async () => false);
		const render = async () => {
			renderControls({
				onRefreshWorkspaces: vi.fn(async () => undefined),
				onSwitchWorkspace,
				workspaceRoot: "/projects/project-1",
				workspaces: ["/projects/project-1"],
			});
			await act(async () => {
				await Promise.resolve();
			});
		};
		await render();
		await openWorkspaceMenu();
		await typeInSearch("/does/not/exist");
		await clickButton("Open folder \u201c/does/not/exist\u201d");
		expect(container.textContent).toContain('Couldn\'t open "/does/not/exist"');

		// Re-render with fresh callback identities, as the page does when the
		// session history poll lands.
		await render();

		const input = container.querySelector<HTMLInputElement>("input");
		expect(input?.value).toBe("/does/not/exist");
		expect(container.textContent).toContain('Couldn\'t open "/does/not/exist"');
	});

	it("surfaces picker failures from Open folder instead of a silent no-op", async () => {
		const onPickWorkspaceDirectory = vi.fn(async () => {
			throw new Error(
				"No system folder picker found (zenity or kdialog). Type or paste a folder path in the workspace selector instead.",
			);
		});
		await renderControls({ onPickWorkspaceDirectory });
		await openWorkspaceMenu();

		await clickButton("Open folder...");

		expect(container.textContent).toContain("No system folder picker found");
	});
});

async function renderBranchChipControls(overrides: {
	currentBranch: string;
}): Promise<void> {
	renderControls({
		cloudEnabled: false,
		currentBranch: overrides.currentBranch,
		onListGitBranches: vi.fn(async () => ({
			current: overrides.currentBranch,
			branches:
				overrides.currentBranch === "no-git" ? [] : [overrides.currentBranch],
		})),
		workspaceRoot: "/home/beatrix/recipes",
		workspaces: ["/home/beatrix/recipes"],
	});
	await act(async () => {
		await Promise.resolve();
	});
}

describe("WelcomeWorkspaceControls branch chip", () => {
	it("hides the branch chip entirely for a plain (non-git) folder", async () => {
		await renderBranchChipControls({ currentBranch: "no-git" });

		expect(container.textContent).toContain("recipes");
		// No git terminology may leak for non-developers: previously this
		// rendered a chip reading "No branch".
		expect(container.textContent).not.toContain("No branch");
		expect(container.textContent).not.toContain("no-git");
		const buttons = [...container.querySelectorAll("button")];
		expect(buttons).toHaveLength(1);
	});

	it("keeps the branch switcher chip for git repositories", async () => {
		await renderBranchChipControls({ currentBranch: "main" });

		expect(container.textContent).toContain("recipes");
		expect(container.textContent).toContain("main");
		const buttons = [...container.querySelectorAll("button")];
		expect(buttons).toHaveLength(2);
	});

	it("offers Open folder wording instead of Add project", async () => {
		await renderBranchChipControls({ currentBranch: "no-git" });

		await clickButton("recipes");
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Open folder...");
		});
		expect(container.textContent).not.toContain("Add project");
	});
});
