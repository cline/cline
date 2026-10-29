// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoutineSchedulesContent } from "./routine-view";

const { invoke, subscribe } = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribe: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe },
}));
vi.mock("@/lib/provider-model-catalog", () => ({
	loadProviderModelCatalog: async () => ({
		providerModels: {},
		enabledProviderIds: [],
	}),
	loadProviderModels: async () => [],
}));
vi.mock("@/lib/model-selection", () => ({
	readModelSelectionStorageFromWindow: () => ({
		lastProvider: "",
		lastModelByProvider: {},
	}),
}));

const schedule = {
	scheduleId: "schedule-1",
	name: "Daily PR summary",
	cronPattern: "0 9 * * *",
	prompt: "Summarize PRs",
	mode: "yolo",
	maxParallel: 1,
	enabled: true,
	createdAt: 1,
	updatedAt: 1,
};

function overview(status = "pending", errorMessage?: string) {
	return {
		schedules: [schedule],
		activeExecutions: [],
		upcomingRuns: [],
		lastExecutions: [
			{
				executionId: "execution-1",
				scheduleId: schedule.scheduleId,
				status,
				errorMessage,
			},
		],
	};
}

let container: HTMLDivElement;
let root: Root;
let handlers: Map<string, () => void>;
let unsubscribers: Array<ReturnType<typeof vi.fn>>;

