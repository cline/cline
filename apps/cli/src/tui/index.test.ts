import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TuiProps } from "./types";

const rendererMock = vi.hoisted(() => ({
	copyToClipboardOSC52: vi.fn(),
	destroy: vi.fn(),
	getPalette: vi.fn(async () => ({
		defaultBackground: null,
		defaultForeground: null,
	})),
	isDestroyed: false,
	on: vi.fn(),
	setTerminalTitle: vi.fn(),
}));

const rootMock = vi.hoisted(() => ({
	render: vi.fn(),
	unmount: vi.fn(),
}));

const reactMock = vi.hoisted(() => ({
	createRoot: vi.fn(() => rootMock),
}));

vi.mock("@opentui/core", () => ({
	createCliRenderer: vi.fn(async () => rendererMock),
}));

vi.mock("@opentui/react", () => ({
	createRoot: reactMock.createRoot,
}));

vi.mock("./root", () => ({
	Root: () => null,
}));

describe("renderOpenTui", () => {
	const destroyHandlers: Array<() => void> = [];

	beforeEach(() => {
		destroyHandlers.length = 0;
		rendererMock.isDestroyed = false;
		rendererMock.destroy.mockReset();
		rendererMock.setTerminalTitle.mockReset();
		rendererMock.on.mockReset();
		rendererMock.on.mockImplementation((event: string, handler: () => void) => {
			if (event === "destroy") {
				destroyHandlers.push(handler);
			}
			return rendererMock;
		});
		rootMock.render.mockReset();
		rootMock.unmount.mockReset();
		reactMock.createRoot.mockReset();
		reactMock.createRoot.mockReturnValue(rootMock);
	});

	it("destroys the renderer when root creation fails", async () => {
		const { renderOpenTui } = await import("./index");
		reactMock.createRoot.mockImplementationOnce(() => {
			throw new Error("root failed");
		});

		await expect(renderOpenTui({} as TuiProps)).rejects.toThrow("root failed");

		expect(rendererMock.destroy).toHaveBeenCalledTimes(1);
	});

	it("destroys the renderer when initial render fails", async () => {
		const { renderOpenTui } = await import("./index");
		rootMock.render.mockImplementationOnce(() => {
			throw new Error("render failed");
		});

		await expect(renderOpenTui({} as TuiProps)).rejects.toThrow(
			"render failed",
		);

		expect(rendererMock.destroy).toHaveBeenCalledTimes(1);
	});

	it("defers explicit shutdown until the current input dispatch unwinds", async () => {
		rendererMock.destroy.mockImplementationOnce(() => {
			for (const handler of destroyHandlers) {
				handler();
			}
		});

		const { renderOpenTui } = await import("./index");
		const tui = await renderOpenTui({} as TuiProps);

		tui.destroy();

		expect(rootMock.unmount).toHaveBeenCalledTimes(1);
		expect(rendererMock.destroy).not.toHaveBeenCalled();

		await Promise.resolve();
		await tui.waitUntilExit();

		expect(rendererMock.destroy).toHaveBeenCalledTimes(1);
		expect(rootMock.unmount).toHaveBeenCalledTimes(1);
	});

	it("resets the terminal title before destroying the renderer", async () => {
		const { renderOpenTui } = await import("./index");
		const tui = await renderOpenTui({} as TuiProps);

		tui.destroy();
		await Promise.resolve();

		expect(rendererMock.setTerminalTitle).toHaveBeenCalledWith("");
		expect(rendererMock.destroy).toHaveBeenCalledTimes(1);
		const titleCallOrder =
			rendererMock.setTerminalTitle.mock.invocationCallOrder[0];
		const destroyCallOrder = rendererMock.destroy.mock.invocationCallOrder[0];
		expect(titleCallOrder).toBeLessThan(destroyCallOrder);
	});

	it("skips the title reset when the renderer is destroyed before the teardown microtask runs", async () => {
		const { renderOpenTui } = await import("./index");
		const tui = await renderOpenTui({} as TuiProps);

		tui.destroy();
		// Simulate OpenTUI's own signal handler destroying the renderer in the
		// same dispatch (e.g. an idle SIGTERM fires both our handler and
		// OpenTUI's exitHandler before microtasks drain).
		rendererMock.isDestroyed = true;
		for (const handler of destroyHandlers) {
			handler();
		}

		await Promise.resolve();

		expect(rendererMock.setTerminalTitle).not.toHaveBeenCalled();
	});
});
