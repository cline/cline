// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MarkdownLinkSafetyModal, MemoizedMarkdown } from "./markdown";

const originalClipboard = Object.getOwnPropertyDescriptor(
	navigator,
	"clipboard",
);

let writeText: ReturnType<typeof vi.fn>;
let openWindow: ReturnType<typeof vi.fn<typeof window.open>>;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	openWindow = vi.fn<typeof window.open>(() => null);
	vi.spyOn(window, "open").mockImplementation(openWindow);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	if (originalClipboard) {
		Object.defineProperty(navigator, "clipboard", originalClipboard);
	} else {
		Reflect.deleteProperty(navigator, "clipboard");
	}
});

async function renderMarkdown(
	props: Parameters<typeof MemoizedMarkdown>[0],
): Promise<void> {
	await act(async () => root.render(<MemoizedMarkdown {...props} />));
}

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function dispatchMouseEvent(
	element: Element,
	type: "auxclick" | "contextmenu",
	button: number,
): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent(type, { bubbles: true, button, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function getButton(label: string): HTMLButtonElement {
	const button = [
		...document.querySelectorAll<HTMLButtonElement>("button"),
	].find((candidate) => candidate.textContent?.trim() === label);
	expect(button).toBeDefined();
	return button as HTMLButtonElement;
}

describe("MemoizedMarkdown interactions", () => {
	test("confirms and closes an external link dialog exactly once", async () => {
		const onClose = vi.fn();
		const onConfirm = vi.fn();
		await act(async () => {
			root.render(
				<MarkdownLinkSafetyModal
					isOpen
					onClose={onClose}
					onConfirm={onConfirm}
					url="https://example.com/review"
				/>,
			);
		});

		await click(getButton("Open link"));
		await vi.waitFor(() => {
			expect(onConfirm).toHaveBeenCalledOnce();
			expect(onClose).toHaveBeenCalledOnce();
		});
	});

	test("opens honest external links directly in the default browser", async () => {
		const url = "https://example.com/review?source=cline";
		await renderMarkdown({ content: `[Review docs](${url})` });
		const link = await vi.waitFor(() => {
			const renderedLink = container.querySelector<HTMLAnchorElement>(
				'[data-streamdown="link"]',
			);
			expect(renderedLink).not.toBeNull();
			return renderedLink as HTMLAnchorElement;
		});
		expect(link.getAttribute("href")).toBe(url);
		expect(link.getAttribute("title")).toBe(url);

		await click(link);
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(openWindow).toHaveBeenCalledTimes(1);
		expect(openWindow).toHaveBeenCalledWith(
			url,
			"_blank",
			"noopener,noreferrer",
		);
	});

	test("requires confirmation before opening a deceptive external link", async () => {
		const url = "https://example.com/review?source=cline";
		await renderMarkdown({ content: `[github.com/cline](${url})` });
		const link = await vi.waitFor(() => {
			const renderedLink = container.querySelector<HTMLElement>(
				'[data-streamdown="link"]',
			);
			expect(renderedLink).not.toBeNull();
			return renderedLink as HTMLElement;
		});
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toBe("#confirm-external-link");

		await dispatchMouseEvent(link, "contextmenu", 2);
		expect(openWindow).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();

		await dispatchMouseEvent(link, "auxclick", 1);
		await vi.waitFor(() => {
			expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
		});
		await click(getButton("Cancel"));

		await click(link);
		await vi.waitFor(() => {
			expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
			expect(document.body.textContent).toContain(url);
		});

		await click(getButton("Cancel"));
		await vi.waitFor(() => {
			expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		});
		expect(openWindow).not.toHaveBeenCalled();

		await click(link);
		await vi.waitFor(() => {
			expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
		});
		await click(getButton("Open link"));

		expect(openWindow).toHaveBeenCalledTimes(1);
		expect(openWindow).toHaveBeenCalledWith(
			url,
			"_blank",
			"noopener,noreferrer",
		);
		await vi.waitFor(() => {
			expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		});
	});

	// The open_external_url sidecar command only opens http(s)/mailto/tel, and
	// relies on Streamdown's harden step blocking every other scheme before it
	// reaches SafeMarkdownLink. If a Streamdown upgrade starts letting other
	// schemes through, confirming those links would silently open nothing.
	test("blocks link schemes the sidecar cannot open before they render", async () => {
		for (const url of ["vscode://settings/editor", "ftp://example.com/f"]) {
			await renderMarkdown({ content: `[Open app](${url})` });
			await vi.waitFor(() => {
				expect(container.textContent).toContain("Open app");
			});
			expect(container.querySelector('[data-streamdown="link"]')).toBeNull();
		}
	});

	test("opens mailto links directly through the external opener", async () => {
		await renderMarkdown({ content: "[Email us](mailto:hi@cline.bot)" });
		const link = await vi.waitFor(() => {
			const renderedLink = container.querySelector<HTMLElement>(
				'[data-streamdown="link"]',
			);
			expect(renderedLink).not.toBeNull();
			return renderedLink as HTMLElement;
		});

		expect(link.tagName).toBe("A");
		await click(link);
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(openWindow).toHaveBeenCalledWith(
			"mailto:hi@cline.bot",
			"_blank",
			"noopener,noreferrer",
		);
	});

	test("keeps same-document links navigable without a confirmation", async () => {
		await renderMarkdown({ content: "[Details](#details)" });
		const link = container.querySelector<HTMLAnchorElement>(
			'[data-streamdown="link"]',
		);

		expect(link?.getAttribute("href")).toBe("#details");
		await click(link as HTMLAnchorElement);
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(openWindow).not.toHaveBeenCalled();
	});

	test("copies fenced code through the Clipboard API", async () => {
		const source = "const answer = 42;";
		await renderMarkdown({
			content: `\`\`\`text\n${source}\n\`\`\``,
		});
		const copyButton = await vi.waitFor(() => {
			const button = container.querySelector<HTMLButtonElement>(
				'[data-streamdown="code-block-copy-button"]',
			);
			expect(button).not.toBeNull();
			return button as HTMLButtonElement;
		});

		await click(copyButton);
		await vi.waitFor(() => {
			expect(writeText).toHaveBeenCalledWith(`${source}\n`);
		});
	});

	test("rerenders incomplete streaming Markdown as completed static Markdown", async () => {
		await renderMarkdown({
			content: "```text\nconst answer =",
			streaming: true,
		});

		await vi.waitFor(() => {
			const codeBlock = container.querySelector(
				'[data-streamdown="code-block"]',
			);
			expect(codeBlock?.getAttribute("data-incomplete")).toBe("true");
		});

		await renderMarkdown({
			content: "```text\nconst answer = 42;\n```\n\nCompleted.",
			streaming: false,
		});

		await vi.waitFor(() => {
			const codeBlock = container.querySelector(
				'[data-streamdown="code-block"]',
			);
			expect(codeBlock).not.toBeNull();
			expect(codeBlock?.getAttribute("data-incomplete")).toBeNull();
			expect(container.textContent).toContain("const answer = 42;");
			expect(container.textContent).toContain("Completed.");
		});
	});
});
