// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { HubUpdateRequiredDialog } from "./hub-update-required-dialog";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribe: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: mocks.subscribe },
}));
vi.mock("@/hooks/use-app-update", () => ({
	checkForUpdateNow: vi.fn(),
	restartToApplyUpdate: vi.fn(),
	useAppUpdateStatus: () => ({ state: "idle" }),
}));

const outdatedHub = {
	reason: "outdated_hub",
	hubBuildId: "old-build",
	activeSessionCount: 1,
	participantClientCount: 1,
};
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

it("shows a mismatch broadcast before the dialog mounted", async () => {
	mocks.subscribe.mockReturnValue(() => {});
	mocks.invoke.mockResolvedValue(outdatedHub);
	await act(async () => root.render(<HubUpdateRequiredDialog />));
	expect(mocks.invoke).toHaveBeenCalledWith("get_hub_build_mismatch");
	expect(document.body.textContent).toContain("Cline Hub update required");
});

it("keeps a live resolution over a cached mismatch that resolves later", async () => {
	let resolve!: (value: unknown) => void;
	let event!: (value: unknown) => void;
	mocks.invoke.mockReturnValue(
		new Promise((r) => {
			resolve = r;
		}),
	);
	mocks.subscribe.mockImplementation((_name, handler) => {
		event = handler;
		return () => {};
	});
	await act(async () => root.render(<HubUpdateRequiredDialog />));
	await act(async () => {
		event(null);
		resolve(outdatedHub);
	});
	expect(document.body.textContent).not.toContain("Cline Hub update required");
});
