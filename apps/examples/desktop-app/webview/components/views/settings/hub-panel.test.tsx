// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HubPanel } from "./hub-panel";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));
let root: Root;
let container: HTMLDivElement;
const status = {
	url: "ws://127.0.0.1:1234",
	clients: [
		{
			clientId: "cli-1",
			clientType: "cli",
			displayName: "Terminal",
			connectedAt: 1,
		},
	],
	events: [
		{ id: 1, timestamp: 1, title: "Client connected", detail: "Terminal" },
	],
};
beforeEach(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	invoke.mockReset().mockResolvedValue(status);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});
async function click(label: string) {
	const button = [...document.querySelectorAll("button")].find(
		(button) => button.textContent === label,
	);
	if (!button) throw new Error(`Missing button: ${label}`);
	await act(async () => button.click());
}
it("shows clients and events, and refreshes while mounted", async () => {
	vi.useFakeTimers();
	await act(async () => root.render(<HubPanel />));
	expect(container.querySelector("h3")?.textContent).toContain(
		"Connected clients",
	);
	expect(container.querySelector('h3 [data-slot="badge"]')?.textContent).toBe(
		"1",
	);
	expect(container.textContent).toContain("Client connected");
	invoke.mockResolvedValue({ ...status, clients: [] });
	await act(async () => vi.advanceTimersByTimeAsync(2000));
	expect(container.textContent).toContain("No connected clients.");
});
it("requires confirmation before restarting and reports restart failures", async () => {
	await act(async () => root.render(<HubPanel />));
	await click("Restart Hub");
	expect(invoke).not.toHaveBeenCalledWith("restart_hub");
	expect(document.body.textContent).toContain("active sessions");
	await click("Cancel");
	expect(invoke).not.toHaveBeenCalledWith("restart_hub");
	await click("Restart Hub");
	invoke.mockRejectedValueOnce(new Error("Shutdown refused"));
	const dialog = document.querySelector('[role="alertdialog"]');
	if (!dialog) throw new Error("Missing restart confirmation");
	const confirm = [...dialog.querySelectorAll("button")].find(
		(button) => button.textContent === "Restart Hub",
	);
	if (!confirm) throw new Error("Missing restart button");
	await act(async () => confirm.click());
	expect(invoke).toHaveBeenCalledWith("restart_hub");
	expect(container.querySelector('[role="alert"]')?.textContent).toContain(
		"Shutdown refused",
	);
});
it("shows initial connection failures", async () => {
	invoke.mockRejectedValue(new Error("Hub unavailable"));
	await act(async () => root.render(<HubPanel />));
	expect(container.querySelector('[role="alert"]')?.textContent).toBe(
		"Hub unavailable",
	);
});
