// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MarkdownLinkSafetyModal, MemoizedMarkdown } from "./markdown";

const mermaidMocks = vi.hoisted(() => ({
	initialize: vi.fn(),
	moduleLoads: 0,
	render: vi.fn(),
}));

type MermaidRenderResult = { svg: string };

function deferredRender() {
	let resolve: (value: MermaidRenderResult) => void = () => {};
	let reject: (reason: unknown) => void = () => {};
	const promise = new Promise<MermaidRenderResult>(
		(resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		},
	);
	return { promise, reject, resolve };
}

vi.mock("mermaid", () => {
	mermaidMocks.moduleLoads += 1;
	return { default: mermaidMocks };
});

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
	// jsdom has no scrollTo; streamdown >=2.6 auto-scrolls streaming code blocks.
	HTMLElement.prototype.scrollTo = vi.fn();
	// jsdom has no pointer capture; Streamdown's pan surface calls it on press.
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = vi.fn();
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
	mermaidMocks.initialize.mockClear();
	mermaidMocks.render.mockReset();
	mermaidMocks.render.mockImplementation(() => new Promise(() => {}));
	vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
		callback({ didTimeout: false, timeRemaining: () => 50 });
		return 1;
	});
	vi.stubGlobal("cancelIdleCallback", () => {});
	const nativeSetTimeout = window.setTimeout.bind(window);
	vi.spyOn(window, "setTimeout").mockImplementation(((
		handler: TimerHandler,
		timeout?: number,
		...args: unknown[]
	) => {
		if (timeout === 300) {
			if (typeof handler === "function") handler(...args);
			return 1;
		}
		return nativeSetTimeout(handler, timeout, ...args);
	}) as typeof window.setTimeout);
	class ImmediateIntersectionObserver {
		readonly root = null;
		readonly rootMargin = "0px";
		readonly thresholds = [0];

		constructor(private readonly callback: IntersectionObserverCallback) {}

		disconnect() {}

		observe(target: Element) {
			this.callback(
				[
					{
						intersectionRatio: 1,
						isIntersecting: true,
						target,
					} as IntersectionObserverEntry,
				],
				this as unknown as IntersectionObserver,
			);
		}

		takeRecords() {
			return [];
		}

		unobserve() {}
	}
	vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
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

