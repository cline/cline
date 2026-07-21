// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	DesktopBootstrapStatus,
	DesktopTransportState,
} from "@/lib/desktop-transport";
import { LoadingScreen } from "./loading-screen";

const desktopClientMock = vi.hoisted(() => ({
	eventHandlers: new Map<string, (payload: unknown) => void>(),
	transportHandler: undefined as
		| ((state: DesktopTransportState) => void)
		| undefined,
	invoke: vi.fn(),
	getTransportError: vi.fn(() => null as string | null),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		getTransportState: () => "connecting" as const,
		getTransportError: desktopClientMock.getTransportError,
		invoke: desktopClientMock.invoke,
		subscribe: (name: string, handler: (payload: unknown) => void) => {
			desktopClientMock.eventHandlers.set(name, handler);
			return () => desktopClientMock.eventHandlers.delete(name);
		},
		subscribeTransportState: (
			handler: (state: DesktopTransportState) => void,
		) => {
			desktopClientMock.transportHandler = handler;
			handler("connecting");
			return () => {
				desktopClientMock.transportHandler = undefined;
			};
		},
	},
}));

let container: HTMLDivElement;
let root: Root;

function status(
	phase: DesktopBootstrapStatus["phase"],
	revision = 0,
): DesktopBootstrapStatus {
	return { phase, revision, updatedAt: "2026-07-21T00:00:00.000Z" };
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.useFakeTimers();
	desktopClientMock.eventHandlers.clear();
	desktopClientMock.transportHandler = undefined;
	desktopClientMock.invoke.mockReset();
	desktopClientMock.invoke.mockResolvedValue(status("starting_sidecar"));
	desktopClientMock.getTransportError.mockReset();
	desktopClientMock.getTransportError.mockReturnValue(null);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

describe("LoadingScreen", () => {
	it("reveals real Hub bootstrap steps in order and completes only when ready", async () => {
		const onComplete = vi.fn();
		await act(async () => {
			root.render(<LoadingScreen onComplete={onComplete} />);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Starting desktop sidecar");
		expect(onComplete).not.toHaveBeenCalled();

		await act(async () => {
			desktopClientMock.eventHandlers.get("bootstrap_status")?.(
				status("ready", 4),
			);
		});
		expect(container.textContent?.match(/done/g) ?? []).toHaveLength(0);

		await act(async () => {
			vi.advanceTimersByTime(350);
		});
		expect(container.textContent?.match(/done/g) ?? []).toHaveLength(1);

		await act(async () => {
			vi.advanceTimersByTime(350);
		});
		expect(container.textContent).toContain("Connecting Cline runtime");
		expect(onComplete).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(350);
		});
		await act(async () => {
			vi.advanceTimersByTime(350);
		});
		await act(async () => {
			vi.advanceTimersByTime(599);
		});
		expect(onComplete).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(1);
		});
		expect(onComplete).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(500);
		});
		expect(onComplete).toHaveBeenCalledOnce();
	});
});
