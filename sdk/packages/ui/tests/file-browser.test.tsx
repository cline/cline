// @vitest-environment jsdom
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileBrowser, FileBrowserContent } from "../components/file-browser.js";
import { fitFileBrowserPath } from "../components/file-browser-path.js";
import { createDomFixture, pressKey } from "./dom-test-utils.js";

const dom = createDomFixture();
const render = dom.render;
let container: HTMLDivElement;
let resizeObservers: Array<() => void>;
const writeText = vi.fn();
beforeEach(() => {
	container = dom.container;
	resizeObservers = [];
	writeText.mockReset().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: ResizeObserverCallback) {
				resizeObservers.push(() =>
					callback([], this as unknown as ResizeObserver),
				);
			}
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
async function click(selector: string) {
	const control = container.querySelector<HTMLElement>(selector);
	expect(control).not.toBeNull();
	await act(async () => control?.click());
}

function mockBrowserGeometry(layoutWidth: number) {
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			const width = this.classList.contains("cline-ui-file-browser__sidebar")
				? Number.parseFloat(
						this.style.getPropertyValue("--cline-ui-file-sidebar-width"),
					) || 224
				: layoutWidth;
			return new DOMRect(0, 0, width, 624);
		},
	);
}

async function pointer(
	target: HTMLElement,
	type: string,
	clientX: number,
	pointerId = 1,
) {
	// jsdom has MouseEvent but does not implement PointerEvent or pointer capture.
	const event = new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		button: 0,
		clientX,
	});
	Object.defineProperty(event, "pointerId", { value: pointerId });
	await act(async () => target.dispatchEvent(event));
}

