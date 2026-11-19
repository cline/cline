// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	UnsavedChangesProvider,
	useLeaveConfirmation,
	useUnsavedChangesGuard,
	useUnsavedChangesRegistry,
} from "./unsaved-changes";

let root: Root;
let container: HTMLDivElement;
let dirty: boolean;
let confirmLeaveFromShell: ReturnType<
	typeof useUnsavedChangesRegistry
>["confirmLeave"];
let confirmLeaveFromPage: ReturnType<typeof useLeaveConfirmation>;
let guard: ReturnType<typeof useUnsavedChangesGuard>;
let dirtyEditors: boolean[] = [];
let editorGuards: Array<ReturnType<typeof useUnsavedChangesGuard>> = [];

function Editor() {
	guard = useUnsavedChangesGuard(() => dirty);
	confirmLeaveFromPage = useLeaveConfirmation();
	return <output>{guard.isConfirming ? "confirming" : "idle"}</output>;
}

function Shell({ editing }: { editing: boolean }) {
	const { registry, confirmLeave } = useUnsavedChangesRegistry();
	confirmLeaveFromShell = confirmLeave;
	return (
		<UnsavedChangesProvider registry={registry}>
			{editing ? <Editor /> : null}
		</UnsavedChangesProvider>
	);
}

function MultipleEditor({ index }: { index: number }) {
	const editorGuard = useUnsavedChangesGuard(() => dirtyEditors[index]);
	editorGuards[index] = editorGuard;
	return (
		<output data-editor={index}>
			{editorGuard.isConfirming ? "confirming" : "idle"}
		</output>
	);
}

function MultipleEditorsShell() {
	const { registry, confirmLeave } = useUnsavedChangesRegistry();
	confirmLeaveFromShell = confirmLeave;
	return (
		<UnsavedChangesProvider registry={registry}>
			<MultipleEditor index={0} />
			<MultipleEditor index={1} />
		</UnsavedChangesProvider>
	);
}

const status = () => container.querySelector("output")?.textContent;

beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	dirty = false;
	dirtyEditors = [];
	editorGuards = [];
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () => root.render(<Shell editing />));
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

it("lets navigation through when nothing would be lost", () => {
	const proceed = vi.fn();
	confirmLeaveFromShell(proceed);
	confirmLeaveFromPage(proceed);
	guard.requestLeave(proceed);
	expect(proceed).toHaveBeenCalledTimes(3);
	expect(status()).toBe("idle");
});

it("holds navigation from the shell or the page until the draft is discarded", async () => {
	dirty = true;
	const proceed = vi.fn();
	const onCancel = vi.fn();
	await act(async () => confirmLeaveFromShell(proceed, onCancel));
	expect(proceed).not.toHaveBeenCalled();
	expect(status()).toBe("confirming");

	await act(async () => guard.cancel());
	expect(status()).toBe("idle");
	expect(proceed).not.toHaveBeenCalled();
	expect(onCancel).toHaveBeenCalledOnce();

	await act(async () => confirmLeaveFromPage(proceed, onCancel));
	expect(status()).toBe("confirming");
	await act(async () => guard.confirm());
	expect(proceed).toHaveBeenCalledOnce();
	expect(status()).toBe("idle");
	expect(onCancel).toHaveBeenCalledOnce();
});

it("asks once when a confirmed leave navigates through the shell", async () => {
	dirty = true;
	const navigate = vi.fn();
	await act(async () =>
		guard.requestLeave(() => confirmLeaveFromShell(navigate)),
	);
	expect(navigate).not.toHaveBeenCalled();
	await act(async () => guard.confirm());
	// The draft is still dirty, but the reader already agreed to drop it.
	expect(navigate).toHaveBeenCalledOnce();
	expect(status()).toBe("idle");
});

it("keeps one pending navigation intent while the dialog is open", async () => {
	dirty = true;
	const first = vi.fn();
	const competing = vi.fn();
	const cancelFirst = vi.fn();
	const cancelCompeting = vi.fn();
	await act(async () => {
		confirmLeaveFromShell(first, cancelFirst);
		confirmLeaveFromShell(competing, cancelCompeting);
	});
	expect(cancelCompeting).toHaveBeenCalledOnce();

	await act(async () => guard.confirm());
	expect(first).toHaveBeenCalledOnce();
	expect(competing).not.toHaveBeenCalled();
	expect(cancelFirst).not.toHaveBeenCalled();
});

it.each([
	"confirm",
	"cancel",
] as const)("waits for every dirty editor before navigating (%s)", async (decision) => {
	dirtyEditors = [true, true];
	await act(async () => root.render(<MultipleEditorsShell />));
	const proceed = vi.fn();
	const onCancel = vi.fn();

	await act(async () => confirmLeaveFromShell(proceed, onCancel));
	expect(editorGuards[0].isConfirming).toBe(true);
	expect(editorGuards[1].isConfirming).toBe(false);

	await act(async () => editorGuards[0].confirm());
	expect(proceed).not.toHaveBeenCalled();
	expect(editorGuards[1].isConfirming).toBe(true);

	await act(async () => editorGuards[1][decision]());
	expect(proceed).toHaveBeenCalledTimes(decision === "confirm" ? 1 : 0);
	expect(onCancel).toHaveBeenCalledTimes(decision === "cancel" ? 1 : 0);
});

it("cancels a pending navigation when its editor disappears", async () => {
	dirty = true;
	const pending = vi.fn();
	const onCancel = vi.fn();
	await act(async () => confirmLeaveFromShell(pending, onCancel));
	await act(async () => root.render(<Shell editing={false} />));
	expect(pending).not.toHaveBeenCalled();
	expect(onCancel).toHaveBeenCalledOnce();
	const proceed = vi.fn();
	confirmLeaveFromShell(proceed);
	expect(proceed).toHaveBeenCalledOnce();
});

it("does not cancel a confirmed navigation when it removes the editor", async () => {
	dirty = true;
	const onCancel = vi.fn();
	await act(async () =>
		confirmLeaveFromShell(
			() => root.render(<Shell editing={false} />),
			onCancel,
		),
	);
	await act(async () => guard.confirm());
	expect(container.querySelector("output")).toBeNull();
	expect(onCancel).not.toHaveBeenCalled();
});
