// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePendingAttachments } from "./use-pending-attachments";

type Attachments = ReturnType<typeof usePendingAttachments>;

let container: HTMLDivElement;
let root: Root;
let attachments: {
	files: Attachments[0];
	update: Attachments[1];
	take: Attachments[2];
};

function Composer() {
	const [files, update, take] = usePendingAttachments();
	attachments = { files, update, take };
	return null;
}

function file(name: string): File {
	return new File([name], `${name}.png`, { type: "image/png" });
}

function names(files: readonly File[]): string[] {
	return files.map((attached) => attached.name);
}

beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => root.render(<Composer />));
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("usePendingAttachments", () => {
	it("takes only the wanted files still attached and leaves files added since", () => {
		const [kept, removed, pasted] = [
			file("kept"),
			file("removed"),
			file("pasted"),
		];
		act(() => attachments.update([kept, removed]));
		const atPress = attachments.files;
		act(() => {
			attachments.update((files) =>
				files.filter((attached) => attached !== removed),
			);
			attachments.update((files) => [...files, pasted]);
		});

		let taken: File[] = [];
		act(() => {
			taken = attachments.take(atPress);
		});

		expect(names(taken)).toEqual(["kept.png"]);
		expect(names(attachments.files)).toEqual(["pasted.png"]);
	});

	it("takes a file attached earlier in the same tick", () => {
		const attached = file("attached");
		let taken: File[] = [];
		act(() => {
			attachments.update([attached]);
			taken = attachments.take([attached]);
		});

		expect(names(taken)).toEqual(["attached.png"]);
		expect(attachments.files).toEqual([]);
	});
});