beforeEach(() => {
	vi.useFakeTimers();
	Object.assign(globalThis, {
		IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	});
	handlers = new Map();
	unsubscribers = [];
	invoke.mockReset().mockResolvedValue(overview());
	subscribe
		.mockReset()
		.mockImplementation((event: string, handler: () => void) => {
			handlers.set(event, handler);
			const unsubscribe = vi.fn(() => handlers.delete(event));
			unsubscribers.push(unsubscribe);
			return unsubscribe;
		});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function mount() {
	await act(async () => root.render(<RoutineSchedulesContent />));
	await act(async () => vi.advanceTimersByTimeAsync(0));
}

describe("schedule execution updates", () => {
	it.each([
		false,
		true,
	])("opens the triggered session after a slow refresh (superseded: %s)", async (superseded) => {
		const onOpenSession = vi.fn();
		await act(async () =>
			root.render(<RoutineSchedulesContent onOpenSession={onOpenSession} />),
		);
		await act(async () => vi.advanceTimersByTimeAsync(0));
		const delayed = Promise.withResolvers<ReturnType<typeof overview>>();
		invoke
			.mockResolvedValueOnce({ execution: { executionId: "execution-1" } })
			.mockReturnValueOnce(delayed.promise)
			.mockResolvedValue(overview("success"));
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Run Daily PR summary now"]',
				)
				?.click(),
		);
		expect(invoke).toHaveBeenCalledWith("trigger_routine_schedule", {
			schedule_id: schedule.scheduleId,
		});
		if (superseded)
			await act(async () => handlers.get("schedule.execution_completed")?.());
		await act(async () => vi.advanceTimersByTimeAsync(16_000));
		const response = {
			...overview("running"),
			lastExecutions: [
				{ ...overview("running").lastExecutions[0], sessionId: "session-new" },
			],
		};
		await act(async () => delayed.resolve(response));
		expect(onOpenSession).toHaveBeenCalledExactlyOnceWith("session-new");
		expect(container.textContent).toContain(superseded ? "success" : "running");
	});
	it("shows a failure received after loading Pending, even without a session", async () => {
		await mount();
		expect(container.textContent).toContain("pending");
		const error =
			"Unauthorized: Re-authenticate your Cline account.\nRequest ID: example";
		invoke.mockResolvedValue(overview("failed", error));

		await act(async () => handlers.get("schedule.execution_failed")?.());

		expect(container.textContent).toContain("Last error:");
		expect(container.textContent).toContain(error);
		expect(container.textContent).not.toContain("pending");
		// A startup failure has no chat to open, so the history must expose
		// the full error directly rather than relying on session navigation.
		await act(async () =>
			container.querySelector<HTMLElement>('[role="button"]')?.click(),
		);
		const historyError = Array.from(document.querySelectorAll("span")).find(
			(element) => element.textContent === error,
		);
		expect(historyError).toBeDefined();
		expect(historyError?.classList.contains("truncate")).toBe(false);
	});

	it("fetches fresh data when Refresh is clicked immediately after loading", async () => {
		await mount();
		invoke.mockResolvedValue(overview("failed", "Cannot connect to API"));

		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Refresh schedules"]',
				)
				?.click(),
		);

		expect(invoke).toHaveBeenCalledTimes(2);
		expect(container.textContent).toContain("Cannot connect to API");
	});

	it("polls transitions and refreshes when the window regains focus", async () => {
		await mount();
		invoke.mockResolvedValue(overview("running"));
		await act(async () => vi.advanceTimersByTimeAsync(15_000));
		expect(container.textContent).toContain("running");
		invoke.mockResolvedValue(
			overview("failed", "getaddrinfo ENOTFOUND api.cline.bot"),
		);
		await act(async () => window.dispatchEvent(new Event("focus")));
		expect(container.textContent).toContain(
			"getaddrinfo ENOTFOUND api.cline.bot",
		);
	});

	it("allows consistently slow overview requests to finish between polls", async () => {
		invoke.mockImplementation(
			() =>
				new Promise((resolve) => {
					setTimeout(
						() => resolve(overview("failed", "Cannot connect to API")),
						20_000,
					);
				}),
		);
		await mount();
		await act(async () => vi.advanceTimersByTimeAsync(15_000));
		expect(invoke).toHaveBeenCalledTimes(1);
		await act(async () => window.dispatchEvent(new Event("focus")));
		expect(invoke).toHaveBeenCalledTimes(1);
		await act(async () => vi.advanceTimersByTimeAsync(5_000));
		expect(container.textContent).toContain("Cannot connect to API");
		await act(async () => vi.advanceTimersByTimeAsync(30_000));
		expect(invoke).toHaveBeenCalledTimes(2);
		expect(container.textContent).toContain("Cannot connect to API");
	});

	it("shows a slow request's timeout and resumes polling afterward", async () => {
		let rejectRequest!: (error: Error) => void;
		invoke.mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					rejectRequest = reject;
				}),
		);
		await mount();
		await act(async () => vi.advanceTimersByTimeAsync(119_000));
		expect(invoke).toHaveBeenCalledTimes(1);
		await act(async () =>
			rejectRequest(new Error("Overview request timed out")),
		);
		expect(container.textContent).toContain("Overview request timed out");
		expect(
			container.querySelector<HTMLButtonElement>(
				'button[aria-label="Refresh schedules"]',
			)?.disabled,
		).toBe(false);
		invoke.mockResolvedValue(overview("success"));
		await act(async () => vi.advanceTimersByTimeAsync(1_000));
		expect(invoke).toHaveBeenCalledTimes(2);
		expect(container.textContent).toContain("success");
		expect(container.textContent).not.toContain("Overview request timed out");
	});

	it("does not let an older response overwrite a completed execution", async () => {
		await mount();
		let resolveOld!: (response: ReturnType<typeof overview>) => void;
		invoke.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveOld = resolve;
				}),
		);
		await act(async () => window.dispatchEvent(new Event("focus")));
		invoke.mockResolvedValue(overview("success"));
		await act(async () => handlers.get("schedule.execution_completed")?.());
		await act(async () => resolveOld(overview("pending")));
		expect(container.textContent).toContain("success");
		expect(container.textContent).not.toContain("pending");
	});

	it("removes subscriptions and polling when leaving the page", async () => {
		await mount();
		await act(async () => root.render(null));
		const calls = invoke.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_000);
			window.dispatchEvent(new Event("focus"));
		});
		expect(invoke).toHaveBeenCalledTimes(calls);
		for (const unsubscribe of unsubscribers)
			expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
