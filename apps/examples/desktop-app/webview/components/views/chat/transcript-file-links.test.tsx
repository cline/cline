// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	parseInlineFilePath,
	TranscriptFileLink,
	TranscriptFileLinkProvider,
} from "./transcript-file-links";

describe("parseInlineFilePath", () => {
	it.each([
		["src/app.tsx", { path: "src/app.tsx" }],
		["./lib/a.ts:42", { path: "./lib/a.ts", line: 42 }],
		["/abs/path/file.go:7:3", { path: "/abs/path/file.go", line: 7 }],
		["package.json", { path: "package.json" }],
		["~/notes/todo.md", { path: "~/notes/todo.md" }],
	])("treats %s as a file", (input, expected) => {
		expect(parseInlineFilePath(input)).toEqual({
			line: undefined,
			...expected,
		});
	});

	it.each([
		"useState",
		"bun test",
		"1.2.3",
		"https://example.com/a.ts",
		"foo()",
		"--flag",
		"",
	])("leaves %s as plain code", (input) => {
		expect(parseInlineFilePath(input)).toBeNull();
	});
});

describe("TranscriptFileLink", () => {
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

	it("renders plain children without a provider", async () => {
		await act(async () => {
			root.render(<TranscriptFileLink path="a.ts">a.ts</TranscriptFileLink>);
		});
		expect(container.innerHTML).toBe("a.ts");
	});

	it("opens the file without triggering the surrounding button", async () => {
		const open = vi.fn();
		const outer = vi.fn();
		await act(async () => {
			root.render(
				<TranscriptFileLinkProvider onOpenFile={open}>
					<button onClick={outer} type="button">
						Read file{" "}
						<TranscriptFileLink line={3} path="src/a.ts">
							a.ts
						</TranscriptFileLink>
					</button>
				</TranscriptFileLinkProvider>,
			);
		});
		const link = container.querySelector<HTMLElement>("[role=link]");
		expect(link?.textContent).toBe("a.ts");
		await act(async () => link?.click());
		expect(open).toHaveBeenCalledWith({ path: "src/a.ts", line: 3 });
		expect(outer).not.toHaveBeenCalled();
	});
});
