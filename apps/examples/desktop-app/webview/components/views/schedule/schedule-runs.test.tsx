// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleRuns } from "./schedule-runs";
import type { ScheduleExecution } from "./schedule-types";

const scheduleId = "schedule-1";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

function execution(
	id: string,
	timestamp: number,
	overrides: Partial<ScheduleExecution> = {},
): ScheduleExecution {
	return {
		executionId: id,
		scheduleId: scheduleId,
		triggeredAt: timestamp,
		status: "success",
		...overrides,
	};
}

describe("ScheduleRuns pagination", () => {
	function history(count: number, id = scheduleId) {
		return Array.from({ length: count }, (_, index) =>
			execution(`${id}-run-${index + 1}`, (index + 1) * 60_000, {
				scheduleId: id,
				status: "failed",
				errorMessage: `${id} failure ${index + 1}`,
			}),
		);
	}

	function displayedRuns() {
		return Array.from(
			container.querySelectorAll(
				'[data-slot="detail-list-item"] .whitespace-pre-wrap',
			),
			(element) => element.textContent,
		);
	}

	function failures(start: number, end: number, id = scheduleId) {
		return Array.from(
			{ length: start - end + 1 },
			(_, index) => `${id} failure ${start - index}`,
		);
	}

	async function goToPage(page: number) {
		const button = container.querySelector<HTMLButtonElement>(
			`nav[aria-label="Run pages"] button[aria-label="Go to page ${page}"]`,
		);
		if (!button) throw new Error(`Missing run page ${page}`);
		await act(async () => button.click());
	}

	it("limits each page to 25 filtered, deduplicated runs in newest-first order", async () => {
		const executions = [
			execution(`${scheduleId}-run-52`, 52 * 60_000, {
				status: "running",
				errorMessage: "Stale snapshot",
			}),
			execution("other-schedule", 99 * 60_000, {
				scheduleId: "other-schedule",
				errorMessage: "Unrelated run",
			}),
			...history(52),
		];
		await act(async () =>
			root.render(
				<ScheduleRuns scheduleId={scheduleId} executions={executions} />,
			),
		);

		expect(displayedRuns()).toEqual(failures(52, 28));
		expect(container.textContent).toContain("1–25 of 52 runs");
		expect(container.textContent).not.toContain("Stale snapshot");
		expect(container.textContent).not.toContain("Unrelated run");
		await goToPage(2);
		expect(displayedRuns()).toEqual(failures(27, 3));
		expect(container.textContent).toContain("26–50 of 52 runs");
		await goToPage(3);
		expect(displayedRuns()).toEqual(failures(2, 1));
		expect(container.textContent).toContain("51–52 of 52 runs");
		expect(
			container.querySelector<HTMLButtonElement>(
				'nav[aria-label="Run pages"] button[aria-label="Next page"]',
			)?.disabled,
		).toBe(true);
		expect(executions[0]?.errorMessage).toBe("Stale snapshot");
	});

	it("keeps the page on refresh and clamps it as the run history shrinks", async () => {
		await act(async () =>
			root.render(
				<ScheduleRuns scheduleId={scheduleId} executions={history(52)} />,
			),
		);
		await goToPage(3);
		await act(async () =>
			root.render(
				<ScheduleRuns
					scheduleId={scheduleId}
					executions={history(52).reverse()}
				/>,
			),
		);
		expect(displayedRuns()).toEqual(failures(2, 1));
		expect(container.textContent).toContain("51–52 of 52 runs");

		await act(async () =>
			root.render(
				<ScheduleRuns scheduleId={scheduleId} executions={history(30)} />,
			),
		);
		expect(displayedRuns()).toEqual(failures(5, 1));
		expect(container.textContent).toContain("26–30 of 30 runs");
		expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
			"2",
		);
		await act(async () =>
			root.render(
				<ScheduleRuns scheduleId={scheduleId} executions={history(25)} />,
			),
		);
		expect(displayedRuns()).toEqual(failures(25, 1));
		expect(container.querySelector('nav[aria-label="Run pages"]')).toBeNull();
	});

	it("resets to the first page when a different schedule is opened", async () => {
		const nextScheduleId = "schedule-2";
		const executions = [...history(52), ...history(52, nextScheduleId)];
		await act(async () =>
			root.render(
				<ScheduleRuns scheduleId={scheduleId} executions={executions} />,
			),
		);
		await goToPage(3);
		await act(async () =>
			root.render(
				<ScheduleRuns scheduleId={nextScheduleId} executions={executions} />,
			),
		);

		expect(displayedRuns()).toEqual(failures(52, 28, nextScheduleId));
		expect(container.textContent).toContain("1–25 of 52 runs");
		expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
			"1",
		);
	});
});

