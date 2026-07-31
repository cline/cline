// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPromptQueue } from "../components/index.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("AgentPromptQueue", () => {
	it("expands queued prompts and submits host actions", async () => {
		const onRemove = vi.fn();
		const onSteer = vi.fn();
		await act(async () =>
			root.render(
				<AgentPromptQueue
					items={[
						{ id: "one", prompt: "First prompt", steer: false },
						{
							attachmentCount: 2,
							id: "two",
							prompt: "Second prompt",
							steer: true,
						},
					]}
					onEdit={vi.fn()}
					onRemove={onRemove}
					onSteer={onSteer}
				/>,
			),
		);

		const toggle = container.querySelector<HTMLButtonElement>(
			"button[aria-expanded]",
		);
		expect(toggle?.textContent).toContain("2 prompts queued");
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");
		await act(async () => toggle?.click());
		expect(toggle?.getAttribute("aria-expanded")).toBe("true");
		expect(container.textContent).toContain("2 attachments");
		expect(container.textContent).toContain("Next turn");

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Steer queued prompt"]')
				?.click();
			await Promise.resolve();
		});
		expect(onSteer).toHaveBeenCalledWith("one");

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Remove queued prompt"]')
				?.click();
			await Promise.resolve();
		});
		expect(onRemove).toHaveBeenCalledWith("one");
	});

	it("edits a prompt without owning queue data", async () => {
		const onEdit = vi.fn();
		await act(async () =>
			root.render(
				<AgentPromptQueue
					items={[{ id: "one", prompt: "Original", steer: false }]}
					onEdit={onEdit}
					onRemove={vi.fn()}
					onSteer={vi.fn()}
				/>,
			),
		);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>("button[aria-expanded]")
				?.click(),
		);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[aria-label="Edit queued prompt"]')
				?.click(),
		);

		const editor = container.querySelector<HTMLTextAreaElement>(
			'[aria-label="Edit queued prompt"]',
		);
		expect(editor?.value).toBe("Original");
		await act(async () => {
			if (!editor) return;
			const valueSetter = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set;
			valueSetter?.call(editor, " Updated ");
			editor.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Save queued prompt"]')
				?.click();
			await Promise.resolve();
		});

		expect(onEdit).toHaveBeenCalledWith("one", "Updated");
		expect(container.textContent).toContain("Original");
	});

	it("renders nothing without queued prompts", async () => {
		await act(async () =>
			root.render(
				<AgentPromptQueue
					items={[]}
					onEdit={vi.fn()}
					onRemove={vi.fn()}
					onSteer={vi.fn()}
				/>,
			),
		);
		expect(container.childElementCount).toBe(0);
	});
});
