// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useHubStartup } from "./use-hub-startup";

const mocks = vi.hoisted(() => ({
	transportHandler: undefined as ((state: string) => void) | undefined,
	hubHandler: undefined as ((payload: unknown) => void) | undefined,
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		getTransportState: () => "connected",
		subscribeTransportState: (handler: (state: string) => void) => {
			mocks.transportHandler = handler;
			return () => {};
		},
		subscribe: (_name: string, handler: (payload: unknown) => void) => {
			mocks.hubHandler = handler;
			return () => {};
		},
	},
}));

const container = document.createElement("div");
let root = createRoot(container);
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
	act(() => root.unmount());
	root = createRoot(container);
});

function Probe() {
	const { transport, hub } = useHubStartup();
	return <span>{`${transport}:${hub.state}`}</span>;
}

it("forgets the previous sidecar's ready status when the transport drops", () => {
	act(() => root.render(<Probe />));
	act(() => mocks.hubHandler?.({ state: "ready" }));
	expect(container.textContent).toBe("connected:ready");

	act(() => mocks.transportHandler?.("reconnecting"));
	expect(container.textContent).toBe("reconnecting:starting");

	// The new sidecar has not replayed its status yet.
	act(() => mocks.transportHandler?.("connected"));
	expect(container.textContent).toBe("connected:starting");
	act(() => mocks.hubHandler?.({ state: "ready" }));
	expect(container.textContent).toBe("connected:ready");
});
