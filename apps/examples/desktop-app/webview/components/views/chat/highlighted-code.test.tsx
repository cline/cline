// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodeDiff, CodeFile, languageForPath } from "./highlighted-code";

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

async function waitFor(check: () => boolean, timeoutMs = 5_000) {
	const started = Date.now();
	while (!check()) {
		if (Date.now() - started > timeoutMs) throw new Error("timed out");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 25));
		});
	}
}

function coloredSpans(): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>("span")).filter(
		(span) => span.style.getPropertyValue("--sdm-c") !== "",
	);
}

describe("languageForPath", () => {
	it("maps extensions to the chat highlighter's languages", () => {
		expect(languageForPath("/repo/src/app.tsx")).toBe("tsx");
		expect(languageForPath("README.md")).toBe("md");
		expect(languageForPath("config.yaml")).toBe("yaml");
		expect(languageForPath("/home/u/.zshrc")).toBe("shellscript");
		expect(languageForPath("Makefile")).toBe("");
		expect(languageForPath("x.constructor")).toBe("constructor");
		expect(languageForPath("x.__proto__")).toBe("__proto__");
	});
});

describe("CodeFile", () => {
	it("renders line numbers and highlights with the chat highlighter", async () => {
		await act(async () => {
			root.render(
				<CodeFile
					contents={
						'export const answer: number = 42;\nconst name = "cline";\n'
					}
					path="/repo/src/answer.ts"
				/>,
			);
		});
		const rows = container.querySelectorAll(
			'[data-testid="file-contents"] > div',
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]?.textContent).toBe("1export const answer: number = 42;");
		await waitFor(() => coloredSpans().length > 3);
		// Dual-theme tokens: a light color plus the dark variant shiki emits.
		expect(
			coloredSpans().some((span) =>
				span.style.getPropertyValue("--shiki-dark"),
			),
		).toBe(true);
	});

	it("stays plain for languages the highlighter does not know", async () => {
		await act(async () => {
			root.render(<CodeFile contents={"all:\n\techo hi\n"} path="Makefile" />);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		expect(coloredSpans()).toHaveLength(0);
		expect(container.textContent).toContain("echo hi");
	});
});

describe("CodeDiff", () => {
	const oldText = `${Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
	const newText = oldText.replace("line 6\n", "line six\n");

	it("shows the change with context, line numbers, and collapsed gaps", async () => {
		await act(async () => {
			root.render(
				<CodeDiff newText={newText} oldText={oldText} path="a.txt" />,
			);
		});
		const text = container.textContent ?? "";
		expect(text).toContain("2 unchanged lines");
		expect(text).toContain("3 unchanged lines");
		expect(text).toMatch(/66?-line 6/);
		expect(text).toMatch(/6\+line six/);
		expect(text).not.toContain("line 1\n");
	});

	it("highlights changed hunks, including in large files", async () => {
		const body = Array.from(
			{ length: 2_000 },
			(_, i) => `export const value${i} = "${i}";`,
		).join("\n");
		const before = `${body}\n`;
		const after = before.replace(
			'export const value1500 = "1500";',
			'export const value1500 = "changed";',
		);
		await act(async () => {
			root.render(<CodeDiff newText={after} oldText={before} path="big.ts" />);
		});
		await waitFor(() => coloredSpans().length > 0);
		const changed = Array.from(
			container.querySelectorAll('[data-testid="file-diff"] > div'),
		).find((row) => row.textContent?.includes('"changed"'));
		expect(
			Array.from(changed?.querySelectorAll<HTMLElement>("span") ?? []).some(
				(span) => span.style.getPropertyValue("--sdm-c") !== "",
			),
		).toBe(true);
	});

	it("treats a missing old side as an added file", async () => {
		await act(async () => {
			root.render(<CodeDiff newText={"a\nb\n"} path="new.txt" />);
		});
		const rows = Array.from(
			container.querySelectorAll('[data-testid="file-diff"] > div'),
		).map((row) => row.textContent);
		expect(rows).toEqual(["1+a", "2+b"]);
	});

	it("hides line numbers for fragments", async () => {
		await act(async () => {
			root.render(
				<CodeDiff
					fragment
					newText={"after\n"}
					oldText={"before\n"}
					path="x.ts"
				/>,
			);
		});
		const rows = Array.from(
			container.querySelectorAll('[data-testid="file-diff"] > div'),
		).map((row) => row.textContent);
		expect(rows).toEqual(["-before", "+after"]);
	});
});
