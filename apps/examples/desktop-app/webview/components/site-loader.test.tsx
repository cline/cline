// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { useDesktopReadiness } from "@/hooks/use-desktop-readiness";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
} from "./ui/alert-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "./ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
import { LoadingScreen } from "./views/loading/LoadingScreen";
import { SiteLoader } from "./views/loading/SiteLoader";
import { AddProviderContent } from "./views/settings/add-provider";

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
	act(() => root.unmount());
	root = createRoot(container);
});

it("releases an open modal menu's pointer lock during recovery", async () => {
	const state = readiness();
	state.transport = "connected";
	state.hub = { state: "ready", attempt: 1 };
	const render = () =>
		root.render(
			<SiteLoader readiness={state}>
				<DropdownMenu defaultOpen>
					<DropdownMenuTrigger>Menu</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem>Item</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SiteLoader>,
		);
	await act(async () => render());
	expect(document.body.style.pointerEvents).toBe("none");
	state.transport = "unavailable";
	await act(async () => render());
	expect(
		document
			.querySelector('[role="menu"]')
			?.closest('[style*="display: none"]'),
	).not.toBeNull();
	expect(document.body.style.pointerEvents).not.toBe("none");
	await act(async () => container.querySelector("main button")?.click());
	expect(state.retry).toHaveBeenCalledOnce();
});
const readiness = (): ReturnType<typeof useDesktopReadiness> => ({
	transport: "connecting",
	startup: null,
	hub: { state: "starting", attempt: 1 },
	retry: vi.fn(async () => {}),
	retryError: null,
	retrying: false,
});

it("preserves Add Provider edits and nested model input through repeated recovery", async () => {
	const state = readiness();
	state.transport = "connected";
	state.hub = { state: "ready", attempt: 1 };
	const save = vi.fn(async () => {});
	const render = () =>
		root.render(
			<SiteLoader readiness={state}>
				<Dialog defaultOpen>
					<DialogTrigger>Configure provider</DialogTrigger>
					<DialogContent>
						<DialogTitle>Add Provider</DialogTitle>
						<DialogDescription>Configure a provider</DialogDescription>
						<AddProviderContent
							variant="dialog"
							onBack={vi.fn()}
							onSave={save}
							existingProviderIds={[]}
						/>
					</DialogContent>
				</Dialog>
			</SiteLoader>,
		);
	await act(async () => render());
	const input = (placeholder: string) => {
		const element = document.querySelector<HTMLInputElement>(
			`input[placeholder="${placeholder}"]`,
		);
		if (!element) throw new Error(`Missing input ${placeholder}`);
		return element;
	};
	const edit = async (element: HTMLInputElement, value: string) => {
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set?.call(element, value);
			element.dispatchEvent(new Event("input", { bubbles: true }));
		});
	};
	const fields = [
		["my-provider", "custom-provider"],
		["My Provider", "My custom provider"],
		["https://api.example.com/v1", "https://custom.example/v1"],
		["sk-...", "test-api-key"],
	] as const;
	for (const [placeholder, value] of fields)
		await edit(input(placeholder), value);
	const modelInput = input("Type model ID and press Enter");
	await edit(modelInput, "custom-model");
	await act(async () =>
		modelInput.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		),
	);
	expect(
		document.querySelector('button[aria-label="Remove custom-model"]'),
	).not.toBeNull();
	await edit(modelInput, "unfinished-model");
	const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
	for (let cycle = 0; cycle < 2; cycle++) {
		state.transport = "unavailable";
		await act(async () => render());
		expect(document.querySelector('[role="dialog"]')).toBe(dialog);
		expect(dialog?.style.display).toBe("none");
		expect(document.body.style.pointerEvents).not.toBe("none");
		const retry = container.querySelector<HTMLButtonElement>("main button");
		expect(retry?.closest('[aria-hidden="true"], [inert]')).toBeNull();
		await act(async () => {
			retry?.focus();
			retry?.click();
		});
		expect(document.activeElement).toBe(retry);
		state.transport = "connected";
		await act(async () => render());
		expect(document.querySelector('[role="dialog"]')).toBe(dialog);
		expect(dialog?.style.display).not.toBe("none");
		expect(document.body.style.pointerEvents).toBe("none");
		for (const [placeholder, value] of fields)
			expect(input(placeholder).value).toBe(value);
		expect(
			document.querySelector('button[aria-label="Remove custom-model"]'),
		).not.toBeNull();
		expect(modelInput.value).toBe("unfinished-model");
	}
	expect(state.retry).toHaveBeenCalledTimes(2);
	const submit = Array.from(dialog?.querySelectorAll("button") ?? []).find(
		(button) => button.textContent === "Add Provider",
	);
	expect(submit?.disabled).toBe(false);
	await act(async () => submit?.click());
	expect(save).toHaveBeenCalledWith(
		expect.objectContaining({
			providerId: "custom-provider",
			name: "My custom provider",
			baseUrl: "https://custom.example/v1",
			apiKey: "test-api-key",
			models: ["custom-model"],
		}),
	);
	// Explicitly closing still ends the editing session; only recovery suspends it.
	await act(async () =>
		dialog
			?.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
			?.click(),
	);
	expect(document.querySelector('[role="dialog"]')).toBeNull();
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>('[data-slot="dialog-trigger"]')
			?.click(),
	);
	for (const [placeholder] of fields) expect(input(placeholder).value).toBe("");
});
it("renders initial desktop loading immediately", () => {
	act(() => root.render(<LoadingScreen readiness={readiness()} />));
	expect(container.textContent).toContain("Starting Cline");
	expect(container.textContent).toContain("Starting desktop backend");
	expect(container.querySelector("button")).toBeNull();
});
it("distinguishes hub failure and allows retry", () => {
	const state = readiness();
	state.transport = "connected";
	state.hub = {
		state: "failed",
		attempt: 1,
		message: "Hub initialization timed out",
	};
	act(() => root.render(<LoadingScreen readiness={state} />));
	expect(container.textContent).toContain("Cline could not finish starting");
	expect(container.textContent).toContain("Hub initialization timed out");
	act(() => container.querySelector("button")?.click());
	expect(state.retry).toHaveBeenCalledOnce();
});
it("shows actionable native startup diagnostics independently of authentication", () => {
	const state = readiness();
	state.startup = {
		state: "failed",
		error: "Sidecar exited",
		exitStatus: "exit code 1",
		diagnostics: ["Unable to bind port"],
	};
	act(() => root.render(<LoadingScreen readiness={state} />));
	expect(container.textContent).toContain("Unable to start Cline");
	expect(container.textContent).toContain("Unable to bind port");
	expect(container.textContent).toContain("exit code 1");
	expect(container.querySelector("button")?.textContent).toBe("Retry");
});

