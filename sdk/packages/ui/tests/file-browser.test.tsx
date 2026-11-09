// @vitest-environment jsdom
import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileBrowser, FileBrowserContent } from "../components/file-browser.js";

let container: HTMLDivElement;
let root: Root;
let resizeObservers: Array<() => void>;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	resizeObservers = [];
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
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
async function render(node: ReactNode) {
	await act(async () => root.render(node));
}
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
	it.each([
		"Source",
		"Edit",
	])("labels %s before Preview with scoped tooltips and switches to source", async (sourceLabel) => {
		await render(
			<FileBrowserContent
				path="instructions.md"
				content="# Instructions"
				sourceLabel={sourceLabel}
				preview={<h2>Instructions</h2>}
				actionsPortalContainer={container}
			/>,
		);
		const radios = Array.from(
			container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
		);
		expect(radios.map((radio) => radio.value)).toEqual(["source", "preview"]);
		const [source, preview] = radios;
		if (!source || !preview) throw new Error("Missing display controls");
		expect(radios.map((radio) => radio.labels?.[0]?.textContent)).toEqual([
			sourceLabel,
			"Preview",
		]);
		expect(preview.checked).toBe(true);
		expect(source.closest("[title]")).toBeNull();
		await act(async () => source.focus());
		expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
			sourceLabel,
		);
		await act(async () => preview.focus());
		expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
			"Preview",
		);
		expect(preview.checked).toBe(true);
		await click('input[value="source"]');
		expect(container.querySelector("pre")?.textContent).toBe("# Instructions");
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

	it("keeps the default preview and respects a disabled parent fieldset", async () => {
		await render(
			<fieldset disabled>
				<FileBrowserContent
					headerLabel="Instructions"
					source={<textarea aria-label="Instructions" defaultValue="Draft" />}
					preview={<p>Draft preview</p>}
				/>
			</fieldset>,
		);
		expect(container.querySelector("p")?.textContent).toBe("Draft preview");
		expect(container.querySelector("textarea")?.matches(":disabled")).toBe(
			true,
		);
		expect(
			container.querySelector('input[value="source"]')?.matches(":disabled"),
		).toBe(true);
		await click('input[value="source"]');
		expect(
			container.querySelector("textarea")?.closest("[hidden]"),
		).not.toBeNull();
		expect(container.querySelector("p")?.textContent).toBe("Draft preview");
	});

	it("shows a source-only editor and lets loading and host states override it", async () => {
		const source = <textarea aria-label="Instructions" defaultValue="Draft" />;
		await render(
			<FileBrowserContent headerLabel="Instructions" source={source} />,
		);
		expect(container.querySelector("textarea")?.closest("[hidden]")).toBeNull();
		expect(container.querySelector("textarea")?.value).toBe("Draft");
		expect(container.querySelector("fieldset, pre")).toBeNull();
		await render(
			<FileBrowserContent headerLabel="Instructions" source={source} loading>
				<p role="alert">Unavailable</p>
			</FileBrowserContent>,
		);
		expect(container.querySelector("textarea, p")).toBeNull();
		expect(
			container.querySelector('[data-slot="file-browser-content-skeleton"]'),
		).not.toBeNull();
		await render(
			<FileBrowserContent headerLabel="Instructions" source={source}>
				<p role="alert">Unavailable</p>
			</FileBrowserContent>,
		);
		expect(container.querySelector("textarea")).toBeNull();
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Unavailable",
		);
	});

	it("keeps files selectable before the host chooses a preview", async () => {
		const onSelect = vi.fn();
		await render(
			<FileBrowser files={[{ path: "README.md" }]} onSelect={onSelect} />,
		);
		expect(container.textContent).toContain("Select a file to preview.");
		expect(container.textContent).not.toContain("No preview files available.");
		await click('button[title="README.md"]');
		expect(onSelect).toHaveBeenCalledWith("README.md");
		await render(
			<FileBrowser
				files={[{ path: "README.md" }]}
				selectedPath="README.md"
				onSelect={onSelect}
			>
				<FileBrowserContent path="README.md" content="Selected content" />
			</FileBrowser>,
		);
		expect(container.querySelector("pre")?.textContent).toBe(
			"Selected content",
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

	it("shows the unselected pane for conditionally empty preview children", async () => {
		// biome-ignore lint/complexity/noUselessFragments: Empty fragments are the regression case.
		for (const children of [false, "", <>{null}</>]) {
			await render(
				<FileBrowser files={[{ path: "README.md" }]} onSelect={() => {}}>
					{children}
				</FileBrowser>,
			);
			expect(container.querySelector("nav")).not.toBeNull();
			expect(container.textContent).toContain("Select a file to preview.");
		}
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

	it("supports keyboard bounds and RTL resizing while preserving the width across file selection", async () => {
		mockBrowserGeometry(800);
		function Browser() {
			const [path, setPath] = useState("SKILL.md");
			return (
				<FileBrowser
					dir="rtl"
					files={[{ path: "SKILL.md" }, { path: "guide.md" }]}
					selectedPath={path}
					onSelect={setPath}
				>
					<FileBrowserContent key={path} path={path} content={path} />
				</FileBrowser>
			);
		}
		await render(<Browser />);
		const sidebar = container.querySelector<HTMLElement>(
			".cline-ui-file-browser__sidebar",
		)!;
		const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
		// jsdom does not resolve inherited direction from the section's dir attribute.
		sidebar.style.direction = "rtl";
		const width = () =>
			sidebar.style.getPropertyValue("--cline-ui-file-sidebar-width");
		const key = async (value: string, shiftKey = false) => {
			const event = new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: value,
				shiftKey,
			});
			await act(async () => handle.dispatchEvent(event));
			expect(event.defaultPrevented).toBe(true);
		};
		expect(handle.getAttribute("aria-label")).toBe("Resize Files");
		expect(handle.getAttribute("aria-orientation")).toBe("vertical");
		expect(handle.getAttribute("aria-controls")).toBe(
			container.querySelector("nav")?.id,
		);
		expect(handle.getAttribute("aria-valuemin")).toBe("160");
		expect(handle.getAttribute("aria-valuemax")).toBe("480");
		await key("End");
		expect(width()).toBe("480px");
		await key("Home");
		expect(width()).toBe("160px");
		await key("ArrowRight");
		expect(width()).toBe("160px");
		await key("ArrowLeft");
		expect(width()).toBe("170px");
		await key("ArrowLeft", true);
		expect(width()).toBe("202px");
		await act(async () => {
			for (const measure of resizeObservers) measure();
		});
		expect(handle.getAttribute("aria-valuenow")).toBe("202");
		await click('button[title="guide.md"]');
		expect(container.querySelector("pre")?.textContent).toBe("guide.md");
		expect(width()).toBe("202px");
		await act(async () =>
			handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
		);
		expect(width()).toBe("");
	});

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

	it("renders source-only files verbatim and replaces them with loading and error states", async () => {
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
		await render(
			<FileBrowserContent
				path="check.ts"
				content={source}
				preview={<p>Previous preview</p>}
				loading
				loadingLabel="Loading…"
			>
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
		expect(container.querySelector("pre, p, fieldset")).toBeNull();
		await render(
			<FileBrowserContent path="check.ts">
				<p role="alert">Read failed</p>
			</FileBrowserContent>,
		);
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Read failed",
		);
		expect(
			container.querySelector(
				'[aria-busy="true"], [data-slot="file-browser-content-skeleton"]',
			),
		).toBeNull();
		expect(container.querySelector("output")?.textContent).toBe("");
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
});
