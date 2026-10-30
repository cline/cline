// @vitest-environment jsdom

import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertDialog } from "../components/alert-dialog.js";
import { Dialog, type DialogProps } from "../components/dialog.js";

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

function dialog() {
	return document.querySelector<HTMLElement>('[role="dialog"]');
}

function button(label: string) {
	const match = Array.from(document.querySelectorAll("button")).find(
		(element) =>
			element.textContent === label ||
			element.getAttribute("aria-label") === label,
	);
	if (!match) throw new Error(`Missing button: ${label}`);
	return match;
}

async function pressKey(target: Element, key: string, shiftKey = false) {
	await act(async () => {
		target.dispatchEvent(
			new KeyboardEvent("keydown", {
				key,
				shiftKey,
				bubbles: true,
				cancelable: true,
			}),
		);
	});
}

async function clickOutside() {
	// Radix installs its document pointer listener on the next task, avoiding
	// treating the pointer event that opened a dialog as an outside interaction.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
		const overlay = document.querySelector('[data-slot="dialog-overlay"]');
		if (!overlay) throw new Error("Missing dialog overlay");
		overlay.dispatchEvent(
			new MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);
	});
}

function Example({
	onOpenChange,
	initialOpen = true,
	conditional = false,
	showOpener = true,
	...props
}: Partial<DialogProps> & {
	initialOpen?: boolean;
	conditional?: boolean;
	showOpener?: boolean;
}) {
	const [open, setOpen] = useState(initialOpen);
	return (
		<>
			{showOpener ? (
				<button type="button" onClick={() => setOpen(true)}>
					Open dialog
				</button>
			) : null}
			{!conditional || open ? (
				<Dialog
					title="Session details"
					{...props}
					open={props.open ?? open}
					onOpenChange={(nextOpen) => {
						onOpenChange?.(nextOpen);
						setOpen(nextOpen);
					}}
				/>
			) : null}
		</>
	);
}