async function waitFor(assertion: () => void): Promise<void> {
	await vi.waitFor(async () => {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		assertion();
	});
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
	test("does not load Mermaid for ordinary Markdown", async () => {
		const moduleLoads = mermaidMocks.moduleLoads;
		const renderCalls = mermaidMocks.render.mock.calls.length;
		await renderMarkdown({ content: "Ordinary **Markdown**." });

		await waitFor(() => {
			expect(container.textContent).toContain("Ordinary Markdown.");
		});
		expect(mermaidMocks.render).toHaveBeenCalledTimes(renderCalls);
		expect(mermaidMocks.moduleLoads).toBe(moduleLoads);
	});

	test("renders Mermaid fences with interactive controls", async () => {
		const source = "flowchart LR\nA[Text] --> B[SVG]";
		const render = deferredRender();
		mermaidMocks.render.mockReturnValueOnce(render.promise);
		await renderMarkdown({ content: `\`\`\`mermaid\n${source}\n\`\`\`` });
		await waitFor(() => {
			expect(mermaidMocks.render).toHaveBeenCalledWith(
				expect.any(String),
				`${source}\n`,
			);
		});
		await act(async () => {
			render.resolve({
				svg: `<svg data-testid="rendered-mermaid"><text>${source}</text></svg>`,
			});
			await render.promise;
		});

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rendered-mermaid"]'),
			).not.toBeNull();
		});
		const diagram = container.querySelector<SVGElement>(
			'[data-testid="rendered-mermaid"]',
		);
		expect(diagram?.textContent).toContain(source);
		expect(
			container.querySelector('[data-streamdown="mermaid-block-actions"]'),
		).not.toBeNull();
		expect(container.querySelector('button[title="Copy Code"]')).not.toBeNull();
		expect(
			container.querySelector('button[title="Download diagram"]'),
		).not.toBeNull();
		expect(
			container.querySelector('button[title="View fullscreen"]'),
		).not.toBeNull();

		await click(
			container.querySelector('button[title="Copy Code"]') as HTMLButtonElement,
		);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledWith(expect.stringContaining(source));
		});

		await click(
			container.querySelector(
				'button[title="View fullscreen"]',
			) as HTMLButtonElement,
		);
		await waitFor(() => {
			expect(
				document.querySelector('button[title="Exit fullscreen"]'),
			).not.toBeNull();
		});
		await click(
			document.querySelector(
				'button[title="Exit fullscreen"]',
			) as HTMLButtonElement,
		);
	});

	test("contains Mermaid parse failures without crashing the message", async () => {
		const render = deferredRender();
		mermaidMocks.render.mockReturnValueOnce(render.promise);

		await renderMarkdown({
			content: "Before\n\n```mermaid\nthis is not valid\n```\n\nAfter",
		});
		await waitFor(() => {
			expect(mermaidMocks.render).toHaveBeenCalled();
		});
		await act(async () => {
			render.reject(new Error("Parse error"));
			await render.promise.catch(() => {});
		});

		await waitFor(() => {
			expect(container.textContent).toContain("Mermaid Error: Parse error");
			expect(container.textContent).toContain("Before");
			expect(container.textContent).toContain("After");
		});
	});

	test("settles an incomplete streaming fence into a rendered diagram", async () => {
		await renderMarkdown({
			content: "```mermaid\nflowchart LR\nA --",
			streaming: true,
		});
		expect(
			container.querySelector('[data-streamdown="code-block"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="streamed-mermaid"]'),
		).toBeNull();

		const render = deferredRender();
		mermaidMocks.render.mockReturnValueOnce(render.promise);
		await renderMarkdown({
			content: "```mermaid\nflowchart LR\nA --> B\n```",
			streaming: false,
		});
		await waitFor(() => {
			expect(mermaidMocks.render).toHaveBeenCalledWith(
				expect.any(String),
				"flowchart LR\nA --> B\n",
			);
		});
		await act(async () => {
			render.resolve({
				svg: '<svg data-testid="streamed-mermaid"><text>complete</text></svg>',
			});
			await render.promise;
		});

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="streamed-mermaid"]'),
			).not.toBeNull();
			expect(
				container.querySelector('[data-streamdown="code-block"]'),
			).toBeNull();
		});
	});

	test("keeps the latest diagram when streamed renders finish out of order", async () => {
		const firstRender = deferredRender();
		const finalRender = deferredRender();
		mermaidMocks.render
			.mockReturnValueOnce(firstRender.promise)
			.mockReturnValueOnce(finalRender.promise);

		await renderMarkdown({
			content: "```mermaid\nflowchart LR\nA --> B\n```",
			streaming: true,
		});
		await waitFor(() => {
			expect(mermaidMocks.render).toHaveBeenCalledTimes(1);
		});

		await renderMarkdown({
			content: "```mermaid\nflowchart LR\nA --> B --> C\n```",
			streaming: false,
		});
		await waitFor(() => {
			expect(mermaidMocks.render).toHaveBeenCalledTimes(2);
		});

		await act(async () => {
			finalRender.resolve({
				svg: '<svg data-testid="final-mermaid"><text>final</text></svg>',
			});
			await finalRender.promise;
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="final-mermaid"]'),
			).not.toBeNull();
		});

		await act(async () => {
			firstRender.resolve({
				svg: '<svg data-testid="stale-mermaid"><text>stale</text></svg>',
			});
			await firstRender.promise;
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="final-mermaid"]'),
			).not.toBeNull();
			expect(
				container.querySelector('[data-testid="stale-mermaid"]'),
			).toBeNull();
		});
	});

	// Desktop webview tests colocate beside the component under test (unlike
	// `@cline/ui`, which keeps a package-level `tests/` directory), so this
	// coverage lives next to `markdown.tsx`.
	//
	// Mermaid renders `click <node> "https://…"` directives as live anchors
	// inside the SVG, and Streamdown injects that SVG with
	// `dangerouslySetInnerHTML` — so those anchors never pass through
	// SafeMarkdownLink. @cline/ui strips the navigable href; these assert the
	// desktop surface reattaches them to the confirmation flow instead of
	// letting a diagram click navigate the webview away from the app.
	async function renderDiagramWithLink(
		href = "https://evil.example.com/harvest?t=1",
	): Promise<Element> {
		const render = deferredRender();
		mermaidMocks.render.mockReturnValueOnce(render.promise);
		await renderMarkdown({ content: "```mermaid\nflowchart LR\nA --> B\n```" });
		await waitFor(() => {
			expect(mermaidMocks.render).toHaveBeenCalled();
		});
		await act(async () => {
			render.resolve({
				svg: `<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="${href}" data-testid="diagram-link"><text>Official Cline Docs</text></a></svg>`,
			});
			await render.promise;
		});
		return await vi.waitFor(() => {
			const anchor = container.querySelector('[data-testid="diagram-link"]');
			expect(anchor).not.toBeNull();
			return anchor as Element;
		});
	}

	test("renders a diagram link with no navigable href", async () => {
		const anchor = await renderDiagramWithLink();

		expect(anchor.getAttribute("xlink:href")).toBeNull();
		expect(anchor.getAttribute("href")).toBeNull();
		expect(anchor.getAttribute("data-cline-diagram-href")).toBe(
			"https://evil.example.com/harvest?t=1",
		);
	});

	test("confirms before opening a diagram link, then opens it externally", async () => {
		const anchor = await renderDiagramWithLink();

		await click(anchor);
		await vi.waitFor(() => {
			expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
			expect(document.body.textContent).toContain(
				"https://evil.example.com/harvest?t=1",
			);
		});
		// The label is authored independently of the destination, so the real
		// destination must be what the user is shown before anything opens.
		expect(openWindow).not.toHaveBeenCalled();

		await click(getButton("Open link"));
		expect(openWindow).toHaveBeenCalledTimes(1);
		expect(openWindow).toHaveBeenCalledWith(
			"https://evil.example.com/harvest?t=1",
			"_blank",
			"noopener,noreferrer",
		);
	});

	test("opens nothing when a diagram link confirmation is cancelled", async () => {
		const anchor = await renderDiagramWithLink();

		await click(anchor);
		await vi.waitFor(() => {
			expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
		});
		await click(getButton("Cancel"));

		await vi.waitFor(() => {
			expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		});
		expect(openWindow).not.toHaveBeenCalled();
	});

	// Streamdown's pan/zoom surface calls setPointerCapture on pointerdown, so
	// in a real browser the click lands on that surface, not the anchor. jsdom
	// has no PointerEvent; React only needs the event type and coordinates.
	async function pressAndRelease(
		pressed: Element,
		released: Element,
		dragPx = 0,
	): Promise<void> {
		await act(async () => {
			pressed.dispatchEvent(
				new MouseEvent("pointerdown", {
					bubbles: true,
					clientX: 10,
					clientY: 10,
				}),
			);
			released.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					cancelable: true,
					clientX: 10 + dragPx,
					clientY: 10,
				}),
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}

	test("confirms a diagram link when pointer capture retargets the click", async () => {
		const anchor = await renderDiagramWithLink();
		const panSurface = anchor.closest("svg")?.parentElement as Element;

		await pressAndRelease(anchor, panSurface);
		await vi.waitFor(() => {
			expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
			expect(document.body.textContent).toContain(
				"https://evil.example.com/harvest?t=1",
			);
		});
		expect(openWindow).not.toHaveBeenCalled();
	});

	test("treats a drag that starts on a diagram link as a pan", async () => {
		const anchor = await renderDiagramWithLink();
		const panSurface = anchor.closest("svg")?.parentElement as Element;

		await pressAndRelease(anchor, panSurface, 40);
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(openWindow).not.toHaveBeenCalled();
	});

	test("never surfaces a non-http(s) diagram destination", async () => {
		const anchor = await renderDiagramWithLink("javascript:alert(1)");

		expect(anchor.getAttribute("data-cline-diagram-href")).toBeNull();
		await click(anchor);
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(openWindow).not.toHaveBeenCalled();
	});

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

	// With lineNumbers off, Streamdown emits one bare inline <span> per Shiki
	// token line with no newline text between non-empty lines; the shared
	// @cline/ui markdown.css turns those direct line spans into blocks. This
	// asserts the one-span-per-line structure that CSS contract depends on,
	// after the async Shiki highlight replaces the raw fallback render (the
	// SSR tests never exercise that client-side path).
	test("keeps highlighted code lines as separate line spans", async () => {
		await renderMarkdown({
			content: "```typescript\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```",
		});

		const code = await vi.waitFor(() => {
			const rendered = container.querySelector<HTMLElement>(
				'[data-streamdown="code-block-body"] code',
			);
			expect(rendered).not.toBeNull();
			// Styled token spans only appear once the highlighter callback lands.
			expect(rendered?.querySelector("span > span[style]")).not.toBeNull();
			return rendered as HTMLElement;
		});

		expect([...code.children].map((line) => line.textContent)).toEqual([
			"const a = 1;",
			"const b = 2;",
			"const c = 3;",
		]);
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