describe("ScheduleRuns", () => {
	it("shows startup errors without a session and opens only available run sessions", async () => {
		const error =
			"Unauthorized: Re-authenticate your Cline account.\nRequest ID: example\nAdditional failure details";
		const onOpenSession = vi.fn();
		await act(async () =>
			root.render(
				<ScheduleRuns
					scheduleId={scheduleId}
					executions={[
						execution("failed", 2, { status: "failed", errorMessage: error }),
						execution("complete", 1, {
							sessionId: "session-complete",
							startedAt: 1,
							endedAt: 1_001,
						}),
					]}
					onOpenSession={onOpenSession}
				/>,
			),
		);

		const rows = container.querySelectorAll('[data-slot="detail-list-item"]');
		const failedRow = Array.from(rows).find((row) =>
			row.textContent?.includes(error),
		);
		expect(failedRow?.querySelector("button")).toBeNull();
		const errorText = failedRow?.querySelector(".whitespace-pre-wrap");
		expect(errorText?.classList.contains("whitespace-pre-wrap")).toBe(true);
		const openSession = container.querySelector<HTMLButtonElement>(
			'[data-slot="detail-list-item-primary"]',
		);
		expect(openSession?.textContent).toBe(new Date(1).toLocaleString());
		expect(openSession?.getAttribute("aria-label")).toBe(
			`Open session triggered ${new Date(1).toLocaleString()}`,
		);
		expect(container.textContent).not.toContain("View session");
		await act(async () => openSession?.click());
		expect(onOpenSession).toHaveBeenCalledExactlyOnceWith("session-complete");
	});

	it("shortens a long error until the reader asks for all of it", async () => {
		const heights = vi
			.spyOn(HTMLElement.prototype, "scrollHeight", "get")
			.mockReturnValue(240);
		vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
		try {
			await act(async () =>
				root.render(
					<ScheduleRuns
						scheduleId={scheduleId}
						executions={[
							execution("failed", 1, {
								status: "timeout",
								errorMessage: "line\n".repeat(40),
							}),
						]}
					/>,
				),
			);
			const errorText = () => container.querySelector(".whitespace-pre-wrap");
			const toggle = () =>
				container.querySelector<HTMLButtonElement>("button[aria-expanded]");
			expect(container.textContent).toContain("Timed out");
			expect(errorText()?.classList.contains("line-clamp-5")).toBe(true);
			expect(toggle()?.textContent).toBe("Show full error");
			await act(async () => toggle()?.click());
			expect(errorText()?.classList.contains("line-clamp-5")).toBe(false);
			expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
			expect(toggle()?.textContent).toBe("Show less");
		} finally {
			heights.mockRestore();
			vi.restoreAllMocks();
		}
	});

	it("filters other schedules, deduplicates snapshots, and shows all matching runs newest first", async () => {
		const onOpenSession = vi.fn();
		const executions = [
			execution("shared", 5, { status: "running" }),
			execution("oldest", 1, { sessionId: "session-oldest" }),
			execution("unrelated", 99, {
				scheduleId: "another-schedule",
				errorMessage: "Private other schedule error",
				sessionId: "other-session",
			}),
			execution("middle", 2, { sessionId: "session-middle" }),
			execution("shared", 5, {
				status: "completed",
				sessionId: "session-shared",
			}),
			execution("newer", 3, { sessionId: "session-newer" }),
		];
		await act(async () =>
			root.render(
				<ScheduleRuns
					scheduleId={scheduleId}
					executions={executions}
					onOpenSession={onOpenSession}
				/>,
			),
		);

		const rows = container.querySelectorAll('[data-slot="detail-list-item"]');
		expect(rows).toHaveLength(4);
		expect(rows[0]?.textContent).toContain("Completed");
		expect(container.textContent).not.toContain("Running");
		expect(container.textContent).not.toContain("Private other schedule error");
		await act(async () => {
			for (const button of container.querySelectorAll("button")) button.click();
		});
		expect(onOpenSession.mock.calls.map(([sessionId]) => sessionId)).toEqual([
			"session-shared",
			"session-newer",
			"session-middle",
			"session-oldest",
		]);
		// Sorting the display must not reorder the shared overview snapshot.
		expect(executions[0]?.status).toBe("running");
		expect(executions[1]?.executionId).toBe("oldest");
	});

	it("keeps unsaved and saved empty states distinct without exposing another schedule's runs", async () => {
		const executions = [
			execution("other", 1, {
				scheduleId: "another-schedule",
				errorMessage: "Private other schedule error",
			}),
		];
		await act(async () =>
			root.render(<ScheduleRuns executions={executions} />),
		);
		expect(container.textContent).toContain(
			"Save this schedule to see its runs.",
		);
		expect(container.textContent).not.toContain("Private other schedule error");
		await act(async () =>
			root.render(
				<ScheduleRuns scheduleId={scheduleId} executions={executions} />,
			),
		);
		expect(container.textContent).toContain("No runs yet.");
		expect(container.textContent).not.toContain("Save this schedule");
		expect(container.textContent).not.toContain("Private other schedule error");
	});
});
