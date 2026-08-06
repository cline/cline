// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthPromptDialog } from "./oauth-prompt-dialog";

const { invoke, subscribe } = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribe: vi.fn(() => () => undefined),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe },
}));

describe("OAuthPromptDialog", () => {
	let container: HTMLDivElement;
	let root: Root;
	let handlers: Map<string, (payload: unknown) => void>;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		invoke.mockReset();
		invoke.mockResolvedValue({});
		handlers = new Map();
		subscribe.mockReset();
		subscribe.mockImplementation(
			((eventName: string, handler: (payload: unknown) => void) => {
				handlers.set(eventName, handler);
				return () => undefined;
			}) as never,
		);
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	async function render() {
		await act(async () => {
			root.render(<OAuthPromptDialog />);
		});
	}

	function bodyButtonByText(text: string): HTMLButtonElement {
		const button = Array.from(document.body.querySelectorAll("button")).find(
			(candidate) => candidate.textContent?.trim() === text,
		);
		if (!button) {
			throw new Error(`button not found: ${text}`);
		}
		return button;
	}

	it("collects the pasted code and answers the pending prompt", async () => {
		await render();
		expect(document.body.textContent).not.toContain("Finish signing in");

		await act(async () => {
			handlers.get("oauth_prompt_requested")?.({
				promptId: "prompt-1",
				provider: "openai-codex",
				message: "Paste the authorization code (or full redirect URL):",
			});
		});
		expect(document.body.textContent).toContain("Finish signing in");
		expect(document.body.textContent).toContain(
			"Paste the authorization code (or full redirect URL):",
		);

		const input = document.body.querySelector<HTMLInputElement>(
			'input[aria-label="Authorization code"]',
		);
		expect(input).not.toBeNull();
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(input, "  auth-code-123  ");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			bodyButtonByText("Submit code").click();
		});

		expect(invoke).toHaveBeenCalledWith("respond_oauth_prompt", {
			prompt_id: "prompt-1",
			value: "auth-code-123",
		});
		expect(document.body.textContent).not.toContain("Finish signing in");
	});

	it("answers with an empty value when the user cancels", async () => {
		await render();
		await act(async () => {
			handlers.get("oauth_prompt_requested")?.({
				promptId: "prompt-2",
				provider: "cline",
				message: "Paste the authorization code:",
			});
		});

		await act(async () => {
			bodyButtonByText("Cancel").click();
		});

		// Cancelling answers immediately so the sign-in fails fast instead of
		// waiting out the sidecar's prompt timeout.
		expect(invoke).toHaveBeenCalledWith("respond_oauth_prompt", {
			prompt_id: "prompt-2",
			value: "",
		});
		expect(document.body.textContent).not.toContain("Finish signing in");
	});

	it("closes when the sidecar cancels the prompt", async () => {
		await render();
		await act(async () => {
			handlers.get("oauth_prompt_requested")?.({
				promptId: "prompt-3",
				provider: "cline",
				message: "Paste the authorization code:",
			});
		});
		expect(document.body.textContent).toContain("Finish signing in");

		await act(async () => {
			handlers.get("oauth_prompt_cancelled")?.({
				promptId: "prompt-3",
				reason: "login_cancelled",
			});
		});
		expect(document.body.textContent).not.toContain("Finish signing in");
		expect(invoke).not.toHaveBeenCalled();
	});
});
