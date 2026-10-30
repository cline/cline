// @vitest-environment jsdom

import { act, type MouseEvent, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AlertDialog,
	type AlertDialogProps,
} from "../components/alert-dialog.js";

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
	return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

function button(label: string) {
	const match = Array.from(document.querySelectorAll("button")).find(
		(element) => element.textContent === label,
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
		const overlay = document.querySelector(
			'[data-slot="alert-dialog-overlay"]',
		);
		if (!overlay) throw new Error("Missing alert dialog overlay");
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
}: Partial<AlertDialogProps> & {
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
				<AlertDialog
					title="Delete session?"
					description="This session will be removed from local history."
					confirmLabel="Delete"
					{...props}
					onConfirm={props.onConfirm ?? (() => {})}
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

describe("AlertDialog", () => {
	it("keeps its content and overlay inside an explicitly scoped theme", async () => {
		container.className = "cline-ui-theme dark";
		await render(<Example portalContainer={container} />);
		expect(dialog()?.closest(".cline-ui-theme")).toBe(container);
		expect(dialog()?.closest(".dark")).toBe(container);
		expect(
			container.querySelector('[data-slot="alert-dialog-overlay"]'),
		).not.toBeNull();
		expect(document.activeElement).toBe(button("Cancel"));
	});

	it("supports a primary neutral confirmation with a secondary neutral cancel", async () => {
		await render(<Example confirmTone="neutral" />);
		expect([...button("Delete").classList]).toEqual(
			expect.arrayContaining([
				"cline-ui-button-primary",
				"cline-ui-button-neutral",
				"cline-ui-button-sm",
			]),
		);
		expect([...button("Cancel").classList]).toEqual(
			expect.arrayContaining([
				"cline-ui-button-secondary",
				"cline-ui-button-neutral",
				"cline-ui-button-sm",
			]),
		);
	});

	it("labels the dialog and renders multiple description paragraphs and body content", async () => {
		await render(
			<Example
				description={
					<>
						<p>The running Hub is serving two sessions.</p>
						<p>Updating interrupts those sessions.</p>
					</>
				}
			>
				<code>https://example.com/docs</code>
			</Example>,
		);
		const content = dialog();
		const titleId = content?.getAttribute("aria-labelledby");
		const descriptionId = content?.getAttribute("aria-describedby");
		expect(container.getAttribute("aria-hidden")).toBe("true");
		expect(titleId && document.getElementById(titleId)?.textContent).toBe(
			"Delete session?",
		);
		const description = descriptionId
			? document.getElementById(descriptionId)
			: null;
		expect(description?.querySelectorAll("p")).toHaveLength(2);
		expect(description?.textContent).toContain(
			"Updating interrupts those sessions.",
		);
		expect(content?.querySelector("code")?.textContent).toBe(
			"https://example.com/docs",
		);
	});

	it("starts focus on cancel and includes the scrollable body in the focus trap", async () => {
		await render(<Example />);
		expect(document.activeElement).toBe(button("Cancel"));
		const body = dialog()?.querySelector<HTMLElement>('[role="document"]');
		if (!body) throw new Error("Missing scrollable dialog body");
		await act(async () => body.focus());
		expect(document.activeElement).toBe(body);
		await pressKey(body, "Tab", true);
		expect(document.activeElement).toBe(button("Delete"));
		await pressKey(button("Delete"), "Tab");
		expect(document.activeElement).toBe(body);
	});

	it("closes on Escape and restores focus to the opener", async () => {
		const onOpenChange = vi.fn();
		await render(<Example initialOpen={false} onOpenChange={onOpenChange} />);
		const opener = button("Open dialog");
		await act(async () => {
			opener.focus();
			opener.click();
		});
		expect(document.activeElement).toBe(button("Cancel"));
		await pressKey(button("Cancel"), "Escape");
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(dialog()).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it("ignores outside pointer interactions without requesting dismissal", async () => {
		const onOpenChange = vi.fn();
		await render(<Example onOpenChange={onOpenChange} />);
		await clickOutside();
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(dialog()).not.toBeNull();
		expect(document.activeElement).toBe(button("Cancel"));
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
		await act(async () => button("Cancel").click());
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
		expect(document.activeElement).toBe(button("Cancel"));
		await act(async () => button("Cancel").click());
		expect(dialog()).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it("closes safely when the opener was removed while the dialog was open", async () => {
		await render(<Example initialOpen={false} />);
		const opener = button("Open dialog");
		await act(async () => {
			opener.focus();
			opener.click();
		});
		await render(<Example initialOpen={false} showOpener={false} />);
		expect(opener.isConnected).toBe(false);
		await act(async () => button("Cancel").click());
		expect(dialog()).toBeNull();
		expect(document.activeElement?.isConnected).toBe(true);
	});

	it.each([
		"confirm",
		"cancel",
	] as const)("invokes the %s handler and requests closure by default", async (action) => {
		const onAction = vi.fn();
		const onOpenChange = vi.fn();
		await render(
			<Example
				onConfirm={action === "confirm" ? onAction : undefined}
				onCancel={action === "cancel" ? onAction : undefined}
				onOpenChange={onOpenChange}
			/>,
		);
		await act(async () =>
			button(action === "confirm" ? "Delete" : "Cancel").click(),
		);
		expect(onAction).toHaveBeenCalledOnce();
		expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
		expect(dialog()).toBeNull();
	});

	it.each([
		"confirm",
		"cancel",
	] as const)("keeps the dialog open when the %s handler prevents default", async (action) => {
		const onAction = vi.fn((event: MouseEvent<HTMLButtonElement>) => {
			event.preventDefault();
		});
		const onOpenChange = vi.fn();
		await render(
			<Example
				onConfirm={action === "confirm" ? onAction : undefined}
				onCancel={action === "cancel" ? onAction : undefined}
				onOpenChange={onOpenChange}
			/>,
		);
		await act(async () =>
			button(action === "confirm" ? "Delete" : "Cancel").click(),
		);
		expect(onAction).toHaveBeenCalledOnce();
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(dialog()).not.toBeNull();
	});

	it("disables confirm and cancel independently", async () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn((event: MouseEvent<HTMLButtonElement>) => {
			event.preventDefault();
		});
		await render(
			<Example confirmDisabled onConfirm={onConfirm} onCancel={onCancel} />,
		);
		expect(button("Delete").disabled).toBe(true);
		expect(button("Cancel").disabled).toBe(false);
		await act(async () => {
			button("Delete").click();
			button("Cancel").click();
		});
		expect(onConfirm).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalledOnce();
		await render(
			<Example cancelDisabled onConfirm={onConfirm} onCancel={onCancel} />,
		);
		expect(button("Delete").disabled).toBe(false);
		expect(button("Cancel").disabled).toBe(true);
		await act(async () => button("Cancel").click());
		expect(onCancel).toHaveBeenCalledOnce();
		await act(async () => button("Delete").click());
		expect(onConfirm).toHaveBeenCalledOnce();
		expect(dialog()).toBeNull();
	});

	it("focuses the content when cancel is disabled and confirmation remains available", async () => {
		await render(<Example cancelDisabled />);
		expect(button("Delete").disabled).toBe(false);
		expect(document.activeElement).toBe(dialog());
	});

	it("keeps focus inside a pending dialog with both actions disabled", async () => {
		const onOpenChange = vi.fn();
		await render(
			<Example
				cancelDisabled
				confirmDisabled
				confirmLabel="Updating…"
				onOpenChange={onOpenChange}
			/>,
		);
		expect(dialog()?.contains(document.activeElement)).toBe(true);
		await act(async () => {
			button("Cancel").click();
			button("Updating…").click();
		});
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(dialog()).not.toBeNull();
	});

	it("keeps a pending confirmation open until its host completes the action", async () => {
		let complete: (() => void) | undefined;
		function PendingExample() {
			const [open, setOpen] = useState(true);
			const [pending, setPending] = useState(false);
			return (
				<AlertDialog
					open={open}
					onOpenChange={(nextOpen) => {
						if (!pending) setOpen(nextOpen);
					}}
					title="Save details?"
					description="Save the current session."
					confirmLabel={pending ? "Saving…" : "Save"}
					confirmDisabled={pending}
					cancelDisabled={pending}
					onConfirm={(event) => {
						event.preventDefault();
						setPending(true);
						complete = () => {
							setPending(false);
							setOpen(false);
						};
					}}
				/>
			);
		}
		await render(<PendingExample />);
		await act(async () => button("Save").click());
		expect(button("Saving…").disabled).toBe(true);
		expect(button("Cancel").disabled).toBe(true);
		const content = dialog();
		if (!content) throw new Error("Missing pending confirmation");
		await pressKey(content, "Escape");
		expect(dialog()).toBe(content);
		await act(async () => complete?.());
		expect(dialog()).toBeNull();
	});

	it("allows a controlled parent to reject dismissal and then close or reopen", async () => {
		const onOpenChange = vi.fn();
		const props: AlertDialogProps = {
			open: true,
			onOpenChange,
			title: "Cline Hub update required",
			description: "Choose whether to update the Hub or quit Cline.",
			confirmLabel: "Update Now",
			onConfirm: vi.fn(),
		};
		await render(<AlertDialog {...props} />);
		await pressKey(button("Cancel"), "Escape");
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(dialog()).not.toBeNull();
		await act(async () => button("Cancel").click());
		expect(onOpenChange).toHaveBeenCalledTimes(2);
		expect(dialog()).not.toBeNull();
		await render(<AlertDialog {...props} open={false} />);
		expect(dialog()).toBeNull();
		await render(<AlertDialog {...props} />);
		expect(dialog()).not.toBeNull();
		expect(document.activeElement).toBe(button("Cancel"));
	});
});
