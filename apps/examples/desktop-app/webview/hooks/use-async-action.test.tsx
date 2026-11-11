// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAsyncAction } from "./use-async-action";

let container: HTMLDivElement;
let root: Root;
const outcome = { onSuccess: vi.fn(), onError: vi.fn() };

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((accept, decline) => {
		resolve = accept;
		reject = decline;
	});
	return { promise, resolve, reject };
}

function Harness({ action }: { action: () => Promise<string> }) {
	const { pending, run } = useAsyncAction();
	return (
		<button
			type="button"
			aria-busy={pending}
			onClick={() => void run(action, outcome)}
		>
			Run
		</button>
	);
}

const button = () => container.querySelector("button") as HTMLButtonElement;
const click = () => act(async () => button().click());

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	outcome.onSuccess.mockClear();
	outcome.onError.mockClear();
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

it("runs one action at a time and reports how it ended", async () => {
	const first = deferred<string>();
	const action = vi.fn(() => first.promise);
	await act(async () => root.render(<Harness action={action} />));
	expect(button().getAttribute("aria-busy")).toBe("false");

	await click();
	await click();
	expect(action).toHaveBeenCalledOnce();
	expect(button().getAttribute("aria-busy")).toBe("true");

	await act(async () => first.resolve("done"));
	expect(outcome.onSuccess).toHaveBeenCalledExactlyOnceWith("done");
	expect(button().getAttribute("aria-busy")).toBe("false");

	action.mockRejectedValueOnce(new Error("failed"));
	await click();
	expect(action).toHaveBeenCalledTimes(2);
	expect(outcome.onError).toHaveBeenCalledExactlyOnceWith(new Error("failed"));
	expect(button().getAttribute("aria-busy")).toBe("false");
});

it("drops an outcome that arrives after the component has gone", async () => {
	const pending = deferred<string>();
	await act(async () =>
		root.render(<Harness action={() => pending.promise} />),
	);
	await click();
	await act(async () => root.render(null));
	await act(async () => pending.resolve("late"));
	expect(outcome.onSuccess).not.toHaveBeenCalled();
	expect(outcome.onError).not.toHaveBeenCalled();
});
