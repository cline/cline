import { describe, expect, it, vi } from "vitest";
import {
	formatMonitorNotification,
	MonitorError,
	type MonitorNotification,
	MonitorRegistry,
} from "./monitor";

/** Collects notifications and lets a test await the one it needs. */
function createCollector() {
	const notifications: MonitorNotification[] = [];
	return {
		notifications,
		notifier: (notification: MonitorNotification) => {
			notifications.push(notification);
		},
		/** Resolves once `predicate` holds, or rejects after `timeoutMs`. */
		async waitFor(
			predicate: (all: MonitorNotification[]) => boolean,
			timeoutMs = 5_000,
		): Promise<void> {
			const deadline = Date.now() + timeoutMs;
			while (!predicate(notifications)) {
				if (Date.now() > deadline) {
					throw new Error(
						`Timed out waiting for notifications. Got: ${JSON.stringify(
							notifications,
						)}`,
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		},
	};
}

const allLines = (notifications: MonitorNotification[]): string[] =>
	notifications.flatMap((notification) => notification.lines);

describe("MonitorRegistry", () => {
	it("delivers output lines as notifications after the tool call returns", async () => {
		const collector = createCollector();
		const registry = new MonitorRegistry({
			notifier: collector.notifier,
			flushIntervalMs: 20,
		});
		try {
			const record = registry.start({
				name: "greeter",
				command: "printf 'first\\nsecond\\n'",
				description: "prints two lines",
			});
			// start() must not block on output.
			expect(record.status).toBe("running");
			expect(collector.notifications).toHaveLength(0);

			await collector.waitFor((all) =>
				all.some((notification) => notification.exit),
			);
			expect(allLines(collector.notifications)).toEqual(["first", "second"]);
		} finally {
			registry.dispose();
		}
	});

	it("batches rapid output instead of notifying per line", async () => {
		const collector = createCollector();
		const registry = new MonitorRegistry({
			notifier: collector.notifier,
			flushIntervalMs: 50,
		});
		try {
			registry.start({
				name: "chatty",
				command: "printf 'a\\nb\\nc\\nd\\ne\\n'",
				description: "prints five lines at once",
			});

			await collector.waitFor((all) =>
				all.some((notification) => notification.exit),
			);
			expect(allLines(collector.notifications)).toEqual([
				"a",
				"b",
				"c",
				"d",
				"e",
			]);
			// Five lines written in one burst should not become five interruptions.
			expect(collector.notifications.length).toBeLessThan(5);
		} finally {
			registry.dispose();
		}
	});

	it("reports a final line that was never newline-terminated", async () => {
		const collector = createCollector();
		const registry = new MonitorRegistry({
			notifier: collector.notifier,
			flushIntervalMs: 20,
		});
		try {
			registry.start({
				name: "unterminated",
				command: "printf 'no trailing newline'",
				description: "prints without a trailing newline",
			});

			await collector.waitFor((all) =>
				all.some((notification) => notification.exit),
			);
			expect(allLines(collector.notifications)).toEqual([
				"no trailing newline",
			]);
		} finally {
			registry.dispose();
		}
	});

	it("does not split a line that arrives across two chunks", async () => {
		const collector = createCollector();
		const registry = new MonitorRegistry({
			notifier: collector.notifier,
			flushIntervalMs: 20,
		});
		try {
			registry.start({
				name: "chunked",
				command: "printf 'half-'; sleep 0.2; printf 'whole\\n'",
				description: "writes one line in two chunks",
			});

			await collector.waitFor((all) =>
				all.some((notification) => notification.exit),
			);
			expect(allLines(collector.notifications)).toEqual(["half-whole"]);
		} finally {
			registry.dispose();
		}
	});

	it("tags stderr and reports a non-zero exit", async () => {
		const collector = createCollector();
		const registry = new MonitorRegistry({
			notifier: collector.notifier,
			flushIntervalMs: 20,
		});
		try {
			registry.start({
				name: "failing",
				command: "printf 'bad\\n' >&2; exit 3",
				description: "fails immediately",
			});

			await collector.waitFor((all) =>
				all.some((notification) => notification.exit),
			);
			expect(allLines(collector.notifications)).toEqual(["[stderr] bad"]);
			const final = collector.notifications.at(-1);
			expect(final?.exit).toMatchObject({ status: "exited", code: 3 });
		} finally {
			registry.dispose();
		}
	});

	it("truncates a line that would flood the transcript", async () => {
		const collector = createCollector();
		const registry = new MonitorRegistry({
			notifier: collector.notifier,
			flushIntervalMs: 20,
			maxLineChars: 40,
		});
		try {
			registry.start({
				name: "verbose",
				command: "printf '%0.sx' $(seq 1 500); printf '\\n'",
				description: "prints one very long line",
			});

			await collector.waitFor((all) =>
				all.some((notification) => notification.exit),
			);
			const [line] = allLines(collector.notifications);
			expect(line).toHaveLength(40);
			expect(line).toContain("truncated");
		} finally {
			registry.dispose();
		}
	});

	it("caps lines per notification and reports the drop", async () => {
		const collector = createCollector();
		const registry = new MonitorRegistry({
			notifier: collector.notifier,
			flushIntervalMs: 200,
			maxLinesPerNotification: 3,
		});
		try {
			registry.start({
				name: "flood",
				command: "for i in 1 2 3 4 5 6 7 8; do printf '%s\\n' \"$i\"; done",
				description: "prints eight lines at once",
			});

			await collector.waitFor((all) =>
				all.some((notification) => notification.exit),
			);
			for (const notification of collector.notifications) {
				expect(notification.lines.length).toBeLessThanOrEqual(3);
			}
			const dropped = collector.notifications.reduce(
				(total, notification) => total + (notification.droppedLines ?? 0),
				0,
			);
			expect(dropped).toBeGreaterThan(0);
		} finally {
			registry.dispose();
		}
	});

	it("keeps a long-running monitor alive until it is stopped", async () => {
		const collector = createCollector();
		const registry = new MonitorRegistry({
			notifier: collector.notifier,
			flushIntervalMs: 20,
		});
		try {
			const record = registry.start({
				name: "ticker",
				command: "while true; do printf 'tick\\n'; sleep 0.1; done",
				description: "ticks forever",
			});

			await collector.waitFor((all) => allLines(all).length >= 2);
			expect(registry.listRunning()).toHaveLength(1);

			const stopped = registry.stop(record.id);
			expect(stopped?.status).toBe("stopped");
			expect(registry.listRunning()).toHaveLength(0);

			// A stopped monitor must go quiet.
			const seen = collector.notifications.length;
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(collector.notifications.length).toBe(seen);
		} finally {
			registry.dispose();
		}
	});

	it("refuses a duplicate name while the first is running", () => {
		const registry = new MonitorRegistry({ notifier: () => {} });
		try {
			const start = {
				name: "same",
				command: "sleep 30",
				description: "watch",
			};
			registry.start(start);
			expect(() => registry.start(start)).toThrow(MonitorError);
		} finally {
			registry.dispose();
		}
	});

	it("allows reusing a name once the first has stopped", () => {
		const registry = new MonitorRegistry({ notifier: () => {} });
		try {
			const start = {
				name: "reused",
				command: "sleep 30",
				description: "watch",
			};
			registry.start(start);
			registry.stop("reused");
			expect(() => registry.start(start)).not.toThrow();
		} finally {
			registry.dispose();
		}
	});

	it("enforces the concurrent monitor limit", () => {
		const registry = new MonitorRegistry({
			notifier: () => {},
			maxMonitors: 2,
		});
		try {
			registry.start({ name: "a", command: "sleep 30", description: "a" });
			registry.start({ name: "b", command: "sleep 30", description: "b" });
			expect(() =>
				registry.start({ name: "c", command: "sleep 30", description: "c" }),
			).toThrow(/limit/);
		} finally {
			registry.dispose();
		}
	});

	it("stops running processes on dispose", async () => {
		const registry = new MonitorRegistry({
			notifier: () => {},
			terminationGracePeriodMs: 50,
		});
		registry.start({
			name: "leaky",
			command: "sleep 30",
			description: "would outlive the session",
		});
		expect(registry.listRunning()).toHaveLength(1);

		await registry.dispose();
		expect(registry.list()).toHaveLength(0);
		expect(() =>
			registry.start({ name: "after", command: "sleep 1", description: "x" }),
		).toThrow(MonitorError);
	});

	it.skipIf(process.platform === "win32")(
		"escalates to SIGKILL when a process ignores SIGTERM",
		async () => {
			const registry = new MonitorRegistry({
				notifier: () => {},
				terminationGracePeriodMs: 50,
			});
			registry.start({
				name: "stubborn",
				command: "trap '' TERM; while true; do sleep 1; done",
				description: "ignores graceful termination",
			});

			await registry.dispose();
			expect(registry.list()).toHaveLength(0);
		},
	);

	it("survives a notifier that throws", async () => {
		const notifier = vi.fn(() => {
			throw new Error("host exploded");
		});
		const registry = new MonitorRegistry({ notifier, flushIntervalMs: 20 });
		try {
			registry.start({
				name: "resilient",
				command: "printf 'one\\n'",
				description: "prints a line",
			});

			const deadline = Date.now() + 5_000;
			while (notifier.mock.calls.length === 0 && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			expect(notifier).toHaveBeenCalled();
			// The monitor still settles rather than hanging in "running".
			expect(registry.listRunning()).toHaveLength(0);
		} finally {
			registry.dispose();
		}
	});

	it("returns undefined when stopping something that does not exist", () => {
		const registry = new MonitorRegistry({ notifier: () => {} });
		expect(registry.stop("nope")).toBeUndefined();
		registry.dispose();
	});
});

describe("formatMonitorNotification", () => {
	const base = {
		monitorId: "mon_1",
		name: "ci",
		description: "CI status",
	};

	it("labels output with the monitor name and description", () => {
		expect(
			formatMonitorNotification({ ...base, lines: ["build failed"] }),
		).toBe("[monitor: ci] CI status\nbuild failed");
	});

	it("notes dropped lines", () => {
		expect(
			formatMonitorNotification({
				...base,
				lines: ["a"],
				droppedLines: 7,
			}),
		).toContain("7 more line(s) dropped");
	});

	it("reports each terminal state distinctly", () => {
		expect(
			formatMonitorNotification({
				...base,
				lines: [],
				exit: { status: "exited", code: 0 },
			}),
		).toContain("ended with exit code 0");
		expect(
			formatMonitorNotification({
				...base,
				lines: [],
				exit: { status: "stopped" },
			}),
		).toContain("stopped");
		expect(
			formatMonitorNotification({
				...base,
				lines: [],
				exit: { status: "failed", error: "spawn ENOENT" },
			}),
		).toContain("spawn ENOENT");
	});
});
