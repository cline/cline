// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemPromptSettingsContent } from "./system-prompt-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invoke.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function changeTextarea(
	textarea: HTMLTextAreaElement,
	value: string,
): Promise<void> {
	const setValue = Object.getOwnPropertyDescriptor(
		HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setValue?.call(textarea, value);
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

describe("SystemPromptSettingsContent", () => {
	it("separates bundled profile rules from editable custom instructions", async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "read_bot_system_prompt") {
				return {
					content: "Always use concise answers.",
					bundledContent: "You are Cline Dad.",
					profileRulesContent: "Inspect before acting.",
					profileId: "cline-dad",
					revision: 2,
				};
			}
			if (command === "write_bot_system_prompt") return { revision: 3 };
			throw new Error(`Unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<SystemPromptSettingsContent activeBotId="bot-1" />);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("Bundled profile: cline-dad");
		});
		expect(container.textContent).toContain("You are Cline Dad.");
		expect(container.textContent).toContain("Inspect before acting.");
		expect(container.textContent).toContain(
			"default-agent/cline-dad/system-prompt.md",
		);
		const textarea =
			container.querySelector<HTMLTextAreaElement>("#bot-system-prompt");
		expect(textarea?.value).toBe("Always use concise answers.");

		await changeTextarea(textarea as HTMLTextAreaElement, "Prefer TypeScript.");
		const saveButton = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Save",
		);
		expect(saveButton).toBeDefined();
		await act(async () => {
			saveButton?.click();
		});

		await vi.waitFor(() => {
			expect(invoke).toHaveBeenCalledWith("write_bot_system_prompt", {
				botId: "bot-1",
				content: "Prefer TypeScript.",
			});
			expect(container.textContent).toContain("Saved.");
		});
	});
});