describe("FileBrowser", () => {
	it("browses sorted files with collapsible folders and resets the keyed preview", async () => {
		const files = [
			{ path: "SKILL.md" },
			{ path: "references/guide.md" },
			{ path: "references/another.md" },
		];
		function Browser() {
			const [path, setPath] = useState("SKILL.md");
			return (
				<FileBrowser
					files={files}
					onSelect={setPath}
					selectedPath={path}
					filesLabel="Skill files"
				>
					<FileBrowserContent
						key={path}
						path={path}
						content={`# ${path}`}
						preview={<h2>{path}</h2>}
					/>
				</FileBrowser>
			);
		}
		await render(<Browser />);
		expect(
			[...container.querySelectorAll("nav button")].map(
				(node) => node.textContent,
			),
		).toEqual(["references", "another.md", "guide.md", "SKILL.md"]);
		await click('input[value="source"]');
		expect(container.querySelector("pre")?.textContent).toBe("# SKILL.md");
		expect(container.querySelector("h2")).toBeNull();
		await click('button[title="references/guide.md"]');
		expect(container.querySelector("h2")?.textContent).toBe(
			"references/guide.md",
		);
		expect(
			container.querySelector('button[aria-current="page"]')?.textContent,
		).toBe("guide.md");
		expect(
			container.querySelector<HTMLInputElement>('input[value="preview"]')
				?.checked,
		).toBe(true);
		await click('button[title="references"]');
		expect(
			container
				.querySelector('button[title="references"]')
				?.getAttribute("aria-expanded"),
		).toBe("false");
		expect(
			container.querySelector('button[title="references/guide.md"]'),
		).toBeNull();
		expect(container.querySelector("h2")?.textContent).toBe(
			"references/guide.md",
		);
	});

	it("preserves nested collapse state when an ancestor is closed and reopened", async () => {
		await render(
			<FileBrowser
				files={[{ path: "references/examples/guide.md" }]}
				onSelect={() => {}}
			/>,
		);
		await click('button[title="references/examples"]');
		await click('button[title="references"]');
		await click('button[title="references"]');
		expect(
			container
				.querySelector('button[title="references/examples"]')
				?.getAttribute("aria-expanded"),
		).toBe("false");
		expect(
			container.querySelector('button[title="references/examples/guide.md"]'),
		).toBeNull();
		await click('button[title="references/examples"]');
		expect(
			container.querySelector('button[title="references/examples/guide.md"]'),
		).not.toBeNull();
	});

	it("shows the unselected pane until the host renders content", async () => {
		const onSelect = vi.fn();
		// biome-ignore lint/complexity/noUselessFragments: Empty fragments are the regression case.
		for (const children of [undefined, false, "", <>{null}</>]) {
			await render(
				<FileBrowser files={[{ path: "README.md" }]} onSelect={onSelect}>
					{children}
				</FileBrowser>,
			);
			expect(container.textContent).toContain("Select a file to preview.");
		}
		await click('button[title="README.md"]');
		expect(onSelect).toHaveBeenCalledWith("README.md");
	});

	it("shows the empty message or host state without an empty file navigation", async () => {
		await render(
			<FileBrowser files={[]} onSelect={() => {}} emptyMessage="No files" />,
		);
		expect(container.textContent).toBe("No files");
		expect(container.querySelector("nav")).toBeNull();
		await render(
			<FileBrowser files={[]} onSelect={() => {}}>
				<output>Loading directory…</output>
			</FileBrowser>,
		);
		expect(container.textContent).toBe("Loading directory…");
		await render(<FileBrowser files={[]} onSelect={() => {}} loading />);
		expect(container.textContent).toBe("Loading files…");
		expect(
			container
				.querySelector('[data-slot="file-browser-skeleton"]')
				?.getAttribute("aria-hidden"),
		).toBe("true");
		expect(
			container.querySelector("nav, button, input, [tabindex]"),
		).toBeNull();
	});

	it("resizes with the captured pointer, preserves preview space, and stops after cancellation", async () => {
		mockBrowserGeometry(600);
		await render(
			<FileBrowser
				files={[{ path: "SKILL.md" }]}
				selectedPath="SKILL.md"
				onSelect={() => {}}
			>
				<FileBrowserContent path="SKILL.md" content="# Skill" />
			</FileBrowser>,
		);
		const sidebar = container.querySelector<HTMLElement>(
			".cline-ui-file-browser__sidebar",
		)!;
		const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
		let captured: number | undefined;
		handle.setPointerCapture = vi.fn((id) => {
			captured = id;
		});
		handle.hasPointerCapture = (id) => captured === id;
		handle.releasePointerCapture = vi.fn(() => {
			captured = undefined;
		});
		const width = () =>
			sidebar.style.getPropertyValue("--cline-ui-file-sidebar-width");

		await pointer(handle, "pointerdown", 224);
		expect(document.activeElement).toBe(handle);
		expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
		expect(sidebar.hasAttribute("data-resizing")).toBe(true);
		await pointer(handle, "pointermove", 300, 2);
		expect(width()).toBe("");
		await pointer(handle, "pointermove", 300);
		expect(width()).toBe("300px");
		await pointer(handle, "pointermove", 900);
		expect(width()).toBe("360px");
		await pointer(handle, "pointermove", 0);
		expect(width()).toBe("160px");
		await pointer(handle, "pointercancel", 0);
		expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
		expect(sidebar.hasAttribute("data-resizing")).toBe(false);
		await pointer(handle, "pointermove", 400);
		expect(width()).toBe("160px");

		await pointer(handle, "pointerdown", 160);
		await pointer(handle, "pointermove", 200);
		await pointer(handle, "pointerup", 200);
		await pointer(handle, "pointermove", 250);
		expect(width()).toBe("200px");
		expect(sidebar.hasAttribute("data-resizing")).toBe(false);
	});

	it("resizes from the keyboard within bounds and resets on double-click", async () => {
		mockBrowserGeometry(800);
		await render(
			<FileBrowser files={[{ path: "SKILL.md" }]} onSelect={() => {}} />,
		);
		const sidebar = container.querySelector<HTMLElement>(
			".cline-ui-file-browser__sidebar",
		)!;
		const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
		const width = () =>
			sidebar.style.getPropertyValue("--cline-ui-file-sidebar-width");
		expect(handle.getAttribute("aria-controls")).toBe(
			container.querySelector("nav")?.id,
		);
		expect(handle.getAttribute("aria-valuemin")).toBe("160");
		expect(handle.getAttribute("aria-valuemax")).toBe("480");
		await pressKey(handle, "End");
		expect(width()).toBe("480px");
		await pressKey(handle, "Home");
		expect(width()).toBe("160px");
		await pressKey(handle, "ArrowRight");
		expect(width()).toBe("170px");
		await pressKey(handle, "ArrowRight", true);
		expect(width()).toBe("202px");
		await act(async () => {
			for (const measure of resizeObservers) measure();
		});
		expect(handle.getAttribute("aria-valuenow")).toBe("202");
		await act(async () =>
			handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
		);
		expect(width()).toBe("");
	});
});

