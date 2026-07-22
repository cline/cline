// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, setTitle } = vi.hoisted(() => ({
	invoke: vi.fn(),
	setTitle: vi.fn(async () => undefined),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	isTauriAvailable: () => window.__TAURI_INTERNALS__ !== undefined,
}));
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({ setTitle }),
}));

async function importFresh() {
	vi.resetModules();
	return await import("./desktop-window-title");
}

beforeEach(() => {
	invoke.mockReset();
	setTitle.mockClear();
	// biome-ignore lint/suspicious/noExplicitAny: test-only global shim for the Tauri bridge marker
	delete (window as any).__TAURI_INTERNALS__;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("desktop window title", () => {
	it("builds a versioned title, falling back to the base title without a version", async () => {
		const { buildDesktopWindowTitle, DEFAULT_DESKTOP_WINDOW_TITLE } =
			await importFresh();
		expect(buildDesktopWindowTitle("1.2.3")).toBe(
			`${DEFAULT_DESKTOP_WINDOW_TITLE} v1.2.3`,
		);
		expect(buildDesktopWindowTitle("  1.2.3  ")).toBe(
			`${DEFAULT_DESKTOP_WINDOW_TITLE} v1.2.3`,
		);
		expect(buildDesktopWindowTitle(undefined)).toBe(
			DEFAULT_DESKTOP_WINDOW_TITLE,
		);
		expect(buildDesktopWindowTitle("")).toBe(DEFAULT_DESKTOP_WINDOW_TITLE);
	});

	it("does nothing outside the Tauri shell", async () => {
		const { syncDesktopWindowTitle } = await importFresh();
		await syncDesktopWindowTitle();
		expect(invoke).not.toHaveBeenCalled();
		expect(setTitle).not.toHaveBeenCalled();
	});

	it("sets the native window title once the sidecar reports a version", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test-only global shim for the Tauri bridge marker
		(window as any).__TAURI_INTERNALS__ = {};
		invoke.mockResolvedValue({
			workspaceRoot: "",
			cwd: "",
			appVersion: "1.2.3",
		});

		const { syncDesktopWindowTitle, DEFAULT_DESKTOP_WINDOW_TITLE } =
			await importFresh();
		await syncDesktopWindowTitle();

		expect(invoke).toHaveBeenCalledWith("get_process_context");
		expect(setTitle).toHaveBeenCalledWith(
			`${DEFAULT_DESKTOP_WINDOW_TITLE} v1.2.3`,
		);
	});

	it("leaves the title alone when the version is missing or the sidecar call fails", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test-only global shim for the Tauri bridge marker
		(window as any).__TAURI_INTERNALS__ = {};
		invoke.mockResolvedValue({ workspaceRoot: "", cwd: "" });

		const { syncDesktopWindowTitle } = await importFresh();
		await syncDesktopWindowTitle();
		expect(setTitle).not.toHaveBeenCalled();

		invoke.mockRejectedValue(
			new Error("Desktop backend transport unavailable"),
		);
		await syncDesktopWindowTitle();
		expect(setTitle).not.toHaveBeenCalled();
	});
});
