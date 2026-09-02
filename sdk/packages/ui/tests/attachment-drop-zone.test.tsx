// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentDropZone } from "../components/index.js";

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
});

async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

function dispatchDrag(
	target: Element,
	type: string,
	files: File[] = [],
	types: string[] = ["Files"],
) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	const dataTransfer = { dropEffect: "none", files, types };
	Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
	target.dispatchEvent(event);
	return { dataTransfer, event };
}

describe("AttachmentDropZone", () => {
	it("keeps the overlay open across nested drag targets and attaches on drop", async () => {
		const onAttachFiles = vi.fn();
		await render(
			<AttachmentDropZone onAttachFiles={onAttachFiles}>
				<div data-testid="child">Composer</div>
			</AttachmentDropZone>,
		);

		const zone = container.firstElementChild as HTMLElement;
		const child = container.querySelector(
			'[data-testid="child"]',
		) as HTMLElement;
		const file = new File(["image"], "screenshot.png", {
			type: "image/png",
		});

		await act(async () => {
			dispatchDrag(zone, "dragenter");
			dispatchDrag(child, "dragenter");
			dispatchDrag(child, "dragleave");
		});
		expect(zone.dataset.draggingFiles).toBe("true");
		expect(container.textContent).toContain("Drop to attach");

		let dragOver: ReturnType<typeof dispatchDrag> | undefined;
		await act(async () => {
			dragOver = dispatchDrag(child, "dragover");
		});
		expect(dragOver?.dataTransfer.dropEffect).toBe("copy");
		expect(dragOver?.event.defaultPrevented).toBe(true);

		await act(async () => {
			dispatchDrag(child, "drop", [file]);
		});
		expect(onAttachFiles).toHaveBeenCalledWith([file]);
		expect(zone.dataset.draggingFiles).toBeUndefined();
	});

	it("ignores non-file and disabled drags", async () => {
		const onAttachFiles = vi.fn();
		await render(
			<AttachmentDropZone disabled onAttachFiles={onAttachFiles}>
				Composer
			</AttachmentDropZone>,
		);
		const zone = container.firstElementChild as HTMLElement;

		let nonFileDrag: ReturnType<typeof dispatchDrag> | undefined;
		let disabledDragOver: ReturnType<typeof dispatchDrag> | undefined;
		let disabledDrop: ReturnType<typeof dispatchDrag> | undefined;
		await act(async () => {
			nonFileDrag = dispatchDrag(zone, "dragenter", [], ["text/plain"]);
			disabledDragOver = dispatchDrag(zone, "dragover");
			disabledDrop = dispatchDrag(zone, "drop", [new File(["x"], "file.txt")]);
		});

		expect(zone.dataset.draggingFiles).toBeUndefined();
		expect(onAttachFiles).not.toHaveBeenCalled();
		expect(nonFileDrag?.event.defaultPrevented).toBe(false);
		expect(disabledDragOver?.event.defaultPrevented).toBe(true);
		expect(disabledDragOver?.dataTransfer.dropEffect).toBe("none");
		expect(disabledDrop?.event.defaultPrevented).toBe(true);
	});

	it("supports consumer-specific overlay copy", async () => {
		await render(
			<AttachmentDropZone
				description="Images will be added to your next message"
				label="Drop image to attach"
				onAttachFiles={() => {}}
			>
				Composer
			</AttachmentDropZone>,
		);
		const zone = container.firstElementChild as HTMLElement;

		await act(async () => {
			dispatchDrag(zone, "dragenter");
		});

		expect(container.textContent).toContain("Drop image to attach");
		expect(container.textContent).toContain(
			"Images will be added to your next message",
		);
	});
});
