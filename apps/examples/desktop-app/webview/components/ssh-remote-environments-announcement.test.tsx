// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMOTE_ENVIRONMENTS_DOCS_URL } from "@/lib/remote-environments";
import { SshRemoteEnvironmentsAnnouncement } from "./ssh-remote-environments-announcement";

const { openExternalUrl } = vi.hoisted(() => ({
	openExternalUrl: vi.fn(async () => {}),
}));

vi.mock("@/lib/desktop-client", () => ({ openExternalUrl }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	if (!("ResizeObserver" in globalThis)) {
		Object.assign(globalThis, {
			ResizeObserver: class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		});
	}
	Element.prototype.scrollIntoView ??= () => {};
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.releasePointerCapture ??= () => {};
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await Promise.resolve();
	});
}

function buttonNamed(name: string): HTMLButtonElement {
	const button = [...document.querySelectorAll("button")].find(
		(element) => element.textContent?.trim() === name,
	);
	if (!button) throw new Error(`Missing "${name}" button`);
	return button;
}

async function render(props: {
	open: boolean;
	onOpenChange?: (open: boolean) => void;
	onSetUpHost?: () => void;
}): Promise<void> {
	await act(async () => {
		root.render(
			<SshRemoteEnvironmentsAnnouncement
				onOpenChange={props.onOpenChange ?? (() => {})}
				onSetUpHost={props.onSetUpHost ?? (() => {})}
				open={props.open}
			/>,
		);
	});
}

describe("SshRemoteEnvironmentsAnnouncement", () => {
	it("renders the spotlight with its preview and steps when open", async () => {
		await render({ open: true });

		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog).not.toBeNull();
		expect(dialog?.textContent).toContain("Run Cline on any machine over SSH");
		expect(dialog?.textContent).toContain("Add a host in Settings → Remote");
		expect(dialog?.textContent).toContain(
			"Pick it from the environment selector",
		);
		expect(dialog?.textContent).toContain("Open a project on that machine");
		expect(
			document.querySelector('[data-testid="ssh-announcement-preview"]'),
		).not.toBeNull();
	});

	it("renders nothing while closed", async () => {
		await render({ open: false });
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("routes the primary action to host setup", async () => {
		const onSetUpHost = vi.fn();
		const onOpenChange = vi.fn();
		await render({ open: true, onSetUpHost, onOpenChange });

		await click(buttonNamed("Set up an SSH host"));

		expect(onSetUpHost).toHaveBeenCalledTimes(1);
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it("opens the setup guide without closing or routing to setup", async () => {
		const onSetUpHost = vi.fn();
		const onOpenChange = vi.fn();
		await render({ open: true, onSetUpHost, onOpenChange });

		await click(buttonNamed("Read the setup guide"));

		expect(openExternalUrl).toHaveBeenCalledWith(REMOTE_ENVIRONMENTS_DOCS_URL);
		expect(onSetUpHost).not.toHaveBeenCalled();
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it("closes through onOpenChange from the secondary action", async () => {
		const onSetUpHost = vi.fn();
		const onOpenChange = vi.fn();
		await render({ open: true, onSetUpHost, onOpenChange });

		await click(buttonNamed("Maybe later"));

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onSetUpHost).not.toHaveBeenCalled();
	});
});