it("keeps automatic recovery in the loader without a Retry button or sidebar", () => {
	const state = readiness();
	state.transport = "connected";
	state.hub = { state: "failed", attempt: 1, automaticRetry: true };
	const render = () =>
		root.render(
			<SiteLoader readiness={state}>
				<nav>Sidebar</nav>
			</SiteLoader>,
		);
	act(render);
	expect(container.textContent).toContain("Retrying session service");
	expect(container.querySelector("button")).toBeNull();
	expect(container.querySelector("nav")).toBeNull();
	state.hub = { state: "starting", attempt: 2, step: "connecting" };
	act(render);
	expect(container.textContent).toContain("Connecting to Cline Hub");
	expect(container.querySelector("nav")).toBeNull();
	state.hub = { state: "ready", attempt: 2 };
	act(render);
	expect(container.textContent).toBe("Sidebar");
});

it("shows a spinner with the current step and hides it on failure", () => {
	const state = readiness();
	act(() => root.render(<LoadingScreen readiness={state} />));
	expect(container.querySelector(".animate-spin")).not.toBeNull();
	for (const [step, label] of [
		["discovery", "Discovering or starting Cline Hub"],
		["connecting", "Connecting to Cline Hub"],
		["sessions", "Preparing session service"],
	] as const) {
		state.transport = "connected";
		state.hub = { state: "starting", attempt: 1, step };
		act(() => root.render(<LoadingScreen readiness={state} />));
		expect(container.textContent).toContain(label);
		expect(container.querySelector(".animate-spin")).not.toBeNull();
	}
	state.hub = { state: "failed", attempt: 4 };
	act(() => root.render(<LoadingScreen readiness={state} />));
	expect(container.querySelector(".animate-spin")).toBeNull();
});