describe("Dialog", () => {
	it("keeps its content and overlay inside an explicitly scoped theme", async () => {
		container.className = "cline-ui-theme dark";
		await render(<Example portalContainer={container} />);
		expect(dialog()?.closest(".cline-ui-theme")).toBe(container);
		expect(dialog()?.closest(".dark")).toBe(container);
		expect(
			container.querySelector('[data-slot="dialog-overlay"]'),
		).not.toBeNull();
		expect(document.activeElement).toBe(dialog());
	});

	it("labels the dialog and associates a rich description with its content", async () => {
		await render(
			<Example
				description={
					<>
						<p>Choose which sessions to include.</p>
						<p>Conversation contents are excluded.</p>
					</>
				}
			>
				<label>
					<input type="checkbox" /> Include this session
				</label>
			</Example>,
		);
		const content = dialog();
		const titleId = content?.getAttribute("aria-labelledby");
		const descriptionId = content?.getAttribute("aria-describedby");
		expect(container.getAttribute("aria-hidden")).toBe("true");
		expect(titleId && document.getElementById(titleId)?.textContent).toBe(
			"Session details",
		);
		const description = descriptionId
			? document.getElementById(descriptionId)
			: null;
		expect(description?.querySelectorAll("p")).toHaveLength(2);
		expect(description?.textContent).toContain(
			"Conversation contents are excluded.",
		);
		expect(content?.querySelector('input[type="checkbox"]')).not.toBeNull();
	});

	it("supports a title without an optional description", async () => {
		await render(<Example>Session metadata</Example>);
		expect(dialog()?.getAttribute("aria-describedby")).toBeNull();
		expect(dialog()?.textContent).toContain("Session metadata");
	});

	it("omits empty optional slots while keeping numeric content", async () => {
		await render(
			<Example
				description={
					<>
						{false}
						{""}
					</>
				}
				footer={false}
			>
				{true}
			</Example>,
		);
		expect(dialog()?.getAttribute("aria-describedby")).toBeNull();
		expect(dialog()?.querySelector('[data-slot="dialog-body"]')).toBeNull();
		expect(dialog()?.querySelector('[data-slot="dialog-footer"]')).toBeNull();
		await render(<Example description={0}>{0}</Example>);
		expect(
			dialog()?.querySelector('[data-slot="dialog-description"]')?.textContent,
		).toBe("0");
		expect(
			dialog()?.querySelector('[data-slot="dialog-body"]')?.textContent,
		).toBe("0");
	});

	it("makes only an overflowing scrollable header keyboard focusable", async () => {
		let resize: (() => void) | undefined;
		const observe = vi.fn();
		const disconnect = vi.fn();
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: () => void) {
					resize = callback;
				}
				observe = observe;
				disconnect = disconnect;
			},
		);
		try {
			await render(
				<Example
					description={<p>Detailed connector instructions.</p>}
					headerClassName="branded-header"
					headerStyle={{ overflowY: "auto", backgroundColor: "purple" }}
					bodyClassName="custom-body"
				>
					Available tools
				</Example>,
			);
			const header = dialog()?.querySelector<HTMLElement>(
				'[data-slot="dialog-header"]',
			);
			if (!header) throw new Error("Missing dialog header");
			expect(header.classList.contains("branded-header")).toBe(true);
			expect(header.style.backgroundColor).toBe("purple");
			expect(dialog()?.querySelector(".custom-body")?.textContent).toBe(
				"Available tools",
			);
			expect(header.hasAttribute("tabindex")).toBe(false);
			let scrollHeight = 400;
			Object.defineProperties(header, {
				clientHeight: { get: () => 120 },
				scrollHeight: { get: () => scrollHeight },
			});
			await act(async () => resize?.());
			expect(header.tabIndex).toBe(0);
			expect(observe).toHaveBeenCalledWith(header);
			expect(observe).toHaveBeenCalledWith(
				header.querySelector('[data-slot="dialog-description"]'),
			);
			await act(async () => header.focus());
			expect(document.activeElement).toBe(header);
			scrollHeight = 100;
			await act(async () => resize?.());
			expect(header.hasAttribute("tabindex")).toBe(false);
			// CommandDialog uses a visually hidden header; it must not gain a tab stop.
			header.style.overflowY = "hidden";
			scrollHeight = 400;
			await act(async () => resize?.());
			expect(header.hasAttribute("tabindex")).toBe(false);
			await render(null);
			expect(disconnect).toHaveBeenCalledOnce();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("starts focus on the content and traps focus across body and footer controls", async () => {
		await render(
			<Example footer={<button type="button">Save</button>}>
				<label>
					Name <input />
				</label>
			</Example>,
		);
		expect(document.activeElement).toBe(dialog());
		const body = dialog()?.querySelector<HTMLElement>('[role="document"]');
		if (!body) throw new Error("Missing scrollable dialog body");
		await act(async () => button("Close").focus());
		await pressKey(button("Close"), "Tab");
		expect(document.activeElement).toBe(body);
		await pressKey(body, "Tab", true);
		expect(document.activeElement).toBe(button("Close"));
		await act(async () => button("Save").focus());
		expect(document.activeElement).toBe(button("Save"));
		await act(async () => button("Open dialog").focus());
		expect(dialog()?.contains(document.activeElement)).toBe(true);
	});

	it.each([
		"Escape",
		"close button",
		"outside pointer",
	] as const)("closes with %s and restores focus to the opener", async (method) => {
		const onOpenChange = vi.fn();
		await render(<Example initialOpen={false} onOpenChange={onOpenChange} />);
		const opener = button("Open dialog");
		await act(async () => {
			opener.focus();
			opener.click();
		});
		expect(document.activeElement).toBe(dialog());
		if (method === "Escape") {
			await pressKey(button("Close"), "Escape");
		} else if (method === "close button") {
			await act(async () => button("Close").click());
		} else {
			await clickOutside();
		}
		expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
		expect(dialog()).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it.each([
		false,
		true,
	])("restores focus after a child uses autoFocus (conditional mount: %s)", async (conditional) => {
		await render(
			<Example conditional={conditional} initialOpen={false}>
				<label>
					Name
					{/* biome-ignore lint/a11y/noAutofocus: Verify focus restoration when a host intentionally autofocuses a dialog field. */}
					<input autoFocus />
				</label>
			</Example>,
		);
		const opener = button("Open dialog");
		await act(async () => {
			opener.focus();
			opener.click();
		});
		expect(document.activeElement).toBe(dialog()?.querySelector("input"));
		await act(async () => button("Close").click());
		expect(dialog()).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it("restores focus when the host conditionally mounts and removes the entire dialog", async () => {
		await render(<Example conditional initialOpen={false} />);
		const opener = button("Open dialog");
		await act(async () => {
			opener.focus();
			opener.click();
		});
		expect(document.activeElement).toBe(dialog());
		await act(async () => button("Close").click());
		expect(dialog()).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it("restores focus through a nested confirmation and then back to the original opener", async () => {
		function NestedExample() {
			const [open, setOpen] = useState(false);
			const [confirmOpen, setConfirmOpen] = useState(false);
			return (
				<>
					<button type="button" onClick={() => setOpen(true)}>
						Open session
					</button>
					{open ? (
						<Dialog open onOpenChange={setOpen} title="Session details">
							<button type="button" onClick={() => setConfirmOpen(true)}>
								Delete session
							</button>
							{confirmOpen ? (
								<AlertDialog
									open
									onOpenChange={setConfirmOpen}
									title="Delete session?"
									description="This session will be removed from local history."
									confirmLabel="Delete"
									onConfirm={() => {}}
								/>
							) : null}
						</Dialog>
					) : null}
				</>
			);
		}

		await render(<NestedExample />);
		const opener = button("Open session");
		await act(async () => {
			opener.focus();
			opener.click();
		});
		const parentDialog = dialog();
		const confirmOpener = button("Delete session");
		await act(async () => {
			confirmOpener.focus();
			confirmOpener.click();
		});
		expect(document.activeElement).toBe(button("Cancel"));
		await act(async () => button("Cancel").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(dialog()).toBe(parentDialog);
		await vi.waitFor(() => expect(document.activeElement).toBe(confirmOpener));
		await pressKey(confirmOpener, "Escape");
		expect(dialog()).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it("lets hosts choose initial focus and override focus restoration", async () => {
		await render(
			<>
				<button type="button">Next step</button>
				<Example
					initialOpen={false}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						dialog()?.querySelector("input")?.focus();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						button("Next step").focus();
					}}
				>
					<label>
						Search <input />
					</label>
				</Example>
			</>,
		);
		await act(async () => {
			button("Open dialog").focus();
			button("Open dialog").click();
		});
		expect(document.activeElement).toBe(dialog()?.querySelector("input"));
		await act(async () => button("Close").click());
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(button("Next step")),
		);
	});

	it("allows a controlled parent to reject every dismissal while an action is pending", async () => {
		const onOpenChange = vi.fn();
		const props: DialogProps = {
			open: true,
			onOpenChange,
			title: "Exporting diagnostics",
			footer: (
				<button disabled type="button">
					Exporting…
				</button>
			),
		};
		await render(<Dialog {...props} />);
		await pressKey(button("Close"), "Escape");
		await act(async () => button("Close").click());
		await clickOutside();
		expect(onOpenChange).toHaveBeenCalledTimes(3);
		expect(
			onOpenChange.mock.calls.every(([nextOpen]) => nextOpen === false),
		).toBe(true);
		expect(dialog()).not.toBeNull();
		expect(dialog()?.contains(document.activeElement)).toBe(true);
		await render(<Dialog {...props} open={false} />);
		expect(dialog()).toBeNull();
		await render(<Dialog {...props} />);
		expect(document.activeElement).toBe(dialog());
	});

	it("lets hosts prevent Escape and outside dismissal before a close request", async () => {
		const onOpenChange = vi.fn();
		await render(
			<Example
				onOpenChange={onOpenChange}
				onEscapeKeyDown={(event) => event.preventDefault()}
				onPointerDownOutside={(event) => event.preventDefault()}
			/>,
		);
		await pressKey(button("Close"), "Escape");
		await clickOutside();
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(dialog()).not.toBeNull();
	});

	it("keeps focus inside when the close button is hidden and footer actions are disabled", async () => {
		await render(
			<Dialog
				open
				onOpenChange={() => {}}
				title="Importing sessions"
				showCloseButton={false}
				footer={
					<button disabled type="button">
						Importing…
					</button>
				}
			/>,
		);
		expect(document.querySelector('button[aria-label="Close"]')).toBeNull();
		const content = dialog();
		if (!content) throw new Error("Missing dialog");
		expect(document.activeElement).toBe(content);
		await pressKey(content, "Tab");
		await pressKey(content, "Tab", true);
		expect(document.activeElement).toBe(content);
	});

	it("leaves footer actions under the host's control without automatically closing", async () => {
		const onExport = vi.fn();
		const onOpenChange = vi.fn();
		await render(
			<Example
				onOpenChange={onOpenChange}
				footer={
					<button type="button" onClick={onExport}>
						Export
					</button>
				}
			/>,
		);
		await act(async () => button("Export").click());
		expect(onExport).toHaveBeenCalledOnce();
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(dialog()).not.toBeNull();
	});

	it("closes safely when the original opener was removed", async () => {
		await render(<Example initialOpen={false} />);
		const opener = button("Open dialog");
		await act(async () => {
			opener.focus();
			opener.click();
		});
		await render(<Example initialOpen={false} showOpener={false} />);
		expect(opener.isConnected).toBe(false);
		await act(async () => button("Close").click());
		expect(dialog()).toBeNull();
		await vi.waitFor(() =>
			expect(document.activeElement?.isConnected).toBe(true),
		);
	});
});
