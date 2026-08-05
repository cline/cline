// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentAttachments } from "../components/index.js";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
});

describe("AgentAttachments", () => {
	it("renders host-neutral image attachments and remove controls", () => {
		const markup = renderToStaticMarkup(
			<AgentAttachments
				attachments={[
					{
						id: "diagram",
						label: "diagram.png",
						mediaType: "image/png",
						src: "data:image/png;base64,AAAA",
					},
				]}
				onRemove={() => undefined}
			/>,
		);

		expect(markup).toContain('aria-label="Attachments"');
		expect(markup).toContain('aria-label="diagram.png"');
		expect(markup).toContain('alt=""');
		expect(markup).toContain('aria-label="Remove diagram.png"');
	});

	it("renders attachment labels in the inline variant", () => {
		const markup = renderToStaticMarkup(
			<AgentAttachments
				attachments={[{ id: "notes", label: "notes.txt" }]}
				variant="inline"
			/>,
		);

		expect(markup).toContain("notes.txt");
		expect(markup).not.toContain('aria-label="Remove notes.txt"');
	});

	it("names non-image grid attachments without a remove button", () => {
		const markup = renderToStaticMarkup(
			<AgentAttachments attachments={[{ id: "notes", label: "notes.txt" }]} />,
		);

		expect(markup).toContain('aria-label="notes.txt"');
		expect(markup).not.toContain("Remove notes.txt");
	});

	it("reports removal without bubbling the click", () => {
		const container = document.createElement("div");
		const onParentClick = vi.fn();
		const onRemove = vi.fn();
		root = createRoot(container);
		act(() => {
			root?.render(
				<fieldset
					onClick={onParentClick}
					onKeyDown={() => undefined}
					tabIndex={-1}
				>
					<AgentAttachments
						attachments={[{ id: "notes", label: "notes.txt" }]}
						onRemove={onRemove}
					/>
				</fieldset>,
			);
		});

		const button = container.querySelector("button");
		expect(button).not.toBeNull();
		act(() => button?.click());
		expect(onRemove).toHaveBeenCalledWith("notes");
		expect(onParentClick).not.toHaveBeenCalled();
	});

	it("does not invoke removal when disabled", () => {
		const container = document.createElement("div");
		const onRemove = vi.fn();
		root = createRoot(container);
		act(() => {
			root?.render(
				<AgentAttachments
					attachments={[{ id: "notes", label: "notes.txt" }]}
					disabled
					onRemove={onRemove}
				/>,
			);
		});

		act(() => container.querySelector("button")?.click());
		expect(onRemove).not.toHaveBeenCalled();
	});
});
