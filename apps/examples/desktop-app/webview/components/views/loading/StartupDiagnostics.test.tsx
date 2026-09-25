// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { StartupDiagnostics } from "./StartupDiagnostics";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	isTauriAvailable: () => true,
	desktopClient: { invoke: mocks.invoke },
}));
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
it("copies the report and saves through the native command without a backend", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	mocks.invoke.mockResolvedValue(true);
	await act(async () =>
		root.render(<StartupDiagnostics report="sanitized report" />),
	);
	await act(async () =>
		(container.querySelectorAll("button")[0] as HTMLButtonElement).click(),
	);
	expect(writeText).toHaveBeenCalledWith("sanitized report");
	expect(container.textContent).toContain("Diagnostics copied");
	await act(async () =>
		(container.querySelectorAll("button")[1] as HTMLButtonElement).click(),
	);
	expect(mocks.invoke).toHaveBeenCalledWith("save_startup_diagnostics", {
		report: "sanitized report",
	});
	expect(container.textContent).toContain("Report saved");
});
it("keeps the report selectable when sharing fails and handles save cancellation", async () => {
	mocks.invoke
		.mockRejectedValueOnce(new Error("permission denied"))
		.mockResolvedValueOnce(false);
	await act(async () =>
		root.render(<StartupDiagnostics report="sanitized report" />),
	);
	const save = container.querySelectorAll("button")[1] as HTMLButtonElement;
	await act(async () => save.click());
	expect(container.textContent).toContain("Could not share diagnostics");
	expect(container.querySelector("pre")?.textContent).toBe("sanitized report");
	await act(async () => save.click());
	expect(container.textContent).toContain("Save cancelled");
});
