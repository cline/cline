// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { HubStartupScreen } from "./hub-startup-screen";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	isTauriAvailable: () => false,
}));

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
	act(() => root.unmount());
	root = createRoot(container);
	vi.useRealTimers();
	vi.clearAllMocks();
});

function buttons(): string[] {
	return [...container.querySelectorAll("button")].map(
		(button) => button.textContent ?? "",
	);
}

it("shows only a spinner while the Hub is starting", () => {
	act(() =>
		root.render(
			<HubStartupScreen transport="connected" hub={{ state: "starting" }} />,
		),
	);
	expect(container.textContent).toContain("Starting Cline…");
	expect(buttons()).toEqual([]);
	// The window stays draggable (and closable on frameless Windows) without the app.
	expect(
		container.querySelector('[data-slot="window-title-bar"]'),
	).not.toBeNull();
});

it("offers Retry and diagnostics export when the Hub fails", async () => {
	invoke.mockResolvedValue({ path: "/tmp/cline-diagnostics.txt" });
	act(() =>
		root.render(
			<HubStartupScreen
				transport="connected"
				hub={{ state: "failed", error: "Cline couldn't start its Hub." }}
			/>,
		),
	);
	expect(container.textContent).toContain("Cline couldn't connect to its Hub");
	expect(buttons()).toEqual(["Retry", "Export diagnostics"]);

	const [retry, exportButton] = container.querySelectorAll("button");
	act(() => retry.click());
	expect(invoke).toHaveBeenCalledWith("retry_hub");
	await act(async () => exportButton.click());
	expect(invoke).toHaveBeenCalledWith("export_diagnostics");
	expect(container.textContent).toContain(
		"Diagnostics saved to /tmp/cline-diagnostics.txt",
	);
});

it("calls out an unreachable desktop backend after 30 seconds", () => {
	vi.useFakeTimers();
	act(() =>
		root.render(
			<HubStartupScreen transport="reconnecting" hub={{ state: "starting" }} />,
		),
	);
	expect(container.textContent).toContain("Starting Cline…");
	act(() => vi.advanceTimersByTime(30_000));
	expect(container.textContent).toContain(
		"Cline's desktop backend isn't responding",
	);
	expect(buttons()).toEqual(["Reload"]);
});
