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
let confirmLeaveFromShell: (proceed: () => void) => void;
let confirmLeaveFromPage: (proceed: () => void) => void;
let guard: ReturnType<typeof useUnsavedChangesGuard>;

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

const status = () => container.querySelector("output")?.textContent;

beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	dirty = false;
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
	await act(async () => confirmLeaveFromShell(proceed));
	expect(proceed).not.toHaveBeenCalled();
	expect(status()).toBe("confirming");

	await act(async () => guard.cancel());
	expect(status()).toBe("idle");
	expect(proceed).not.toHaveBeenCalled();

	await act(async () => confirmLeaveFromPage(proceed));
	expect(status()).toBe("confirming");
	await act(async () => guard.confirm());
	expect(proceed).toHaveBeenCalledOnce();
	expect(status()).toBe("idle");
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

it("stops guarding once the editor is gone", async () => {
	dirty = true;
	await act(async () => root.render(<Shell editing={false} />));
	const proceed = vi.fn();
	confirmLeaveFromShell(proceed);
	expect(proceed).toHaveBeenCalledOnce();
});
