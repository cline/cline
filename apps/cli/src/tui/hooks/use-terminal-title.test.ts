import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type TerminalTitleRenderer,
	useTerminalTitle,
} from "./use-terminal-title";

const reactMock = vi.hoisted(() => {
	const cleanups: Array<() => void> = [];
	return {
		cleanups,
		// Run effect bodies now, but retain their cleanups so each test can move
		// the renderer across the native destruction boundary before unmount.
		useEffect: vi.fn((effect: () => undefined | (() => void)) => {
			const cleanup = effect();
			if (cleanup) {
				cleanups.push(cleanup);
			}
		}),
	};
});

vi.mock("react", () => ({
	useEffect: reactMock.useEffect,
}));

function createTitleRenderer() {
	let destroyed = false;
	const setTerminalTitle = vi.fn(() => {
		if (destroyed) {
			throw new Error("setTerminalTitle called after renderer destruction");
		}
	});
	const renderer: TerminalTitleRenderer = {
		get isDestroyed() {
			return destroyed;
		},
		setTerminalTitle,
	};

	return {
		destroy: () => {
			destroyed = true;
		},
		renderer,
		setTerminalTitle,
	};
}

beforeEach(() => {
	reactMock.cleanups.length = 0;
	reactMock.useEffect.mockClear();
});

describe("useTerminalTitle", () => {
	it("sets and resets the title while the renderer is active", () => {
		const titleRenderer = createTitleRenderer();

		useTerminalTitle(titleRenderer.renderer, "Cline");
		expect(titleRenderer.setTerminalTitle).toHaveBeenNthCalledWith(1, "Cline");

		for (const cleanup of reactMock.cleanups) {
			cleanup();
		}

		expect(titleRenderer.setTerminalTitle).toHaveBeenCalledTimes(2);
		expect(titleRenderer.setTerminalTitle).toHaveBeenNthCalledWith(2, "");
	});

	it("does not set the title when its effect runs after renderer destruction", () => {
		const titleRenderer = createTitleRenderer();
		titleRenderer.destroy();

		useTerminalTitle(titleRenderer.renderer, "Cline");

		expect(titleRenderer.setTerminalTitle).not.toHaveBeenCalled();
	});

	it("does not reset the title when cleanup runs after renderer destruction", () => {
		const titleRenderer = createTitleRenderer();

		useTerminalTitle(titleRenderer.renderer, "Cline");
		expect(titleRenderer.setTerminalTitle).toHaveBeenCalledOnce();

		titleRenderer.destroy();
		for (const cleanup of reactMock.cleanups) {
			cleanup();
		}

		expect(titleRenderer.setTerminalTitle).toHaveBeenCalledOnce();
	});
});
