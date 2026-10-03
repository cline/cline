// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Streamdown } from "streamdown";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	agentMarkdownControls,
	markdownCodeHighlighter,
} from "../components/markdown";

// Vitest rewrites import.meta.url under jsdom, so resolve from the package
// root (the vitest config pins `root` to this package).
const markdownCss = readFileSync(
	join(process.cwd(), "components/markdown.css"),
	"utf8",
);

let container: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	style = document.createElement("style");
	style.textContent = markdownCss;
	document.head.appendChild(style);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	style.remove();
	vi.restoreAllMocks();
});

async function renderFence(content: string): Promise<HTMLElement> {
	await act(async () =>
		root.render(
			<Streamdown
				className="cline-markdown"
				controls={agentMarkdownControls}
				lineNumbers={false}
				mode="static"
				plugins={{ code: markdownCodeHighlighter }}
			>
				{content}
			</Streamdown>,
		),
	);
	return vi.waitFor(() => {
		const code = container.querySelector<HTMLElement>(
			'[data-streamdown="code-block-body"] code',
		);
		expect(code).not.toBeNull();
		return code as HTMLElement;
	});
}

/**
 * Streamdown emits one <span> per Shiki token line with no newline text
 * between non-empty lines, and only applies its own block line class when
 * lineNumbers is on. With lineNumbers off, line separation exists only
 * because markdown.css makes the line spans display: block — without it
 * every multi-line fence collapses into one run-on line (white-space: pre
 * has no newline characters to preserve).
 */
describe("fenced code block line separation", () => {
	test("stacks highlighted lines as blocks once Shiki tokens apply", async () => {
		const code = await renderFence(
			"```typescript\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```",
		);

		// The shared highlighter resolves asynchronously; wait until the themed
		// tokens (styled child spans) replace Streamdown's raw fallback render.
		await vi.waitFor(() => {
			expect(
				code.querySelector<HTMLElement>("span > span[style]"),
			).not.toBeNull();
		});

		const lines = [...code.children].filter(
			(child): child is HTMLElement => child instanceof HTMLElement,
		);
		expect(lines.map((line) => line.textContent)).toEqual([
			"const a = 1;",
			"const b = 2;",
			"const c = 3;",
		]);
		for (const line of lines) {
			expect(getComputedStyle(line).display).toBe("block");
		}
	});

	test("keeps unhighlighted fences and empty lines separated", async () => {
		const code = await renderFence("```\ntick 1\n\ntick 3\n```");

		const lines = [...code.children].filter(
			(child): child is HTMLElement => child instanceof HTMLElement,
		);
		expect(lines.map((line) => line.textContent)).toEqual([
			"tick 1",
			"\n",
			"tick 3",
		]);
		for (const line of lines) {
			expect(getComputedStyle(line).display).toBe("block");
		}
	});
});