describe("FileBrowserContent", () => {
	it("keeps fixed sizing by default and exposes content bounds without changing the scroll region", async () => {
		const source = (
			<textarea aria-labelledby="instructions-label" defaultValue="Draft" />
		);
		await render(
			<FileBrowserContent
				headerLabel="Instructions"
				headerLabelId="instructions-label"
				source={source}
			/>,
		);
		const content = container.querySelector<HTMLElement>(
			'[data-slot="file-browser-content"]',
		);
		const body = container.querySelector<HTMLElement>('[role="document"]');
		expect(content?.dataset.sizing).toBe("fixed");
		expect(body?.getAttribute("aria-label")).toBe("Instructions");
		expect(body?.tabIndex).toBe(0);
		expect(document.getElementById("instructions-label")?.textContent).toBe(
			"Instructions",
		);

		await render(
			<FileBrowserContent
				headerLabel="Instructions"
				headerLabelId="instructions-label"
				source={source}
				sizing="content"
				minBodyHeight={288}
				maxBodyHeight="36rem"
			/>,
		);
		expect(container.querySelector('[role="document"]')).toBe(body);
		expect(content?.dataset.sizing).toBe("content");
		expect(
			content?.style.getPropertyValue(
				"--cline-ui-file-browser-body-min-height",
			),
		).toBe("288px");
		expect(
			content?.style.getPropertyValue(
				"--cline-ui-file-browser-body-max-height",
			),
		).toBe("36rem");
		expect(
			container.querySelector("textarea")?.closest('[role="document"]'),
		).toBe(body);
	});

	it("previews edited source without remounting the editor or losing its selection", async () => {
		function EditableContent() {
			const [source, setSource] = useState("Initial instructions");
			return (
				<FileBrowserContent
					headerLabel="Instructions"
					sourceLabel="Edit"
					defaultMode="source"
					source={
						<textarea
							aria-label="Instructions"
							value={source}
							onChange={(event) => setSource(event.target.value)}
						/>
					}
					preview={<p>{source}</p>}
				/>
			);
		}
		await render(<EditableContent />);
		const textarea = container.querySelector("textarea");
		if (!textarea) throw new Error("Instructions editor is missing");
		expect(
			container.querySelector(".cline-ui-file-browser__path")?.textContent,
		).toBe("Instructions");
		expect(container.querySelector('[aria-label="File actions"]')).toBeNull();
		expect(
			container.querySelector('[aria-label="Instructions display"]'),
		).not.toBeNull();
		expect(
			container.querySelector<HTMLInputElement>('input[value="source"]')
				?.labels?.[0]?.textContent,
		).toBe("Edit");
		expect(container.querySelector("p, pre")).toBeNull();
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set?.call(textarea, "Updated instructions");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
		textarea.setSelectionRange(3, 10);
		await click('input[value="preview"]');
		expect(container.querySelector("p")?.textContent).toBe(
			"Updated instructions",
		);
		expect(container.querySelector("textarea")).toBe(textarea);
		expect(textarea.closest("[hidden]")).not.toBeNull();
		await click('input[value="source"]');
		expect(container.querySelector("textarea")).toBe(textarea);
		expect(textarea.closest("[hidden]")).toBeNull();
		expect(textarea.value).toBe("Updated instructions");
		expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 10]);
	});

	it("renders source verbatim and lets loading and host states override all content", async () => {
		const source = '<script>alert("test")</script>\n  indented';
		await render(<FileBrowserContent path="check.ts" content={source} />);
		expect(container.querySelector("pre")?.textContent).toBe(source);
		expect(
			container.querySelector<HTMLElement>('[role="document"]')?.tabIndex,
		).toBe(0);
		expect(
			container.querySelector('[role="document"]')?.getAttribute("aria-label"),
		).toBe("check.ts");
		expect(container.querySelector("script, fieldset")).toBeNull();
		const contentProps = {
			path: "check.ts",
			content: source,
			source: <textarea aria-label="Source" defaultValue="Draft" />,
			preview: <p>Previous preview</p>,
		};
		await render(
			<FileBrowserContent {...contentProps} loading loadingLabel="Loading…">
				<p>Previous content</p>
			</FileBrowserContent>,
		);
		expect(container.querySelector("output")?.textContent).toBe("Loading…");
		expect(
			container.querySelector("output")?.closest('[aria-busy="true"]'),
		).toBeNull();
		expect(
			container
				.querySelector('[data-slot="file-browser-content-skeleton"]')
				?.getAttribute("aria-hidden"),
		).toBe("true");
		expect(container.querySelector("pre, p, textarea, fieldset")).toBeNull();
		await render(
			<FileBrowserContent {...contentProps}>
				<p role="alert">Read failed</p>
			</FileBrowserContent>,
		);
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Read failed",
		);
		expect(container.querySelector("pre, textarea")).toBeNull();
		expect(container.textContent).not.toContain("Previous preview");
		expect(
			container.querySelector(
				'[aria-busy="true"], [data-slot="file-browser-content-skeleton"]',
			),
		).toBeNull();
		expect(container.querySelector("output")?.textContent).toBe("");
	});
});

