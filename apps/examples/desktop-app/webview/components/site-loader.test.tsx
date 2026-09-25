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
	expect(container.textContent).toContain("Starting desktop backend");
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
	const state = readiness();
	state.transport = "connected";
	state.hub = { state: "failed", attempt: 1, automaticRetry: true };
	const render = () =>
		root.render(
			<SiteLoader readiness={state}>
				<nav>Sidebar</nav>
			</SiteLoader>,
		);
	act(render);
	expect(container.textContent).toContain("Retrying session service");
	expect(container.querySelector("button")?.textContent).toContain(
		"Continue to sign-in",
	);
	expect(container.querySelector("nav")).toBeNull();
	state.hub = { state: "starting", attempt: 2, step: "connecting" };
	act(render);
	expect(container.textContent).toContain("Connecting to Cline Hub");
	expect(container.querySelector("nav")).toBeNull();
	state.hub = { state: "ready", attempt: 2 };
	act(render);
	expect(container.textContent).toBe("Sidebar");
});

it("fills the bar from completed steps and uses the shared Cline head", () => {
	const state = readiness();
	act(() => root.render(<LoadingScreen readiness={state} />));
	expect(
		container.querySelector("[data-welcome-hero-variant='bot-only']"),
	).not.toBeNull();
	expect(container.querySelector("progress")?.value).toBe(1);
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
		expect(
			container.querySelector(".bg-primary")?.getAttribute("style"),
		).toContain(`width: ${count * 20}%`);
	}
});

it("reveals the app as soon as the hub is ready and never before", () => {
	const state = readiness();
	const render = () =>
		root.render(
			<SiteLoader readiness={state}>
				<nav>Sidebar</nav>
			</SiteLoader>,
		);
	act(render);
	expect(container.querySelector("nav")).toBeNull();
	state.transport = "connected";
	act(render);
	expect(container.querySelector("nav")).toBeNull();
	state.hub = { state: "ready", attempt: 1 };
	act(render);
	expect(container.textContent).toBe("Sidebar");
});

it.each([
	"starting",
	"failed",
] as const)("allows local screens while the hub is %s", (hubState) => {
	const state = readiness();
	state.transport = "connected";
	state.hub = { state: hubState, attempt: 4 };
	act(() =>
		root.render(
			<SiteLoader readiness={state}>
				<nav>Sign-in Settings Remote environments</nav>
			</SiteLoader>,
		),
	);
	const continueButton = Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent?.includes("Continue to sign-in"),
	);
	expect(continueButton).toBeDefined();
	act(() => continueButton?.click());
	expect(container.querySelector("nav")).not.toBeNull();
	expect(container.querySelector("[inert]")).toBeNull();
	expect(container.querySelector("[hidden]")).toBeNull();
});

it("keeps the mounted composer and attachments across transport recovery", () => {
	const state = readiness();
	state.transport = "connected";
	state.hub = { state: "ready", attempt: 1 };
	const render = () =>
		root.render(
			<SiteLoader readiness={state}>
				<textarea defaultValue="Unsent draft" />
				<input type="file" />
			</SiteLoader>,
		);
	act(render);
	const composer = container.querySelector("textarea");
	const attachments = container.querySelector("input");
	expect(composer).not.toBeNull();
	state.transport = "connecting";
	state.hub = { state: "starting", attempt: 0 };
	act(render);
	expect(container.querySelector("textarea")).toBe(composer);
	expect(container.querySelector("input")).toBe(attachments);
	state.transport = "connected";
	state.hub = { state: "ready", attempt: 1 };
	act(render);
	expect(container.querySelector("textarea")).toBe(composer);
	expect(composer?.value).toBe("Unsent draft");
	expect(container.querySelector("input")).toBe(attachments);
});
