// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	describeFactoryTool,
	type FactoryLiveActivity,
	useFactoryLiveActivity,
} from "./use-factory-live-activity";

const mocks = vi.hoisted(() => {
	const listeners = new Map<string, (payload: unknown) => void>();
	return {
		listeners,
		subscribe: vi.fn((event: string, listener: (payload: unknown) => void) => {
			listeners.set(event, listener);
			return () => listeners.delete(event);
		}),
		subscribeTransportState: vi.fn(() => () => {}),
	};
});
vi.mock("@/lib/desktop-client", () => ({ desktopClient: mocks }));

let container: HTMLDivElement;
let root: Root;
let activity: FactoryLiveActivity;
function Probe() {
	activity = useFactoryLiveActivity(["builder"]);
	return null;
}
beforeEach(() => {
	mocks.listeners.clear();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const emit = (payload: unknown) =>
	act(async () => mocks.listeners.get("task.factory.activity")?.(payload));

it("shows the engine's summary line for a Factory activity event", async () => {
	await act(async () => root.render(<Probe />));
	await emit({
		sessionId: "builder",
		toolName: "read_files",
		input: { files: [{ path: "other.ts" }] },
		summary: "Reading src/api/routes.ts",
		at: "2026-01-01T00:00:00Z",
	});
	expect(activity.sessions.get("builder")).toMatchObject({
		lastTool: "Reading src/api/routes.ts",
		at: Date.parse("2026-01-01T00:00:00Z"),
		ended: false,
	});
});

it("formats the tool name and input when the event has no summary", async () => {
	await act(async () => root.render(<Probe />));
	const input = { commands: ["bun test"] };
	await emit({ sessionId: "builder", toolName: "run_commands", input });
	const formatted = describeFactoryTool("run_commands", input);
	expect(formatted).toBeTruthy();
	expect(activity.sessions.get("builder")?.lastTool).toBe(formatted);
	// Sessions this view does not watch are ignored.
	await emit({ sessionId: "other", summary: "Reading x" });
	expect(activity.sessions.has("other")).toBe(false);
});
