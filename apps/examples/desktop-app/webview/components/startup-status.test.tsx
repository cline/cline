// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { useDesktopReadiness } from "@/hooks/use-desktop-readiness";
import { StartupStatus } from "./startup-status";

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
const readiness = (): ReturnType<typeof useDesktopReadiness> => ({
	transport: "connecting",
	startup: null,
	hub: { state: "starting", attempt: 1 },
	retry: vi.fn(async () => {}),
	retryError: null,
	retrying: false,
});
it("renders initial desktop loading immediately", () => {
	act(() =>
		root.render(<StartupStatus readiness={readiness()} service="desktop" />),
	);
	expect(container.textContent).toContain("Starting Cline…");
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
	act(() => root.render(<StartupStatus readiness={state} service="hub" />));
	expect(container.textContent).toContain("Session service failed to start");
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
	act(() => root.render(<StartupStatus readiness={state} service="desktop" />));
	expect(container.textContent).toContain("Cline failed to start");
	expect(container.textContent).toContain("Unable to bind port");
	expect(container.textContent).toContain("exit code 1");
	expect(container.querySelector("button")?.textContent).toBe("Retry");
});
