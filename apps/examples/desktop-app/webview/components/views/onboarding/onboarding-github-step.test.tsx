// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	GITHUB_INSTALL_POLL_INTERVAL_MS,
	GitHubConnectStep,
} from "./onboarding-github-step";

const { invoke, openExternalUrl } = vi.hoisted(() => ({
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	openExternalUrl,
}));

type IntegrationsMock = {
	list?: () => unknown;
	githubInstallUrl?: () => unknown;
	listGitHubRepositories?: () => unknown;
};

function mockIntegrationsCommand(handlers: IntegrationsMock) {
	invoke.mockImplementation(
		async (command: string, args?: Record<string, unknown>) => {
			if (command !== "cline_integrations") {
				throw new Error(`unexpected command: ${command}`);
			}
			const operation = String(args?.operation);
			const handler = handlers[operation as keyof IntegrationsMock];
			if (!handler) {
				throw new Error(`unexpected operation: ${operation}`);
			}
			return handler();
		},
	);
}

describe("GitHubConnectStep", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		invoke.mockReset();
		openExternalUrl.mockReset();
		openExternalUrl.mockResolvedValue(undefined);
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	function buttonByText(text: string): HTMLButtonElement {
		const button = Array.from(container.querySelectorAll("button")).find(
			(candidate) => candidate.textContent?.trim() === text,
		);
		if (!button) {
			throw new Error(`button not found: ${text}`);
		}
		return button;
	}

	async function render(onContinue = vi.fn()) {
		await act(async () => {
			root.render(<GitHubConnectStep onContinue={onContinue} />);
		});
		return onContinue;
	}

	it("continues silently when GitHub is already connected", async () => {
		mockIntegrationsCommand({ list: () => [{ provider: "github" }] });
		const onContinue = await render();
		expect(onContinue).toHaveBeenCalledTimes(1);
	});

	it("continues silently when the account is signed out", async () => {
		mockIntegrationsCommand({
			list: () => ({ signedIn: false, code: "ACCOUNT_NOT_AUTHENTICATED" }),
		});
		const onContinue = await render();
		expect(onContinue).toHaveBeenCalledTimes(1);
	});

	it("shows the connect card when GitHub is not connected", async () => {
		mockIntegrationsCommand({ list: () => [] });
		const onContinue = await render();
		expect(container.textContent).toContain("Connect GitHub");
		expect(container.textContent).toContain("Not connected");
		expect(onContinue).not.toHaveBeenCalled();
	});

	it("skips without connecting", async () => {
		mockIntegrationsCommand({ list: () => [] });
		const onContinue = await render();
		await act(async () => {
			buttonByText("Skip for now").click();
		});
		expect(onContinue).toHaveBeenCalledTimes(1);
	});

	it("opens the install URL, polls until connected, and lists repositories", async () => {
		let connected = false;
		mockIntegrationsCommand({
			list: () => (connected ? [{ provider: "github" }] : []),
			githubInstallUrl: () => ({
				url: "https://github.com/apps/cline/installations/new?state=abc",
			}),
			listGitHubRepositories: () => [
				{ id: 1, full_name: "cline/cline", private: false },
				{ id: 2, full_name: "cline/core-platform", private: true },
			],
		});
		const onContinue = await render();
		vi.useFakeTimers();

		await act(async () => {
			buttonByText("Connect GitHub").click();
		});
		expect(openExternalUrl).toHaveBeenCalledWith(
			"https://github.com/apps/cline/installations/new?state=abc",
		);
		expect(container.textContent).toContain(
			"Finish installing the Cline GitHub App in your browser",
		);

		// First poll: still not installed.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(GITHUB_INSTALL_POLL_INTERVAL_MS);
		});
		expect(container.textContent).not.toContain("Connected");

		connected = true;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(GITHUB_INSTALL_POLL_INTERVAL_MS);
		});
		expect(container.textContent).toContain("Connected");
		expect(container.textContent).toContain("Accessible repositories");
		expect(container.textContent).toContain("cline/cline");
		expect(container.textContent).toContain("cline/core-platform");

		expect(onContinue).not.toHaveBeenCalled();
		await act(async () => {
			buttonByText("Continue").click();
		});
		expect(onContinue).toHaveBeenCalledTimes(1);
	});

	it("returns to the connect state with an error when the install URL fails", async () => {
		mockIntegrationsCommand({
			list: () => [],
			githubInstallUrl: () => {
				throw new Error("authentication required");
			},
		});
		await render();

		await act(async () => {
			buttonByText("Connect GitHub").click();
		});
		expect(container.textContent).toContain(
			"Failed to start the GitHub connection",
		);
		expect(container.textContent).toContain("authentication required");
		expect(openExternalUrl).not.toHaveBeenCalled();
		expect(buttonByText("Connect GitHub")).toBeDefined();
	});

	it("stops waiting when the browser round-trip is cancelled", async () => {
		mockIntegrationsCommand({
			list: () => [],
			githubInstallUrl: () => ({ url: "https://github.com/install" }),
		});
		await render();

		await act(async () => {
			buttonByText("Connect GitHub").click();
		});
		expect(container.textContent).toContain("Finish installing");

		await act(async () => {
			buttonByText("Cancel").click();
		});
		expect(container.textContent).not.toContain("Finish installing");
		expect(buttonByText("Connect GitHub")).toBeDefined();
	});

	it("stops polling once cancelled instead of leaving the interval running", async () => {
		mockIntegrationsCommand({
			list: () => [],
			githubInstallUrl: () => ({ url: "https://github.com/install" }),
		});
		await render();
		vi.useFakeTimers();

		await act(async () => {
			buttonByText("Connect GitHub").click();
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(GITHUB_INSTALL_POLL_INTERVAL_MS);
		});

		await act(async () => {
			buttonByText("Cancel").click();
		});
		const callsAfterCancel = invoke.mock.calls.length;

		// No further polls may fire after cancelling.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(GITHUB_INSTALL_POLL_INTERVAL_MS * 5);
		});
		expect(invoke.mock.calls.length).toBe(callsAfterCancel);
	});

	it("stops polling and reports the signed-out session when the account expires", async () => {
		let signedOut = false;
		mockIntegrationsCommand({
			list: () =>
				signedOut ? { signedIn: false, code: "ACCOUNT_NOT_AUTHENTICATED" } : [],
			githubInstallUrl: () => ({ url: "https://github.com/install" }),
		});
		await render();
		vi.useFakeTimers();

		await act(async () => {
			buttonByText("Connect GitHub").click();
		});
		expect(container.textContent).toContain("Finish installing");

		signedOut = true;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(GITHUB_INSTALL_POLL_INTERVAL_MS);
		});

		// Back to the actionable connect state, not a permanent spinner.
		expect(container.textContent).not.toContain("Finish installing");
		expect(container.textContent).toContain("Your Cline account session ended");
		expect(buttonByText("Connect GitHub")).toBeDefined();

		const callsAfterSignOut = invoke.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(GITHUB_INSTALL_POLL_INTERVAL_MS * 5);
		});
		expect(invoke.mock.calls.length).toBe(callsAfterSignOut);
	});

	it("checks integrations once even when the parent re-renders", async () => {
		mockIntegrationsCommand({ list: () => [] });
		const onContinue = vi.fn();
		await act(async () => {
			root.render(<GitHubConnectStep onContinue={onContinue} />);
		});
		const callsAfterMount = invoke.mock.calls.length;
		expect(callsAfterMount).toBe(1);

		// A parent re-render passing a brand-new inline callback must not
		// re-trigger the initial check.
		await act(async () => {
			root.render(<GitHubConnectStep onContinue={() => onContinue()} />);
		});
		expect(invoke.mock.calls.length).toBe(callsAfterMount);
	});
});
