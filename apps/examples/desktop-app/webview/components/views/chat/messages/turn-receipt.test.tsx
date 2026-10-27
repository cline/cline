// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionChangeSet } from "@/lib/session-changes";
import { TurnReceipt } from "./turn-receipt";

function changeSet(count: number, omitted = 0): SessionChangeSet {
	return {
		files: Array.from({ length: count }, (_, index) => ({
			path: `src/file-${index}.ts`,
			status: "M",
			additions: 1,
			deletions: 0,
		})),
		omitted,
	} as SessionChangeSet;
}

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

const fileRows = () =>
	[...container.querySelectorAll<HTMLButtonElement>("button[title]")].map(
		(button) => button.title,
	);
const buttonByText = (text: string) =>
	[...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
		button.textContent?.includes(text),
	);

describe("TurnReceipt", () => {
	it("defers to the changes pane by default (desktop)", async () => {
		const onReview = vi.fn();
		await act(async () => {
			root.render(<TurnReceipt changes={changeSet(5)} onReview={onReview} />);
		});
		expect(fileRows()).toHaveLength(3);
		await act(async () => buttonByText("2 more files")?.click());
		expect(onReview).toHaveBeenCalledWith();
		expect(fileRows()).toHaveLength(3);
	});

	it("lists every file in place when expandable (VS Code)", async () => {
		const onReview = vi.fn();
		await act(async () => {
			root.render(
				<TurnReceipt changes={changeSet(5)} expandable onReview={onReview} />,
			);
		});
		await act(async () => buttonByText("2 more files")?.click());
		expect(onReview).not.toHaveBeenCalled();
		expect(fileRows()).toEqual([
			"src/file-0.ts",
			"src/file-1.ts",
			"src/file-2.ts",
			"src/file-3.ts",
			"src/file-4.ts",
		]);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('button[title="src/file-4.ts"]')
				?.click(),
		);
		expect(onReview).toHaveBeenCalledWith("src/file-4.ts");
		await act(async () => buttonByText("Show fewer")?.click());
		expect(fileRows()).toHaveLength(3);
	});

	it("reports files the sidecar omitted once everything listed is shown", async () => {
		await act(async () => {
			root.render(
				<TurnReceipt changes={changeSet(4, 6)} expandable onReview={vi.fn()} />,
			);
		});
		await act(async () => buttonByText("7 more files")?.click());
		expect(fileRows()).toHaveLength(4);
		expect(container.textContent).toContain("6 more files not listed");
	});
});
