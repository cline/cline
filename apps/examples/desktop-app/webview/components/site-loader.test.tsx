// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { useDesktopReadiness } from "@/hooks/use-desktop-readiness";
import { LoadingScreen } from "./views/loading/LoadingScreen";
import { SiteLoader } from "./views/loading/SiteLoader";

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
	act(() => root.unmount());
	vi.useRealTimers();
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
	act(() => root.render(<LoadingScreen readiness={readiness()} />));
	expect(container.textContent).toContain("Starting Cline");
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
	act(() => root.render(<LoadingScreen readiness={state} />));
	expect(container.textContent).toContain("Cline could not finish starting");
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
	act(() => root.render(<LoadingScreen readiness={state} />));
	expect(container.textContent).toContain("Unable to start Cline");
	expect(container.textContent).toContain("Unable to bind port");
	expect(container.textContent).toContain("exit code 1");
	expect(container.querySelector("button")?.textContent).toBe("Retry");
});

it("keeps automatic recovery in the loader without a Retry button or sidebar", () => {
	vi.useFakeTimers();
	const state = readiness();
	state.transport = "connected";
	state.hub = { state: "failed", attempt: 1, automaticRetry: true };
	act(() =>
		root.render(
			<SiteLoader readiness={state}>
				<nav>Sidebar</nav>
			</SiteLoader>,
		),
	);
	expect(container.textContent).toContain(
		"Retrying session service automatically",
	);
	expect(container.querySelector("button")).toBeNull();
	expect(container.querySelector("nav")).toBeNull();
	state.hub = { state: "starting", attempt: 2, step: "connecting" };
	act(() =>
		root.render(
			<SiteLoader readiness={state}>
				<nav>Sidebar</nav>
			</SiteLoader>,
		),
	);
	expect(container.textContent).toContain("3 / 5 steps");
	expect(container.textContent).toContain("Connecting to Cline Hub");
	expect(container.querySelector("nav")).toBeNull();
	state.hub = { state: "ready", attempt: 2 };
	act(() =>
		root.render(
			<SiteLoader readiness={state}>
				<nav>Sidebar</nav>
			</SiteLoader>,
		),
	);
	act(() => vi.advanceTimersByTime(10_000));
	expect(container.textContent).toBe("Sidebar");
});

it("fills the bar from completed steps and uses the shared Cline head", () => {
	const state = readiness();
	act(() => root.render(<LoadingScreen readiness={state} />));
	expect(
		container.querySelector("[data-welcome-hero-variant='bot-only']"),
	).not.toBeNull();
	for (const [step, count] of [
		["environment", 2],
		["connecting", 3],
		["sessions", 4],
	] as const) {
		state.transport = "connected";
		state.hub = { state: "starting", attempt: 1, step };
		act(() => root.render(<LoadingScreen readiness={state} />));
		expect(container.querySelector("progress")?.value).toBe(count);
		expect(container.querySelector("progress")?.max).toBe(5);
		expect(container.textContent).toContain(`${count * 20}%`);
		expect(
			container.querySelector(".bg-primary")?.getAttribute("style"),
		).toContain(`width: ${count * 20}%`);
	}
});

it("holds fast startup for ten seconds while reporting real completion", () => {
	vi.useFakeTimers();
	const state = readiness();
	state.transport = "connected";
	state.hub = { state: "ready", attempt: 1 };
	act(() =>
		root.render(
			<SiteLoader readiness={state}>
				<nav>Sidebar</nav>
			</SiteLoader>,
		),
	);
	expect(container.textContent).toContain("100%");
	expect(container.textContent).toContain("Cline is ready");
	act(() => vi.advanceTimersByTime(9_999));
	expect(container.querySelector("nav")).toBeNull();
	act(() => vi.advanceTimersByTime(1));
	expect(container.textContent).toBe("Sidebar");
});

it("never reveals an unready app after the minimum duration", () => {
	vi.useFakeTimers();
	const state = readiness();
	act(() =>
		root.render(
			<SiteLoader readiness={state}>
				<nav>Sidebar</nav>
			</SiteLoader>,
		),
	);
	act(() => vi.advanceTimersByTime(20_000));
	expect(container.querySelector("nav")).toBeNull();
	expect(container.textContent).toContain("20%");
	state.transport = "connected";
	state.hub = { state: "ready", attempt: 1 };
	act(() =>
		root.render(
			<SiteLoader readiness={state}>
				<nav>Sidebar</nav>
			</SiteLoader>,
		),
	);
	expect(container.textContent).toBe("Sidebar");
});
