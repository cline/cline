// @vitest-environment jsdom

import { Activity, act } from "react";
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

function Harness({
	action,
	onRunError,
}: {
	action: () => Promise<string>;
	onRunError?: (cause: unknown) => void;
}) {
	const { pending, run } = useAsyncAction();
	return (
		<button
			type="button"
			aria-busy={pending}
			onClick={() => void run(action, outcome).catch(onRunError)}
		>
			Run
		</button>
	);
}

function ActivityHarness({
	action,
	visible,
}: {
	action: () => Promise<string>;
	visible: boolean;
}) {
	return (
		<Activity mode={visible ? "visible" : "hidden"}>
			<Harness action={action} />
		</Activity>
	);
}

const button = () => container.querySelector("button") as HTMLButtonElement;
const click = () => act(async () => button().click());

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	outcome.onSuccess.mockReset();
	outcome.onError.mockReset();
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

it("settles actions hidden by Activity and reports their outcome when visible again", async () => {
	const pending = deferred<string>();
	await act(async () =>
		root.render(<ActivityHarness action={() => pending.promise} visible />),
	);
	await click();
	expect(button().getAttribute("aria-busy")).toBe("true");

	await act(async () =>
		root.render(
			<ActivityHarness action={() => pending.promise} visible={false} />,
		),
	);
	await act(async () => pending.resolve("reconnected"));
	expect(outcome.onSuccess).not.toHaveBeenCalled();

	await act(async () =>
		root.render(<ActivityHarness action={() => pending.promise} visible />),
	);
	expect(outcome.onSuccess).toHaveBeenCalledExactlyOnceWith("reconnected");
	expect(button().getAttribute("aria-busy")).toBe("false");
});

it("does not report a successful action as failed when its callback throws", async () => {
	const callbackError = new Error("callback failed");
	const onRunError = vi.fn();
	outcome.onSuccess.mockImplementationOnce(() => {
		throw callbackError;
	});
	await act(async () =>
		root.render(
			<Harness action={async () => "done"} onRunError={onRunError} />,
		),
	);

	await click();
	expect(outcome.onSuccess).toHaveBeenCalledExactlyOnceWith("done");
	expect(outcome.onError).not.toHaveBeenCalled();
	expect(onRunError).toHaveBeenCalledExactlyOnceWith(callbackError);
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