it("reveals the app as soon as the hub is ready and never before", () => {
	const state = readiness();
	const render = () =>
		root.render(
			<SiteLoader readiness={state}>
				<nav>Sidebar</nav>
			</SiteLoader>,
		);
	act(render);
	expect(container.querySelector("nav")).toBeNull();
	state.transport = "connected";
	act(render);
	expect(container.querySelector("nav")).toBeNull();
	state.hub = { state: "ready", attempt: 1 };
	act(render);
	expect(container.textContent).toBe("Sidebar");
});

it.each([
	"starting",
	"failed",
] as const)("keeps workspace controls unmounted while the hub is %s", (hubState) => {
	const state = readiness();
	state.transport = "connected";
	state.hub = { state: hubState, attempt: 4 };
	act(() =>
		root.render(
			<SiteLoader readiness={state}>
				<button type="button">Workspace selector</button>
			</SiteLoader>,
		),
	);
	expect(container.textContent).not.toContain("Workspace selector");
	expect(container.textContent).not.toContain("Continue to sign-in");
});

it("keeps the mounted composer and attachments across transport recovery", () => {
	const state = readiness();
	state.transport = "connected";
	state.hub = { state: "ready", attempt: 1 };
	const render = () =>
		root.render(
			<SiteLoader readiness={state}>
				<textarea defaultValue="Unsent draft" />
				<input type="file" />
			</SiteLoader>,
		);
	act(render);
	const composer = container.querySelector("textarea");
	const attachments = container.querySelector("input");
	expect(composer).not.toBeNull();
	state.transport = "connecting";
	state.hub = { state: "starting", attempt: 0 };
	act(render);
	expect(container.querySelector("textarea")).toBe(composer);
	expect(container.querySelector("input")).toBe(attachments);
	expect(composer?.closest("[hidden][inert]")).not.toBeNull();
	state.transport = "connected";
	state.hub = { state: "ready", attempt: 1 };
	act(render);
	expect(container.querySelector("textarea")).toBe(composer);
	expect(composer?.value).toBe("Unsent draft");
	expect(container.querySelector("input")).toBe(attachments);
});

it.each([
	["dialog", Dialog, DialogContent, DialogTitle, DialogDescription],
	[
		"alert dialog",
		AlertDialog,
		AlertDialogContent,
		AlertDialogTitle,
		AlertDialogDescription,
	],
	["sheet", Sheet, SheetContent, SheetTitle, SheetDescription],
] as const)("suspends an open %s during recovery so Retry remains accessible", async (_name, Modal, Content, Title, Description) => {
	const state = readiness();
	state.transport = "connected";
	state.hub = { state: "ready", attempt: 1 };
	const render = () =>
		root.render(
			<SiteLoader readiness={state}>
				<textarea defaultValue="Unsent draft" />
				<input type="file" />
				<Modal defaultOpen>
					<Content>
						<Title>Open modal</Title>
						<Description>Modal content</Description>
					</Content>
				</Modal>
			</SiteLoader>,
		);
	await act(async () => render());
	const composer = container.querySelector("textarea");
	const attachments = container.querySelector("input");
	expect(document.body.style.pointerEvents).toBe("none");
	expect(
		document.querySelector('[role="dialog"], [role="alertdialog"]'),
	).not.toBeNull();
	state.transport = "unavailable";
	state.hub = { state: "starting", attempt: 0 };
	await act(async () => render());
	expect(
		document
			.querySelector('[role="dialog"], [role="alertdialog"]')
			?.closest('[style*="display: none"]'),
	).not.toBeNull();
	expect(document.body.style.pointerEvents).not.toBe("none");
	const retry = container.querySelector("button");
	expect(retry?.closest('[aria-hidden="true"], [inert]')).toBeNull();
	await act(async () => retry?.click());
	expect(state.retry).toHaveBeenCalledOnce();
	expect(container.querySelector("textarea")).toBe(composer);
	expect(container.querySelector("input")).toBe(attachments);
	state.transport = "connected";
	state.hub = { state: "ready", attempt: 1 };
	await act(async () => render());
	expect(
		document.querySelector('[role="dialog"], [role="alertdialog"]'),
	).not.toBeNull();
	expect(document.body.style.pointerEvents).toBe("none");
	expect(container.querySelector("textarea")).toBe(composer);
	expect(composer?.value).toBe("Unsent draft");
	expect(container.querySelector("input")).toBe(attachments);
});
