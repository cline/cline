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
