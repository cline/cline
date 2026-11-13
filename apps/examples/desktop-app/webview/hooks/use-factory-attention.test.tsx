// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFactoryAttention } from "./use-factory-attention";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(async (_command: string): Promise<unknown> => []),
	listeners: new Map<string, () => void>(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: mocks.invoke,
		subscribe: (event: string, listener: () => void) => {
			mocks.listeners.set(event, listener);
			return () => mocks.listeners.delete(event);
		},
		subscribeTransportState: () => () => {},
	},
}));

let container: HTMLDivElement;
let root: Root;
function Probe() {
	useFactoryAttention();
	return null;
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.listeners.clear();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

it("reads attention again when a card is created or deleted, so a parent's parts count at once", async () => {
	await act(async () => root.render(<Probe />));
	expect(mocks.invoke).toHaveBeenCalledTimes(1);
	for (const event of ["task.created", "task.deleted"])
		await act(async () => mocks.listeners.get(event)?.());
	expect(mocks.invoke).toHaveBeenCalledTimes(3);
	expect(mocks.invoke).toHaveBeenLastCalledWith("factory_attention");
});
