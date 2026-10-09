// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useDesktopReadiness } from "./use-desktop-readiness";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribe: vi.fn(),
	subscribeTransportState: vi.fn(
		(_handler: (state: string) => void) => () => {},
	),
	retryConnection: vi.fn(),
	native: false,
}));
vi.mock("@/lib/desktop-client", () => ({
	isTauriAvailable: () => mocks.native,
	desktopClient: {
		getTransportState: () => "connected",
		subscribeTransportState: mocks.subscribeTransportState,
		subscribe: mocks.subscribe,
		invoke: mocks.invoke,
		retryConnection: mocks.retryConnection,
	},
}));
let latest: ReturnType<typeof useDesktopReadiness>;
function Probe() {
	latest = useDesktopReadiness();
	return <span>{latest.hub.state}</span>;
}
const container = document.createElement("div");
let root = createRoot(container);
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
	act(() => root.unmount());
	root = createRoot(container);
	vi.clearAllMocks();
});
it("keeps a newly replayed hub state when an earlier status request resolves late", async () => {
	let resolve!: (value: unknown) => void;
	let event!: (value: unknown) => void;
	mocks.invoke.mockImplementation(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	mocks.subscribe.mockImplementation((_name, handler) => {
		event = handler;
		return () => {};
	});
	await act(async () => root.render(<Probe />));
	await act(async () => {
		event({ state: "ready", attempt: 2 });
		resolve({ state: "starting", attempt: 1 });
	});
	expect(container.textContent).toBe("ready");
});
it("retries hub initialization through the live transport and renders recovery", async () => {
	let event!: (value: unknown) => void;
	mocks.invoke
		.mockResolvedValueOnce({
			state: "failed",
			message: "Timed out",
			attempt: 1,
		})
		.mockResolvedValueOnce({ state: "starting", attempt: 2 });
	mocks.subscribe.mockImplementation((_name, handler) => {
		event = handler;
		return () => {};
	});
	await act(async () => root.render(<Probe />));
	expect(container.textContent).toBe("failed");
	await act(async () => latest.retry());
	expect(mocks.invoke).toHaveBeenLastCalledWith("retry_backend_initialization");
	expect(container.textContent).toBe("starting");
	await act(async () => event({ state: "ready", attempt: 2 }));
	expect(container.textContent).toBe("ready");
	expect(mocks.retryConnection).not.toHaveBeenCalled();
});

it("forgets ready hub state on disconnect until the new sidecar reports readiness", async () => {
	let transport!: (state: string) => void;
	mocks.subscribeTransportState.mockImplementation((handler) => {
		transport = handler;
		return () => {};
	});
	mocks.subscribe.mockImplementation(() => () => {});
	mocks.invoke
		.mockResolvedValueOnce({ state: "ready", attempt: 1 })
		.mockImplementation(() => new Promise(() => {}));
	await act(async () => root.render(<Probe />));
	expect(container.textContent).toBe("ready");
	await act(async () => transport("reconnecting"));
	expect(container.textContent).toBe("starting");
	await act(async () => transport("connected"));
	expect(container.textContent).toBe("starting");
});
