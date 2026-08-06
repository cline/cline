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
		expect(container.textContent).not.toContain("Choose repository");
		await click(button("Sign in to use Cloud"));
		expect(props.onSignIn).toHaveBeenCalledOnce();
	});

	it("accepts an HTTPS GitHub repository and remembers it", async () => {
		const onRepoUrlChange = vi.fn();
		renderControls({
			executionTarget: "cloud",
			onRepoUrlChange,
		});
		await click(button("Choose repository"));
		const input = container.querySelector<HTMLInputElement>("#cloud-repo-url");
		expect(input).not.toBeNull();
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(input, "https://github.com/cline/cline/");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(onRepoUrlChange).toHaveBeenLastCalledWith(
			"https://github.com/cline/cline/",
		);

		// The input is controlled: apply the parent state change so the confirm
		// button actually enables, as it would in the real component tree.
		onRepoUrlChange.mockClear();
		renderControls({
			executionTarget: "cloud",
			onRepoUrlChange,
			repoUrl: "https://github.com/cline/cline/",
		});
		const confirm = button("Use repository");
		expect(confirm.disabled).toBe(false);
		await click(confirm);

		// Confirm normalizes (trailing slash dropped) and persists the recent.
		expect(onRepoUrlChange).toHaveBeenLastCalledWith(
			"https://github.com/cline/cline",
		);
		expect(
			window.localStorage.getItem("cline.code.cloud-repositories.v1"),
		).toBe(JSON.stringify(["https://github.com/cline/cline"]));
	});

	it("captures an optional branch alongside the repository URL", async () => {
		const onCloudBranchChange = vi.fn();
		renderControls({
			executionTarget: "cloud",
			onCloudBranchChange,
		});
		await click(button("Choose repository"));
		const input =
			container.querySelector<HTMLInputElement>("#cloud-repo-branch");
		expect(input).not.toBeNull();
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(input, "feature/login-fix");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(onCloudBranchChange).toHaveBeenLastCalledWith("feature/login-fix");
	});

	it("keeps the confirm button disabled for a partial or non-GitHub URL", async () => {
		renderControls({
			executionTarget: "cloud",
			repoUrl: "https://exa",
		});
		const trigger = container.querySelector<HTMLButtonElement>(
			'button[aria-haspopup="dialog"]',
		);
		expect(trigger).not.toBeNull();
		await click(trigger as HTMLButtonElement);
		expect(button("Use repository").disabled).toBe(true);
		expect(
			window.localStorage.getItem("cline.code.cloud-repositories.v1"),
		).toBeNull();
	});
});
