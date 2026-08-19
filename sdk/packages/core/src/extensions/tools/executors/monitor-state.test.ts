/**
 * Host-facing monitor state snapshots.
 *
 * The registry reports a full `MonitorRecord[]` snapshot on every lifecycle
 * change so UIs can render a live roster without parsing transcripts. The
 * empty snapshot on dispose is load-bearing: session shutdown and runtime
 * restarts must be visible as "monitors ended" rather than leaving clients
 * showing a stale roster.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonitorRecord } from "./monitor";
import { MonitorRegistry } from "./monitor";

const isWindows = process.platform === "win32";
const printCommand = isWindows ? "echo state" : "printf 'state\\n'";
const persistentCommand = isWindows
	? "powershell -Command Start-Sleep -Seconds 60"
	: "sleep 60";

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 10_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

describe("MonitorRegistry onStateChange", () => {
	let registry: MonitorRegistry | undefined;

	afterEach(async () => {
		await registry?.dispose();
		registry = undefined;
	});

	it("reports a running snapshot on start and a terminal one on exit", async () => {
		const snapshots: MonitorRecord[][] = [];
		registry = new MonitorRegistry({
			flushIntervalMs: 20,
			onStateChange: (monitors) => snapshots.push(monitors),
		});

		registry.start({
			name: "oneshot",
			command: printCommand,
			description: "prints once and exits",
		});

		expect(snapshots[0]).toEqual([
			expect.objectContaining({ id: "mon_1", status: "running" }),
		]);

		await waitFor(() =>
			snapshots.some((monitors) => monitors[0]?.status === "exited"),
		);
	});

	it("reports a stopped snapshot when a monitor is stopped", async () => {
		const snapshots: MonitorRecord[][] = [];
		registry = new MonitorRegistry({
			flushIntervalMs: 20,
			onStateChange: (monitors) => snapshots.push(monitors),
		});

		registry.start({
			name: "longrun",
			command: persistentCommand,
			description: "runs until stopped",
		});
		await registry.stop("longrun");

		expect(snapshots.at(-1)).toEqual([
			expect.objectContaining({ id: "mon_1", status: "stopped" }),
		]);
	});

	it("reports an empty snapshot when the registry is disposed", async () => {
		const snapshots: MonitorRecord[][] = [];
		const local = new MonitorRegistry({
			flushIntervalMs: 20,
			onStateChange: (monitors) => snapshots.push(monitors),
		});

		local.start({
			name: "doomed",
			command: persistentCommand,
			description: "ends with the registry",
		});
		await local.dispose();

		expect(snapshots.at(-1)).toEqual([]);
	});

	it("reports a failed snapshot when the process cannot start", async () => {
		const snapshots: MonitorRecord[][] = [];
		// A missing shell binary surfaces as an async `error` event on the
		// child rather than a synchronous spawn throw.
		registry = new MonitorRegistry({
			shell: "/nonexistent/shell/for-this-test",
			onStateChange: (monitors) => snapshots.push(monitors),
		});

		registry.start({
			name: "broken",
			command: "true",
			description: "cannot spawn",
		});

		await waitFor(() =>
			snapshots.some((monitors) => monitors[0]?.status === "failed"),
		);
	});

	it("survives a throwing state listener", async () => {
		const notifier = vi.fn();
		registry = new MonitorRegistry({
			notifier,
			flushIntervalMs: 20,
			onStateChange: () => {
				throw new Error("listener exploded");
			},
		});

		const record = registry.start({
			name: "resilient",
			command: printCommand,
			description: "keeps working",
		});
		expect(record.status).toBe("running");
		await waitFor(() => notifier.mock.calls.length > 0);
	});
});
