// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHeader } from "@/components/agent-header";

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

describe("AgentHeader title editor", () => {
	it("preserves the displayed title width when editing starts", async () => {
		await act(async () => {
			root.render(
				<AgentHeader
					canEditTitle
					onRenameTitle={vi.fn()}
					status="completed"
					title="A title wide enough to expose resizing"
				/>,
			);
		});

		const titleButton = container.querySelector<HTMLButtonElement>(
			'button[title="A title wide enough to expose resizing"]',
		);
		expect(titleButton).not.toBeNull();
		vi.spyOn(
			titleButton as HTMLButtonElement,
			"getBoundingClientRect",
		).mockReturnValue({
			width: 318,
		} as DOMRect);

		await act(async () => {
			titleButton?.click();
		});

		const titleForm = container.querySelector("form");
		const titleInput = container.querySelector<HTMLInputElement>("input");
		expect(titleForm?.style.width).toBe("318px");
		expect(titleInput?.className).toContain("w-full");
		expect(titleInput?.className).not.toContain("w-64");
	});
});
