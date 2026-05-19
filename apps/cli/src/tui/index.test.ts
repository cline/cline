import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TuiProps } from "./types";

const rendererMock = vi.hoisted(() => ({
	copyToClipboardOSC52: vi.fn(),
	destroy: vi.fn(),
	getPalette: vi.fn(async () => ({
		defaultBackground: null,
		defaultForeground: null,
	})),
	on: vi.fn(),
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
		rendererMock.destroy.mockReset();
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
});
