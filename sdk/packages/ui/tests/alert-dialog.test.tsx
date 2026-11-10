// @vitest-environment jsdom

import { act, type MouseEvent, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	AlertDialog,
	type AlertDialogProps,
} from "../components/alert-dialog.js";
import { clickOutside, createDomFixture, pressKey } from "./dom-test-utils.js";

const dom = createDomFixture();
const { render } = dom;

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

function Example({
	onOpenChange,
	initialOpen = true,
	...props
}: Partial<AlertDialogProps> & {
	initialOpen?: boolean;
}) {
	const [open, setOpen] = useState(initialOpen);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Open dialog
			</button>
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
		</>
	);
}

describe("AlertDialog", () => {
	it("keeps its content and overlay inside an explicitly scoped theme", async () => {
		dom.container.className = "cline-ui-theme dark";
		await render(<Example portalContainer={dom.container} />);
		expect(dialog()?.closest(".cline-ui-theme")).toBe(dom.container);
		expect(dialog()?.closest(".dark")).toBe(dom.container);
		expect(
			dom.container.querySelector('[data-slot="alert-dialog-overlay"]'),
		).not.toBeNull();
		expect(document.activeElement).toBe(button("Cancel"));
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
		expect(dom.container.getAttribute("aria-hidden")).toBe("true");
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
		await clickOutside('[data-slot="alert-dialog-overlay"]');
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(dialog()).not.toBeNull();
		expect(document.activeElement).toBe(button("Cancel"));
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

	it("can keep confirmation open declaratively while cancel still closes", async () => {
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();
		await render(
			<Example
				closeOnConfirm={false}
				onConfirm={onConfirm}
				onOpenChange={onOpenChange}
			/>,
		);
		await act(async () => button("Delete").click());
		expect(onConfirm).toHaveBeenCalledOnce();
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(dialog()).not.toBeNull();
		await act(async () => button("Cancel").click());
		expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
		expect(dialog()).toBeNull();
	});

	it.each([
		"confirm",
		"cancel",
	] as const)("blocks passive dismissal while keeping the explicit %s action available", async (action) => {
		const onAction = vi.fn();
		const onOpenChange = vi.fn();
		await render(
			<Example
				dismissible={false}
				onOpenChange={onOpenChange}
				onConfirm={action === "confirm" ? onAction : undefined}
				onCancel={action === "cancel" ? onAction : undefined}
			/>,
		);
		await pressKey(button("Cancel"), "Escape");
		await clickOutside('[data-slot="alert-dialog-overlay"]');
		expect(onOpenChange).not.toHaveBeenCalled();
		await act(async () =>
			button(action === "confirm" ? "Delete" : "Cancel").click(),
		);
		expect(onAction).toHaveBeenCalledOnce();
		expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
		expect(dialog()).toBeNull();
	});

	it("announces confirmation progress, prevents duplicate confirmation, and preserves cancel policy", async () => {
		const onConfirm = vi.fn();
		await render(<Example onConfirm={onConfirm} />);
		await act(async () => button("Delete").focus());
		await render(<Example confirmLoading onConfirm={onConfirm} />);
		expect(button("Delete").getAttribute("aria-busy")).toBe("true");
		expect(button("Delete").disabled).toBe(true);
		expect(button("Cancel").disabled).toBe(false);
		expect(document.activeElement).toBe(dialog());
		await act(async () => button("Delete").click());
		expect(onConfirm).not.toHaveBeenCalled();
		await act(async () => button("Cancel").click());
		expect(dialog()).toBeNull();
	});

	it.each([
		false,
		true,
	])("focuses the content with cancel disabled and confirmDisabled=%s", async (confirmDisabled) => {
		const onOpenChange = vi.fn();
		await render(
			<Example
				cancelDisabled
				confirmDisabled={confirmDisabled}
				onOpenChange={onOpenChange}
			/>,
		);
		expect(button("Delete").disabled).toBe(confirmDisabled);
		expect(document.activeElement).toBe(dialog());
		await act(async () => {
			button("Cancel").click();
			if (confirmDisabled) button("Delete").click();
		});
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(dialog()).not.toBeNull();
	});

	it.each([
		{ action: "Delete", nativeBlur: false, disableBoth: false },
		{ action: "Delete", nativeBlur: true, disableBoth: false },
		{ action: "Cancel", nativeBlur: false, disableBoth: false },
		{ action: "Cancel", nativeBlur: true, disableBoth: false },
		{ action: "Delete", nativeBlur: false, disableBoth: true },
	])("recovers focus when $action becomes disabled with native blur=$nativeBlur and disableBoth=$disableBoth", async ({
		action,
		nativeBlur,
		disableBoth,
	}) => {
		await render(<Example />);
		await act(async () => button(action).focus());
		// Browsers may blur a disabled button to body; jsdom keeps it focused.
		if (nativeBlur) await act(async () => button(action).blur());
		await render(
			<Example
				confirmDisabled={disableBoth || action === "Delete"}
				cancelDisabled={disableBoth || action === "Cancel"}
			/>,
		);
		expect(document.activeElement).toBe(dialog());
	});

	it.each([
		"input",
		'[role="document"]',
	])("preserves focus on %s while both actions become disabled", async (selector) => {
		const view = (pending = false) => (
			<Example confirmDisabled={pending} cancelDisabled={pending}>
				<input aria-label="Confirmation note" />
			</Example>
		);
		await render(view());
		const target = dialog()?.querySelector<HTMLElement>(selector);
		if (!target) throw new Error("Missing focus target");
		await act(async () => target.focus());
		await render(view(true));
		expect(document.activeElement).toBe(target);
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
