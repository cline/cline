// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentImageLightboxContent } from "../components/agent-image-lightbox.js";

it("renders the original attachment and delegates both close controls without owning a dialog", async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const container = document.createElement("div");
	const root = createRoot(container);
	const onClose = vi.fn();
	try {
		await act(async () =>
			root.render(
				<AgentImageLightboxContent
					src="data:image/png;base64,fixture"
					alt="Attachment 2"
					onClose={onClose}
				/>,
			),
		);
		expect(container.querySelector("img")?.getAttribute("src")).toBe(
			"data:image/png;base64,fixture",
		);
		expect(container.querySelector("img")?.alt).toBe("Attachment 2");
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		const backdrop = container.querySelector<HTMLButtonElement>(
			'[aria-label="Close expanded attachment"]',
		);
		expect(backdrop?.tabIndex).toBe(0);
		await act(async () => backdrop?.click());
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[aria-label="Close image viewer"]')
				?.click(),
		);
		expect(onClose).toHaveBeenCalledTimes(2);
		await act(async () =>
			root.render(
				<AgentImageLightboxContent
					src="data:image/png;base64,fixture"
					alt="Attachment 2"
					onClose={onClose}
					backdropTabIndex={-1}
				/>,
			),
		);
		expect(backdrop?.tabIndex).toBe(-1);
	} finally {
		await act(async () => root.unmount());
	}
});