async function openMenu() {
	const trigger = container.querySelector<HTMLButtonElement>(
		'[aria-label="File actions"]',
	);
	if (!trigger) throw new Error("Missing file actions");
	await act(async () => {
		trigger.focus();
		trigger.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
	});
	return trigger;
}
function item(label: string) {
	const match = [
		...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	].find((node) => node.textContent === label);
	if (!match) throw new Error(`Missing action: ${label}`);
	return match;
}
async function select(label: string) {
	await act(async () => item(label).click());
}

describe("FileBrowserContent actions", () => {
	it("shows by default, copies the displayed path, and allows consumers to opt out", async () => {
		await render(<FileBrowserContent path="references/guide.md" />);
		await openMenu();
		expect(item("Open file location").getAttribute("aria-disabled")).toBe(
			"true",
		);
		await select("Copy path");
		expect(writeText).toHaveBeenCalledExactlyOnceWith("references/guide.md");
		expect(container.textContent).toContain("Path copied.");
		await render(
			<FileBrowserContent path="references/guide.md" showActions={false} />,
		);
		expect(container.querySelector('[aria-label="File actions"]')).toBeNull();
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it("passes an opaque action path unchanged to host actions", async () => {
		const path = "\\\\server\\shared folder\\SKILL.md";
		const open = vi.fn().mockResolvedValue(undefined);
		const copy = vi.fn().mockResolvedValue(undefined);
		await render(
			<FileBrowserContent
				path="SKILL.md"
				actionPath={path}
				onOpenFileLocation={open}
				onCopyPath={copy}
			/>,
		);
		const trigger = await openMenu();
		await act(async () =>
			item("Open file location").dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			),
		);
		expect(document.querySelector('[role="menu"]')).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
		await openMenu();
		await select("Open file location");
		expect(open).toHaveBeenCalledExactlyOnceWith(path);
		await openMenu();
		await select("Copy path");
		expect(copy).toHaveBeenCalledExactlyOnceWith(path);
		expect(writeText).not.toHaveBeenCalled();
	});

	it("reports failures and lets the user retry", async () => {
		writeText.mockRejectedValueOnce(new Error("Permission denied"));
		await render(<FileBrowserContent path="SKILL.md" />);
		await openMenu();
		await select("Copy path");
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Could not copy path.",
		);
		await openMenu();
		await select("Copy path");
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(container.textContent).toContain("Path copied.");
	});
});

describe("fitFileBrowserPath", () => {
	// Five 40px segments, 10px separators with 5px gaps on each side, 20px ellipsis.
	const entriesFor = (available: number, count = 5) =>
		fitFileBrowserPath(Array(count).fill(40), available, 10, 5, 20);

	it("keeps the root and the closest parents around an ellipsis", () => {
		expect(entriesFor(280)).toEqual([0, 1, 2, 3, 4]);
		expect(entriesFor(279)).toEqual([0, "ellipsis", 2, 3, 4]);
		expect(entriesFor(140)).toEqual([0, "ellipsis", 4]);
	});

	it("drops the root, then the ellipsis, when space runs out", () => {
		expect(entriesFor(139)).toEqual(["ellipsis", 4]);
		expect(entriesFor(79)).toEqual([4]);
		expect(entriesFor(90, 2)).toEqual(["ellipsis", 1]);
	});
});
