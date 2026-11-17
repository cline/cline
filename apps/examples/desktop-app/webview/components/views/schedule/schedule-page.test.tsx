// @vitest-environment jsdom

import {
	ONE_TIME_SCHEDULE_CRON_PATTERN,
	ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY,
} from "@cline/shared/browser";
import { act, useMemo, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetScheduleRunNotificationsForTesting } from "@/hooks/use-schedule-run-notifications";
import {
	createDesktopAppState,
	desktopAppReducer,
} from "@/lib/desktop-app-state";
import {
	type DetailNavigationHost,
	DetailNavigationProvider,
} from "@/lib/detail-navigation";
import { loadProviderModelCatalog } from "@/lib/provider-model-catalog";
import {
	UnsavedChangesProvider,
	useUnsavedChangesRegistry,
} from "@/lib/unsaved-changes";
import { SchedulePage } from "./schedule-page";
import { SCHEDULE_TEMPLATES } from "./schedule-templates";

const { invoke, subscribe } = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribe: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe },
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/provider-model-catalog", () => ({
	loadProviderModelCatalog: vi.fn(async () => ({
		providerModels: {},
		providerReasoningModels: {},
		providerModelDetails: {},
		providerNames: {},
		enabledProviderIds: [],
	})),
	loadProviderModels: async () => [],
	subscribeToProviderModels: () => () => {},
	subscribeToProviderCatalogInvalidation: () => () => {},
}));
vi.mock("@/lib/model-selection", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/model-selection")>()),
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
	workspaceRoot: "/workspace/project",
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
let handlers: Map<string, (payload?: unknown) => void>;
let unsubscribers: Array<ReturnType<typeof vi.fn>>;
let headerTitleBottom: number;

async function defaultInvoke(command: string) {
	if (command === "list_routine_schedules") return overview();
	if (command === "get_process_context")
		return {
			workspaceRoot: "/workspace/project",
			cwd: "/workspace/project/src",
		};
	return undefined;
}

beforeEach(() => {
	vi.useFakeTimers();
	resetScheduleRunNotificationsForTesting();
	HTMLElement.prototype.scrollIntoView = vi.fn();
	headerTitleBottom = 240;
	const getBounds = HTMLElement.prototype.getBoundingClientRect;
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			if (this.matches("form h1"))
				return new DOMRect(0, headerTitleBottom - 32, 400, 32);
			if (this.hasAttribute("data-item-scroll-header"))
				return new DOMRect(0, 0, 800, 64);
			return getBounds.call(this);
		},
	);
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
	invoke.mockReset().mockImplementation(defaultInvoke);
	vi.mocked(loadProviderModelCatalog).mockResolvedValue({
		voiceInput: null,
		providers: [],
		providerModels: {},
		providerReasoningModels: {},
		providerModelDetails: {},
		providerNames: {},
		enabledProviderIds: [],
	});
	subscribe
		.mockReset()
		.mockImplementation(
			(event: string, handler: (payload?: unknown) => void) => {
				handlers.set(event, handler);
				const unsubscribe = vi.fn(() => handlers.delete(event));
				unsubscribers.push(unsubscribe);
				return unsubscribe;
			},
		);
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

async function mount(
	onOpenSession?: (sessionId: string) => void | Promise<void>,
) {
	await act(async () =>
		root.render(<SchedulePage onOpenSession={onOpenSession} />),
	);
	await act(async () => vi.advanceTimersByTimeAsync(0));
}

describe("schedule list pagination", () => {
	function schedules(count: number) {
		return Array.from({ length: count }, (_, index) => ({
			...schedule,
			scheduleId: `schedule-${index + 1}`,
			name: `Schedule ${String(index + 1).padStart(3, "0")}`,
		}));
	}

	function displayedSchedules() {
		return Array.from(
			container.querySelectorAll(
				'[aria-label="Schedules"] [data-slot="detail-list-item-primary"]',
			),
			(element) => element.getAttribute("aria-label"),
		);
	}

	function names(start: number, end: number) {
		return Array.from(
			{ length: end - start + 1 },
			(_, index) => `Open Schedule ${String(start + index).padStart(3, "0")}`,
		);
	}

	it("paginates after alphabetical sorting and includes the final partial page", async () => {
		const unsortedSchedules = schedules(52).reverse();
		invoke.mockResolvedValue({ ...overview(), schedules: unsortedSchedules });
		await mount();

		expect(displayedSchedules()).toEqual(names(1, 20));
		expect(container.textContent).toContain("1–20 of 52 schedules");
		expect(
			container.querySelector('nav[aria-label="Schedule pages"]'),
		).not.toBeNull();
		await act(async () => button("Next page").click());
		expect(displayedSchedules()).toEqual(names(21, 40));
		expect(container.textContent).toContain("21–40 of 52 schedules");
		await act(async () => button("Next page").click());
		expect(displayedSchedules()).toEqual(names(41, 52));
		expect(container.textContent).toContain("41–52 of 52 schedules");
		expect(button("Next page").disabled).toBe(true);
		expect(unsortedSchedules[0]?.name).toBe("Schedule 052");
	});

	it("keeps the list page when returning from the editor and refreshing", async () => {
		invoke.mockImplementation(async (command: string) =>
			command === "list_routine_schedules"
				? { ...overview(), schedules: schedules(52) }
				: defaultInvoke(command),
		);
		await mount();
		await act(async () => button("Next page").click());
		const trigger = button("Open Schedule 021");
		await act(async () => trigger.click());
		expect(field("schedule-name").value).toBe("Schedule 021");
		await act(async () => button("Back to Schedule").click());

		expect(displayedSchedules()).toEqual(names(21, 40));
		expect(document.activeElement).toBe(trigger);
		await act(async () => button("Refresh schedules").click());
		expect(displayedSchedules()).toEqual(names(21, 40));
		expect(container.textContent).toContain("21–40 of 52 schedules");
		expect(button("Go to page 2").getAttribute("aria-current")).toBe("page");
	});

	it("clamps the page when refreshed schedules shrink and hides one-page controls", async () => {
		let currentSchedules = schedules(52);
		invoke.mockImplementation(async (command: string) =>
			command === "list_routine_schedules"
				? { ...overview(), schedules: currentSchedules }
				: defaultInvoke(command),
		);
		await mount();
		await act(async () => button("Go to page 3").click());
		currentSchedules = schedules(30);
		await act(async () => handlers.get("schedule.execution_completed")?.());

		expect(displayedSchedules()).toEqual(names(21, 30));
		expect(container.textContent).toContain("21–30 of 30 schedules");
		expect(button("Go to page 2").getAttribute("aria-current")).toBe("page");
		currentSchedules = schedules(20);
		await act(async () => handlers.get("schedule.execution_completed")?.());
		expect(displayedSchedules()).toEqual(names(1, 20));
		expect(
			container.querySelector('nav[aria-label="Schedule pages"]'),
		).toBeNull();
	});
});

describe("schedule execution updates", () => {
	it("shows and opens an active run before it appears in recent history", async () => {
		const startedAt = Date.now();
		const onOpenSession = vi.fn();
		invoke.mockResolvedValue({
			...overview(),
			lastExecutions: [],
			activeExecutions: [
				{
					executionId: "active-run",
					scheduleId: schedule.scheduleId,
					sessionId: "active-session",
					startedAt,
				},
			],
		});
		await mount(onOpenSession);
		expect(container.textContent).toContain("Running");
		await act(async () => button("Open Daily PR summary").click());
		expect(button("Runs").getAttribute("aria-checked")).toBe("true");
		expect(container.querySelector("#schedule-runs")?.textContent).toContain(
			"Running",
		);
		await act(async () =>
			button(
				`Open session triggered ${new Date(startedAt).toLocaleString()}`,
			).click(),
		);
		expect(onOpenSession).toHaveBeenCalledExactlyOnceWith("active-session");
	});

	it.each([
		false,
		true,
	])("selects Runs before a slow refresh completes (superseded: %s)", async (superseded) => {
		const onOpenSession = vi.fn();
		await mount(onOpenSession);
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		const delayed = Promise.withResolvers<ReturnType<typeof overview>>();
		invoke
			.mockResolvedValueOnce({ execution: { executionId: "execution-1" } })
			.mockReturnValueOnce(delayed.promise)
			.mockResolvedValue(overview("success"));
		await act(async () => runButton().click());
		expect(invoke).toHaveBeenCalledWith("trigger_routine_schedule", {
			schedule_id: schedule.scheduleId,
		});
		expect(button("Runs").getAttribute("aria-checked")).toBe("true");
		expect(container.querySelector<HTMLElement>("#schedule-runs")?.hidden).toBe(
			false,
		);
		expect(onOpenSession).not.toHaveBeenCalled();
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
		expect(onOpenSession).not.toHaveBeenCalled();
		expect(button("Runs").getAttribute("aria-checked")).toBe("true");
		expect(container.textContent).toContain(
			superseded ? "Completed" : "Running",
		);
	});
	it("shows a failure received after loading Pending, even without a session", async () => {
		await mount();
		expect(container.textContent).toContain("Pending");
		const error =
			"Unauthorized: Re-authenticate your Cline account.\nRequest ID: example";
		invoke.mockResolvedValue(overview("failed", error));

		await act(async () => handlers.get("schedule.execution_failed")?.());

		expect(container.textContent).toContain("Last error:");
		expect(container.textContent).toContain(error);
		expect(container.textContent).not.toContain("Pending");
		// A startup failure has no chat to open, so the history must expose
		// the full error directly rather than relying on session navigation.
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Runs").click());
		const runs = container.querySelector<HTMLElement>("#schedule-runs");
		expect(runs?.hidden).toBe(false);
		expect(
			container.querySelector('form[aria-label="Edit schedule"]'),
		).not.toBeNull();
		const historyError = Array.from(runs?.querySelectorAll("span") ?? []).find(
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
		expect(container.textContent).toContain("Running");
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
		expect(container.textContent).toContain("Completed");
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
		expect(container.textContent).toContain("Completed");
		expect(container.textContent).not.toContain("Pending");
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

describe("Runs error indicator", () => {
	function expectRunError(visible: boolean) {
		const runs = button("Runs");
		expect(runs.getAttribute("aria-description")).toBe(
			visible ? "Some recent runs have errors." : null,
		);
		const icon = runs.querySelector("svg");
		if (visible) {
			expect(icon).not.toBeNull();
			expect(icon?.getAttribute("aria-hidden")).toBe("true");
		} else {
			expect(icon).toBeNull();
		}
	}

	it.each([
		{ status: "failed", error: undefined },
		{ status: " TIMEOUT ", error: undefined },
		{ status: "aborted", error: undefined },
		{ status: "unknown", error: "Could not start the run" },
	])("flags a recent $status run even after another run succeeds", async ({
		status,
		error,
	}) => {
		invoke.mockResolvedValue({
			...overview(status, error),
			lastExecutions: [
				{ ...overview(status, error).lastExecutions[0], endedAt: 1 },
				{
					...overview("success").lastExecutions[0],
					executionId: "newer-success",
					endedAt: 2,
				},
			],
		});
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		expectRunError(true);
		expect(button("Runs").getAttribute("aria-checked")).toBe("true");
	});

	it("ignores clean or unfinished runs and errors from another schedule", async () => {
		invoke.mockResolvedValue({
			...overview(),
			lastExecutions: [
				...["success", "completed", "running", "pending"].map((status) => ({
					...overview(status, "  ").lastExecutions[0],
					executionId: status,
				})),
				{
					...overview("failed", "Other schedule error").lastExecutions[0],
					scheduleId: "another-schedule",
				},
			],
		});
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		expectRunError(false);
	});

	it("uses the newest snapshot of a run instead of a stale failure", async () => {
		invoke.mockResolvedValue({
			...overview("success"),
			lastExecutions: [
				{ ...overview("success").lastExecutions[0], endedAt: 2 },
			],
			activeExecutions: [
				{
					...overview("failed", "Stale failure").lastExecutions[0],
					endedAt: 1,
				},
			],
		});
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		expectRunError(false);
		await act(async () => button("Runs").click());
		expect(
			container.querySelector("#schedule-runs")?.textContent,
		).not.toContain("Stale failure");
	});

	it("updates while Settings is open and keeps Runs navigation working", async () => {
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		expectRunError(false);
		invoke.mockResolvedValue(overview("failed", "Cannot connect to provider"));
		await act(async () => handlers.get("schedule.execution_failed")?.());
		expectRunError(true);
		expect(button("Settings").getAttribute("aria-checked")).toBe("true");
		await act(async () => button("Runs").click());
		expect(button("Runs").getAttribute("aria-checked")).toBe("true");
		expect(container.querySelector("#schedule-runs")?.textContent).toContain(
			"Cannot connect to provider",
		);
		invoke.mockResolvedValue(overview("success"));
		await act(async () => handlers.get("schedule.execution_completed")?.());
		expectRunError(false);
		expect(button("Runs").getAttribute("aria-checked")).toBe("true");
	});
});

describe("Runs new-run indicator", () => {
	function expectNewRunDot(visible: boolean) {
		const runs = button("Runs");
		const dot = runs.querySelector('[data-schedule-run-status="unread"]');
		expect(Boolean(dot)).toBe(visible);
		if (visible) {
			expect(dot?.classList.contains("bg-cline-ui-info-solid")).toBe(true);
			expect(runs.getAttribute("aria-description")).toContain(
				"New run available.",
			);
		}
	}

	it("stays visible until that schedule's Runs tab is opened", async () => {
		await mount();
		invoke.mockResolvedValue({
			...overview("success"),
			lastExecutions: [
				...overview("success").lastExecutions,
				{
					executionId: "execution-2",
					scheduleId: schedule.scheduleId,
					status: "success",
				},
			],
		});
		await act(async () =>
			handlers.get("schedule.execution_completed")?.({
				executionId: "execution-2",
				scheduleId: schedule.scheduleId,
			}),
		);
		expect(
			button("Open Daily PR summary").querySelector(
				'[data-schedule-run-status="unread"]',
			),
		).not.toBeNull();

		await act(async () => button("Open Daily PR summary").click());
		expect(button("Runs").getAttribute("aria-checked")).toBe("true");
		expectNewRunDot(false);

		await act(async () => button("Settings").click());
		invoke.mockResolvedValue({
			...overview("success"),
			lastExecutions: [
				...overview("success").lastExecutions,
				{
					executionId: "execution-3",
					scheduleId: schedule.scheduleId,
					status: "success",
				},
			],
		});
		await act(async () =>
			handlers.get("schedule.execution_completed")?.({
				executionId: "execution-3",
				scheduleId: schedule.scheduleId,
			}),
		);
		expectNewRunDot(true);

		await act(async () => button("Runs").click());
		expectNewRunDot(false);
		await act(async () => button("Back to Schedule").click());
		expect(
			button("Open Daily PR summary").querySelector(
				'[data-schedule-run-status="unread"]',
			),
		).toBeNull();
	});
});

function button(...labels: string[]) {
	const element = Array.from(
		container.querySelectorAll<HTMLButtonElement>("button"),
	).find((candidate) => {
		if (candidate.closest('[hidden], [inert], [aria-hidden="true"]'))
			return false;
		const labelledBy = candidate.getAttribute("aria-labelledby");
		const name =
			candidate.getAttribute("aria-label") ??
			(labelledBy
				? labelledBy
						.split(/\s+/)
						.map((id) => document.getElementById(id)?.textContent ?? "")
						.join(" ")
				: candidate.textContent);
		return labels.includes(name ?? "");
	});
	if (!element)
		throw new Error(`Missing visible button: ${labels.join(" or ")}`);
	return element;
}

/** The Run button names what it will do: run, save first, or report progress. */
function runButton() {
	return button("Run now", "Save and run", "Starting…");
}

async function scrollEditorHeader() {
	headerTitleBottom = 32;
	const viewport = container
		.querySelector("form")
		?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
	if (!viewport) throw new Error("Schedule editor viewport is missing");
	await act(async () => viewport.dispatchEvent(new Event("scroll")));
}

function confirmationButton(label: string) {
	const element = Array.from(
		document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
	).find((candidate) => candidate.textContent === label);
	if (!element) throw new Error(`Missing confirmation button: ${label}`);
	return element;
}

function field(id: string) {
	const element = document.getElementById(id);
	if (
		!(
			element instanceof HTMLInputElement ||
			element instanceof HTMLTextAreaElement
		)
	)
		throw new Error(`Missing field: ${id}`);
	return element;
}

async function changeField(id: string, value: string) {
	await act(async () => {
		const element = field(id);
		const prototype =
			element instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
			element,
			value,
		);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function descriptionField() {
	const element = container.querySelector<HTMLTextAreaElement>(
		'textarea[aria-label="Schedule description"]',
	);
	if (!element) throw new Error("Schedule description field is missing");
	return element;
}

async function changeDescription(value: string) {
	await act(async () => field("schedule-name").focus());
	await act(async () => {
		const element = descriptionField();
		element.focus();
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(element, value);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function instructionsDisplay(mode: "source" | "preview") {
	const element = container.querySelector<HTMLInputElement>(
		`form [data-slot="file-browser-content"] input[value="${mode}"]`,
	);
	if (!element) throw new Error(`Missing instructions display mode: ${mode}`);
	return element;
}

function detailEnabledSwitch() {
	const element = container.querySelector<HTMLInputElement>(
		'form input[role="switch"]',
	);
	if (!element) throw new Error("Schedule detail enabled switch is missing");
	return element;
}

describe("schedule timing details", () => {
	const customTimingWarning = "This schedule uses custom timing";

	async function openSavedSchedule(cronPattern: string, timezone?: string) {
		invoke.mockImplementation((command: string) =>
			command === "list_routine_schedules"
				? Promise.resolve({
						...overview(),
						schedules: [
							{
								...schedule,
								cronPattern,
								timezone,
								metadata: {
									[ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY]:
										Date.now() + 86_400_000,
								},
							},
						],
					})
				: defaultInvoke(command),
		);
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
	}

	/** Report Los Angeles as the local zone wherever the tests run. */
	function mockLocalTimezone() {
		const createFormatter = Intl.DateTimeFormat;
		// Fake timers replace Intl.DateTimeFormat with a factory of plain
		// objects, so stub the factory rather than a prototype method.
		vi.spyOn(Intl, "DateTimeFormat").mockImplementation(((
			locales?: Intl.LocalesArgument,
			options?: Intl.DateTimeFormatOptions,
		) => {
			const formatter = createFormatter(locales, options);
			if (options?.timeZone) return formatter;
			return new Proxy(formatter, {
				get(target, property) {
					if (property === "resolvedOptions")
						return () => ({
							...target.resolvedOptions(),
							timeZone: "America/Los_Angeles",
						});
					const value = Reflect.get(target, property);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
		}) as typeof Intl.DateTimeFormat);
	}

	function timezoneDescription() {
		const id = field("schedule-time").getAttribute("aria-describedby");
		return id ? document.getElementById(id) : null;
	}

	it("labels a saved recurring time with its timezone instead of the browser timezone", async () => {
		vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
		mockLocalTimezone();
		await openSavedSchedule("0 9 * * *", "America/New_York");
		expect(field("schedule-time").value).toBe("09:00");
		expect(timezoneDescription()?.textContent).toBe("EST");
		expect(timezoneDescription()?.closest("[hidden]")).toBeNull();
		await changeDescription("Keep the existing timing");
		await act(async () => button("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				cron_pattern: "0 9 * * *",
				timezone: "America/New_York",
			}),
		);
	});

	it("describes the scheduling computer's timezone for legacy recurring schedules", async () => {
		mockLocalTimezone();
		await openSavedSchedule("0 9 * * *");
		expect(timezoneDescription()?.textContent).toBe(
			"Local time on the computer running this schedule",
		);
		await changeDescription("Keep the implicit timezone");
		await act(async () => button("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({ timezone: undefined }),
		);
	});

	it.each([
		"recurring draft",
		"one-time draft",
		"saved one-time",
	])("labels a %s with the local input timezone", async (kind) => {
		vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
		mockLocalTimezone();
		if (kind === "saved one-time") {
			await openSavedSchedule(ONE_TIME_SCHEDULE_CRON_PATTERN);
		} else {
			await mount();
			const template = SCHEDULE_TEMPLATES.find(
				(item) => item.id === "security-scan",
			);
			if (!template) throw new Error("Security scan suggestion is missing");
			await act(async () =>
				button(
					kind === "recurring draft" ? template.title : "New schedule",
				).click(),
			);
		}
		expect(timezoneDescription()?.textContent).toBe("PST");
	});

	it.each([
		"0 17 * * *",
		"30 9 * * MON,WED",
		"0 8 * * 1-5",
	])("omits cron details for ordinary timing even with Advanced expanded: %s", async (cronPattern) => {
		await openSavedSchedule(cronPattern);
		expect(container.querySelector("form")?.textContent).not.toContain(
			customTimingWarning,
		);
		expect(container.querySelector("form")?.textContent).not.toContain(
			"Current cron expression:",
		);
		await act(async () => button("Advanced").click());
		const advanced = container.querySelector<HTMLElement>(
			"#schedule-advanced-options",
		);
		expect(advanced?.hidden).toBe(false);
		expect(advanced?.textContent).not.toContain("Saved cron expression");
		expect(advanced?.querySelector("code")).toBeNull();
	});

	it.each([
		"0 9 1 * *",
		"0 */2 * * *",
	])("explains custom timing for %s and preserves it when other settings change", async (cronPattern) => {
		await openSavedSchedule(cronPattern);
		const warning = Array.from(container.querySelectorAll("form p")).find(
			(element) => element.textContent?.startsWith(customTimingWarning),
		);
		// The expression sits beside the controls that would replace it.
		expect(warning?.textContent).toBe(
			`This schedule uses custom timing (${cronPattern}). Changing these controls will replace it.`,
		);
		expect(warning?.querySelector("code")?.textContent).toBe(cronPattern);
		expect(warning?.closest("[hidden]")).toBeNull();
		expect(
			container.querySelector("#schedule-advanced-options")?.textContent,
		).not.toContain(cronPattern);
		await changeDescription("Updated summary without changing timing");
		await act(async () => button("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				schedule_id: schedule.scheduleId,
				description: "Updated summary without changing timing",
				cron_pattern: cronPattern,
			}),
		);
	});

	it.each([
		"draft",
		"one-time",
	])("omits cron details for a %s schedule", async (kind) => {
		if (kind === "draft") {
			await mount();
			await act(async () => button("New schedule").click());
		} else {
			await openSavedSchedule(ONE_TIME_SCHEDULE_CRON_PATTERN);
		}
		await act(async () => button("Advanced").click());
		const form = container.querySelector("form");
		expect(form?.textContent).not.toContain(customTimingWarning);
		expect(form?.textContent).not.toContain("Saved cron expression");
		expect(form?.querySelector("#schedule-advanced-options code")).toBeNull();
	});
});

describe("schedule instructions preview", () => {
	it("previews the unsaved Markdown draft, preserves editing state, and saves from preview", async () => {
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		const markdown =
			"## Review checklist\n\n- Check **authentication**\n- Summarize failures";
		const editor = field("schedule-prompt");
		const labelId = editor.getAttribute("aria-labelledby");
		expect(labelId).toBeTruthy();
		const label = document.getElementById(labelId ?? "");
		expect(label?.textContent).toBe("Instructions");
		expect(label?.closest("[hidden]")).toBeNull();
		expect(editor.closest("section")?.getAttribute("aria-labelledby")).toBe(
			labelId,
		);
		expect(
			editor
				.closest('[data-slot="file-browser-content"]')
				?.getAttribute("data-sizing"),
		).toBe("content");
		expect(instructionsDisplay("source").checked).toBe(true);
		await changeField("schedule-prompt", markdown);
		editor.setSelectionRange(3, 9);
		await act(async () => instructionsDisplay("preview").click());

		const preview = container.querySelector(
			"form .cline-ui-file-browser__preview",
		);
		expect(preview?.querySelector("h2")?.textContent).toBe("Review checklist");
		expect(
			Array.from(preview?.querySelectorAll("li") ?? []).map(
				(item) => item.textContent,
			),
		).toEqual(["Check authentication", "Summarize failures"]);
		expect(
			preview?.querySelector('[data-streamdown="strong"]')?.textContent,
		).toBe("authentication");
		expect(editor.closest("[hidden]")).not.toBeNull();
		expect(
			invoke.mock.calls.some(
				([command]) => command === "update_routine_schedule",
			),
		).toBe(false);

		await act(async () => instructionsDisplay("source").click());
		expect(field("schedule-prompt")).toBe(editor);
		expect(editor.value).toBe(markdown);
		expect(editor.selectionStart).toBe(3);
		expect(editor.selectionEnd).toBe(9);
		expect(editor.closest("[hidden]")).toBeNull();

		const updatedMarkdown = `${markdown}\n- Include next steps`;
		await changeField("schedule-prompt", updatedMarkdown);
		await act(async () => instructionsDisplay("preview").click());
		expect(
			container.querySelector("form .cline-ui-file-browser__preview")
				?.textContent,
		).toContain("Include next steps");
		await act(async () => button("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				schedule_id: schedule.scheduleId,
				prompt: updatedMarkdown,
			}),
		);
		expect(container.querySelector("form")).not.toBeNull();
		expect(instructionsDisplay("preview").checked).toBe(true);
		expect(button("Saved").querySelector("svg")).not.toBeNull();
	});

	it("shows an empty preview and keeps required instructions validation", async () => {
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		await changeField("schedule-prompt", "");
		await act(async () => instructionsDisplay("preview").click());
		expect(
			container.querySelector("form .cline-ui-file-browser__preview")
				?.textContent,
		).toBe("Nothing to preview yet.");
		await act(async () => button("Save").click());
		expect(container.querySelector("form")?.textContent).toContain(
			"Add instructions for this schedule.",
		);
		expect(instructionsDisplay("preview").checked).toBe(true);
		expect(
			invoke.mock.calls.some(
				([command]) => command === "update_routine_schedule",
			),
		).toBe(false);
		await act(async () => instructionsDisplay("source").click());
		expect(field("schedule-prompt").value).toBe("");
	});

	it("disables the editor and display switch while saving", async () => {
		const pendingSave = Promise.withResolvers<void>();
		invoke.mockImplementation((command: string) =>
			command === "update_routine_schedule"
				? pendingSave.promise
				: defaultInvoke(command),
		);
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		await changeDescription("Summary of this schedule");
		await act(async () => instructionsDisplay("preview").click());
		await act(async () => button("Save").click());
		expect(field("schedule-prompt").matches(":disabled")).toBe(true);
		expect(descriptionField().disabled).toBe(true);
		expect(detailEnabledSwitch().disabled).toBe(true);
		expect(instructionsDisplay("source").matches(":disabled")).toBe(true);
		expect(instructionsDisplay("preview").matches(":disabled")).toBe(true);
		await act(async () => instructionsDisplay("source").click());
		expect(instructionsDisplay("preview").checked).toBe(true);
		await act(async () => pendingSave.resolve());
		expect(container.querySelector("form")).not.toBeNull();
		expect(button("Saved").disabled).toBe(false);
		expect(field("schedule-prompt").matches(":disabled")).toBe(false);
	});
});

describe("schedule detail enabled state", () => {
	it.each([
		false,
		true,
	])("runs a disabled schedule without enabling it (edited: %s)", async (edited) => {
		let storedSchedule = { ...schedule, enabled: false };
		const onOpenSession = vi.fn();
		invoke.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "list_routine_schedules")
					return { ...overview(), schedules: [storedSchedule] };
				if (command === "update_routine_schedule") {
					storedSchedule = {
						...storedSchedule,
						prompt: String(args?.prompt),
						enabled: args?.enabled === true,
					};
					return { schedule: storedSchedule };
				}
				if (command === "trigger_routine_schedule") {
					expect(storedSchedule.enabled).toBe(false);
					expect(storedSchedule.prompt).toBe(
						edited ? "Test these instructions" : schedule.prompt,
					);
					return {
						execution: {
							executionId: "manual-run",
							sessionId: "manual-session",
						},
					};
				}
				return defaultInvoke(command);
			},
		);
		await mount(onOpenSession);
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		if (edited) await changeField("schedule-prompt", "Test these instructions");

		expect(runButton().disabled).toBe(false);
		await act(async () => runButton().click());

		expect(invoke).toHaveBeenCalledWith("trigger_routine_schedule", {
			schedule_id: schedule.scheduleId,
		});
		expect(onOpenSession).not.toHaveBeenCalled();
		expect(button("Runs").getAttribute("aria-checked")).toBe("true");
		expect(detailEnabledSwitch().checked).toBe(false);
		expect(storedSchedule.enabled).toBe(false);
		expect(
			invoke.mock.calls.some(
				([command]) => command === "resume_routine_schedule",
			),
		).toBe(false);
	});

	it.each([
		true,
		false,
	])("changes enabled state immediately without saving the draft (initially enabled: %s)", async (initiallyEnabled) => {
		let enabled = initiallyEnabled;
		invoke.mockImplementation(async (command: string) => {
			if (
				command === "pause_routine_schedule" ||
				command === "resume_routine_schedule"
			) {
				enabled = command === "resume_routine_schedule";
				return { schedule: { ...schedule, enabled } };
			}
			if (command === "list_routine_schedules")
				return { ...overview(), schedules: [{ ...schedule, enabled }] };
			return defaultInvoke(command);
		});
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		expect(detailEnabledSwitch().checked).toBe(initiallyEnabled);
		await act(async () => button("Settings").click());
		await changeField("schedule-name", "My unsaved title");
		await changeField("schedule-prompt", "My unsaved instructions");

		await act(async () => detailEnabledSwitch().click());

		expect(invoke).toHaveBeenCalledWith(
			initiallyEnabled ? "pause_routine_schedule" : "resume_routine_schedule",
			{ schedule_id: schedule.scheduleId },
		);
		expect(
			invoke.mock.calls.some(
				([command]) => command === "update_routine_schedule",
			),
		).toBe(false);
		expect(detailEnabledSwitch().checked).toBe(!initiallyEnabled);
		expect(field("schedule-name").value).toBe("My unsaved title");
		expect(field("schedule-prompt").value).toBe("My unsaved instructions");
		await act(async () => button("Runs").click());
		expect(detailEnabledSwitch().closest("[hidden]")).toBeNull();
		expect(detailEnabledSwitch().checked).toBe(!initiallyEnabled);

		await act(async () => button("Save").click());

		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				schedule_id: schedule.scheduleId,
				name: "My unsaved title",
				prompt: "My unsaved instructions",
				enabled: !initiallyEnabled,
			}),
		);
	});

	it("keeps the draft editable while changing enabled state and saves once the change lands", async () => {
		const pendingPause = Promise.withResolvers<void>();
		let enabled = true;
		invoke.mockImplementation(async (command: string) => {
			if (command === "pause_routine_schedule") {
				await pendingPause.promise;
				enabled = false;
				return { schedule: { ...schedule, enabled } };
			}
			if (command === "list_routine_schedules")
				return { ...overview(), schedules: [{ ...schedule, enabled }] };
			return defaultInvoke(command);
		});
		const updates = () =>
			invoke.mock.calls.filter(
				([command]) => command === "update_routine_schedule",
			);
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => detailEnabledSwitch().click());

		// Only the switch waits; the rest of the editor stays usable.
		expect(detailEnabledSwitch().disabled).toBe(true);
		expect(detailEnabledSwitch().getAttribute("aria-busy")).toBe("true");
		for (const label of [
			"Save",
			"Run now",
			"Delete Daily PR summary",
			"Back to Schedule",
		])
			expect(button(label).disabled).toBe(false);
		expect(field("schedule-name").disabled).toBe(false);
		await act(async () => {
			detailEnabledSwitch().click();
			button("Save").click();
		});
		expect(
			invoke.mock.calls.filter(
				([command]) => command === "pause_routine_schedule",
			),
		).toHaveLength(1);
		// Saving reads the persisted switch, so it waits for the pause to land.
		expect(updates()).toHaveLength(0);

		await act(async () => pendingPause.resolve());
		expect(detailEnabledSwitch().disabled).toBe(false);
		expect(detailEnabledSwitch().checked).toBe(false);
		expect(updates()).toHaveLength(1);
		expect(updates()[0]?.[1]).toEqual(
			expect.objectContaining({ enabled: false }),
		);
		expect(button("Saved").disabled).toBe(false);
	});

	it("runs a resumed schedule without resaving unchanged settings", async () => {
		let enabled = false;
		invoke.mockImplementation(async (command: string) => {
			if (command === "resume_routine_schedule") {
				enabled = true;
				return { schedule: { ...schedule, enabled } };
			}
			if (command === "list_routine_schedules")
				return { ...overview(), schedules: [{ ...schedule, enabled }] };
			if (command === "trigger_routine_schedule")
				return { execution: { executionId: "execution-new" } };
			return defaultInvoke(command);
		});
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => detailEnabledSwitch().click());
		await act(async () => runButton().click());

		expect(invoke).toHaveBeenCalledWith("trigger_routine_schedule", {
			schedule_id: schedule.scheduleId,
		});
		expect(
			invoke.mock.calls.some(
				([command]) => command === "update_routine_schedule",
			),
		).toBe(false);
	});

	it("retains the enabled state and unsaved instructions after a failed toggle", async () => {
		invoke.mockImplementation((command: string) =>
			command === "pause_routine_schedule"
				? Promise.reject(new Error("Could not pause schedule"))
				: defaultInvoke(command),
		);
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		await changeField("schedule-prompt", "Keep this draft after failure");
		await act(async () => detailEnabledSwitch().click());

		expect(detailEnabledSwitch().checked).toBe(true);
		expect(detailEnabledSwitch().disabled).toBe(false);
		expect(field("schedule-prompt").value).toBe(
			"Keep this draft after failure",
		);
		expect(container.querySelector("form")?.textContent).toContain(
			"Could not pause schedule",
		);

		await act(async () => button("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				prompt: "Keep this draft after failure",
				enabled: true,
			}),
		);
	});

	it("refreshes enabled state without replacing the unsaved instructions", async () => {
		let enabled = true;
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_routine_schedules")
				return { ...overview(), schedules: [{ ...schedule, enabled }] };
			return defaultInvoke(command);
		});
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		await changeField("schedule-prompt", "Keep my in-progress instructions");

		enabled = false;
		await act(async () => vi.advanceTimersByTimeAsync(15_000));

		expect(detailEnabledSwitch().checked).toBe(false);
		expect(field("schedule-prompt").value).toBe(
			"Keep my in-progress instructions",
		);
		await act(async () => button("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				prompt: "Keep my in-progress instructions",
				enabled: false,
			}),
		);
	});

	it("does not offer pause or resume before a new schedule is saved", async () => {
		await mount();
		await act(async () => button("New schedule").click());
		expect(container.querySelector('form input[role="switch"]')).toBeNull();
	});
});

describe("schedule detail navigation", () => {
	it("locks an already-open frequency menu while starting a run", async () => {
		const pendingRun = Promise.withResolvers<unknown>();
		invoke.mockImplementation(async (command: string) =>
			command === "trigger_routine_schedule"
				? pendingRun.promise
				: defaultInvoke(command),
		);
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		const run = runButton();
		const frequency = container.querySelector<HTMLButtonElement>(
			"#schedule-frequency",
		);
		if (!frequency) throw new Error("Frequency control is missing");
		await act(async () => frequency.click());
		const weekly = Array.from(
			document.querySelectorAll<HTMLElement>('[role="option"]'),
		).find((option) => option.textContent === "Every week");
		if (!weekly) throw new Error("Weekly frequency option is missing");
		await act(async () => run.click());
		expect(weekly.getAttribute("aria-disabled")).toBe("true");
		await act(async () => weekly.click());
		expect(frequency.textContent).toContain("Every day");
		await act(async () => pendingRun.resolve({}));
	});

	it.each([
		false,
		true,
	])("saves the selected model before Run now (switch provider: %s)", async (switchProvider) => {
		vi.mocked(loadProviderModelCatalog).mockResolvedValue({
			voiceInput: null,
			providers: [],
			enabledProviderIds: ["cline", "anthropic"],
			providerModels: {
				cline: ["old-model", "new-model"],
				anthropic: ["sonnet", "opus"],
			},
			providerReasoningModels: {},
			providerNames: { cline: "Cline", anthropic: "Anthropic" },
			providerModelDetails: {},
		});
		const pendingSave = Promise.withResolvers<void>();
		let storedSchedule = {
			...schedule,
			modelSelection: { providerId: "cline", modelId: "old-model" },
		};
		const runSelections: (typeof storedSchedule.modelSelection)[] = [];
		invoke.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "list_routine_schedules")
					return { ...overview(), schedules: [storedSchedule] };
				if (command === "update_routine_schedule") {
					await pendingSave.promise;
					storedSchedule = {
						...storedSchedule,
						modelSelection: {
							providerId: String(args?.provider),
							modelId: String(args?.model),
						},
					};
					return { schedule: storedSchedule };
				}
				if (command === "trigger_routine_schedule") {
					runSelections.push(storedSchedule.modelSelection);
					return {
						execution: {
							executionId: "manual-run",
							sessionId: "manual-session",
						},
					};
				}
				return defaultInvoke(command);
			},
		);
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		if (switchProvider) {
			await act(async () => button("Provider: Cline").click());
			await act(async () => button("Anthropic").click());
		}
		await act(async () =>
			button(`Model: ${switchProvider ? "sonnet" : "old-model"}`).click(),
		);
		await act(async () =>
			button(switchProvider ? "opus" : "new-model").click(),
		);
		await scrollEditorHeader();
		await act(async () => {
			const run = runButton();
			run.click();
			run.click();
		});
		const expectedSelection = {
			providerId: switchProvider ? "anthropic" : "cline",
			modelId: switchProvider ? "opus" : "new-model",
		};
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				provider: expectedSelection.providerId,
				model: expectedSelection.modelId,
			}),
		);
		expect(runSelections).toEqual([]);
		expect(runButton().disabled).toBe(true);
		for (const label of [
			"Saving…",
			"Back to Schedule",
			"Delete Daily PR summary",
		])
			expect(button(label).disabled).toBe(true);
		expect(button(`Model: ${expectedSelection.modelId}`).disabled).toBe(true);
		await act(async () => pendingSave.resolve());
		expect(runSelections).toEqual([expectedSelection]);
		expect(button("Runs").getAttribute("aria-checked")).toBe("true");
		expect(
			container.querySelector('form[aria-label="Edit schedule"]'),
		).not.toBeNull();
		// Retrying an unchanged draft should not rewrite the schedule again.
		await act(async () => runButton().click());
		expect(
			invoke.mock.calls.filter(
				([command]) => command === "update_routine_schedule",
			),
		).toHaveLength(1);
		expect(runSelections).toEqual([expectedSelection, expectedSelection]);
	});

	it("keeps the draft and does not run the old settings when saving before Run now fails", async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "update_routine_schedule")
				throw new Error("Could not save schedule");
			return defaultInvoke(command);
		});
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		await changeField("schedule-prompt", "Use the new instructions");
		await act(async () => runButton().click());
		expect(
			invoke.mock.calls.some(
				([command]) => command === "trigger_routine_schedule",
			),
		).toBe(false);
		expect(container.querySelector("form")?.textContent).toContain(
			"Could not save schedule",
		);
		expect(field("schedule-prompt").value).toBe("Use the new instructions");
		expect(button("Settings").getAttribute("aria-checked")).toBe("true");
		expect(runButton().disabled).toBe(false);
	});

	it("validates edits before Run now instead of running the saved settings", async () => {
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		await changeField("schedule-prompt", "");
		await act(async () => runButton().click());
		expect(
			invoke.mock.calls.some(
				([command]) =>
					command === "trigger_routine_schedule" ||
					command === "update_routine_schedule",
			),
		).toBe(false);
		expect(container.querySelector("form")?.textContent).toContain(
			"Add instructions for this schedule.",
		);
		expect(button("Settings").getAttribute("aria-checked")).toBe("true");
	});

	it("runs an unchanged one-time schedule without resaving its past trigger", async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_routine_schedules")
				return {
					...overview(),
					schedules: [
						{
							...schedule,
							cronPattern: ONE_TIME_SCHEDULE_CRON_PATTERN,
							metadata: {
								[ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY]:
									Date.now() - 86_400_000,
							},
						},
					],
				};
			if (command === "trigger_routine_schedule")
				return {
					execution: { executionId: "manual-run", sessionId: "manual-session" },
				};
			return defaultInvoke(command);
		});
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => runButton().click());
		expect(invoke).toHaveBeenCalledWith("trigger_routine_schedule", {
			schedule_id: schedule.scheduleId,
		});
		expect(
			invoke.mock.calls.some(
				([command]) => command === "update_routine_schedule",
			),
		).toBe(false);
	});

	it.each([
		false,
		true,
	])("keeps one Save action bound to the current draft across scrolling (new: %s)", async (isNew) => {
		let storedSchedule = schedule;
		invoke.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (
					command === "create_routine_schedule" ||
					command === "update_routine_schedule"
				) {
					storedSchedule = {
						...storedSchedule,
						scheduleId: isNew ? "created-schedule" : schedule.scheduleId,
						name: String(args?.name),
						prompt: String(args?.prompt),
						cronPattern: String(args?.cron_pattern),
					};
					return { schedule: storedSchedule };
				}
				if (command === "list_routine_schedules")
					return { ...overview(), schedules: [storedSchedule] };
				return defaultInvoke(command);
			},
		);
		await mount();
		if (isNew) {
			const template = SCHEDULE_TEMPLATES.find(
				(item) => item.id === "security-scan",
			);
			if (!template) throw new Error("Security scan suggestion is missing");
			await act(async () => button(template.title).click());
		} else {
			await act(async () => button("Open Daily PR summary").click());
			await act(async () => button("Settings").click());
		}
		await changeField("schedule-prompt", "Use these unsaved instructions");
		const saveButton = button("Save");
		const headerActions = saveButton.closest(
			'[data-item-header-actions="inline"]',
		);
		expect(headerActions).not.toBeNull();
		await scrollEditorHeader();
		expect(button("Save")).toBe(saveButton);
		expect(
			container.querySelectorAll("[data-item-header-actions]"),
		).toHaveLength(1);
		expect(headerActions?.querySelectorAll("button")).toHaveLength(
			isNew ? 1 : 2,
		);
		expect(saveButton.form).toBe(container.querySelector("form"));
		const form = saveButton.form;
		await act(async () => saveButton.click());
		expect(invoke).toHaveBeenCalledWith(
			isNew ? "create_routine_schedule" : "update_routine_schedule",
			expect.objectContaining({ prompt: "Use these unsaved instructions" }),
		);
		expect(container.querySelector("form")).toBe(form);
		expect(button("Saved")).toBe(saveButton);
		expect(button("Saved").querySelector("svg")).not.toBeNull();
		await act(async () => vi.advanceTimersByTimeAsync(2_000));
		await act(async () => button("Saved").click());
		await act(async () => vi.advanceTimersByTimeAsync(2_999));
		expect(button("Saved")).toBe(saveButton);
		await act(async () => vi.advanceTimersByTimeAsync(1));
		expect(button("Save")).toBe(saveButton);

		await changeField("schedule-prompt", "Update the saved schedule");
		await act(async () => button("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				schedule_id: storedSchedule.scheduleId,
				prompt: "Update the saved schedule",
			}),
		);
		expect(
			invoke.mock.calls.filter(
				([command]) => command === "create_routine_schedule",
			),
		).toHaveLength(isNew ? 1 : 0);
		expect(button("Saved")).toBe(saveButton);
		await changeField("schedule-prompt", "Another unsaved edit");
		expect(button("Save")).toBe(saveButton);
	});

	it("explains unattended execution while Advanced is collapsed and saves a changed mode", async () => {
		HTMLElement.prototype.scrollIntoView ??= () => {};
		await mount();
		await act(async () => button("New schedule").click());
		await changeField("schedule-name", "Plan a review");
		await changeField("schedule-date", "2099-01-01");
		const note = Array.from(container.querySelectorAll("p")).find(
			(element) =>
				element.textContent ===
				"Scheduled tasks run without approval prompts. Enabled tools may edit files and run commands.",
		);
		expect(note).toBeDefined();
		expect(note?.closest("[hidden]")).toBeNull();
		expect(button("Advanced").getAttribute("aria-expanded")).toBe("false");
		const mode = container.querySelector<HTMLFieldSetElement>("#schedule-mode");
		expect(mode?.closest("[hidden]")).not.toBeNull();
		await act(async () => button("Advanced").click());
		expect(mode?.closest("[hidden]")).toBeNull();
		expect(
			mode?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
				?.value,
		).toBe("yolo");
		expect(mode?.getAttribute("aria-labelledby")).toBe("schedule-mode-label");
		expect(mode?.getAttribute("aria-describedby")).toBe(
			"schedule-mode-description",
		);
		const options = Array.from(
			mode?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [],
		);
		expect(options.map((option) => option.labels?.[0]?.textContent)).toEqual([
			"Act",
			"Plan",
			"YOLO",
		]);
		await act(async () =>
			options.find((option) => option.value === "plan")?.click(),
		);
		expect(
			mode?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
				?.value,
		).toBe("plan");
		await act(async () => button("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"create_routine_schedule",
			expect.objectContaining({
				name: "Plan a review",
				mode: "plan",
			}),
		);
	});

	it("cancels deletion beside Enable, then confirms and returns to the list", async () => {
		let deleted = false;
		invoke.mockImplementation(async (command: string) => {
			if (command === "delete_routine_schedule") {
				deleted = true;
				return;
			}
			if (command === "list_routine_schedules")
				return { ...overview(), schedules: deleted ? [] : [schedule] };
			return defaultInvoke(command);
		});
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		const deleteButton = button("Delete Daily PR summary");
		expect(deleteButton.closest("[data-item-header-actions]")).toBeNull();
		expect(
			deleteButton.parentElement?.parentElement?.querySelector(
				'[role="switch"][aria-label="Enable Daily PR summary"]',
			),
		).not.toBeNull();
		await act(async () => button("Delete Daily PR summary").click());
		expect(
			document.querySelector('[role="alertdialog"]')?.textContent,
		).toContain('This will delete "Daily PR summary"');
		await act(async () => confirmationButton("Cancel").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(
			container.querySelector('form[aria-label="Edit schedule"]'),
		).not.toBeNull();
		expect(deleted).toBe(false);

		await act(async () => button("Delete Daily PR summary").click());
		await act(async () => confirmationButton("Delete").click());
		expect(invoke).toHaveBeenCalledWith("delete_routine_schedule", {
			schedule_id: schedule.scheduleId,
		});
		expect(container.querySelector("form")).toBeNull();
		expect(container.textContent).toContain("No schedules yet");
		expect(document.activeElement).toBe(button("New schedule"));
	});

	it("keeps the editor and exposes the error when deletion fails", async () => {
		invoke.mockImplementation((command: string) =>
			command === "delete_routine_schedule"
				? Promise.reject(new Error("Could not delete schedule"))
				: defaultInvoke(command),
		);
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Delete Daily PR summary").click());
		await act(async () => confirmationButton("Delete").click());
		const form = container.querySelector('form[aria-label="Edit schedule"]');
		expect(form?.textContent).toContain("Could not delete schedule");
		expect(form?.closest("[hidden]")).toBeNull();
		expect(button("Delete Daily PR summary").disabled).toBe(false);
		expect(button("Back to Schedule").disabled).toBe(false);
	});

	it("disables editor actions while a run starts and displays a start failure", async () => {
		const pendingRun = Promise.withResolvers<void>();
		invoke.mockImplementation((command: string) =>
			command === "trigger_routine_schedule"
				? pendingRun.promise
				: defaultInvoke(command),
		);
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		await scrollEditorHeader();
		expect(
			runButton().closest('[data-item-header-actions="inline"]'),
		).not.toBeNull();
		await act(async () => runButton().click());
		expect(runButton().disabled).toBe(true);
		for (const label of ["Delete Daily PR summary", "Save", "Back to Schedule"])
			expect(button(label).disabled).toBe(true);
		expect(runButton().getAttribute("aria-busy")).toBe("true");
		await act(async () =>
			pendingRun.reject(new Error("Could not start schedule")),
		);
		expect(
			container.querySelector('form[aria-label="Edit schedule"]')?.textContent,
		).toContain("Could not start schedule");
		expect(button("Settings").getAttribute("aria-checked")).toBe("true");
		expect(runButton().disabled).toBe(false);
	});

	it.each([
		{ history: "no runs", initialSection: "Settings" },
		{ history: "another schedule's runs", initialSection: "Settings" },
		{ history: "completed runs", initialSection: "Runs" },
		{ history: "active runs", initialSection: "Runs" },
	])("opens $initialSection for $history and restores that default on reopening", async ({
		history,
		initialSection,
	}) => {
		const execution = {
			...overview("success").lastExecutions[0],
			scheduleId:
				history === "another schedule's runs"
					? "another-schedule"
					: schedule.scheduleId,
		};
		invoke.mockResolvedValue({
			...overview(),
			lastExecutions:
				history === "no runs" || history === "active runs" ? [] : [execution],
			activeExecutions:
				history === "active runs" ? [{ ...execution, status: "running" }] : [],
		});
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		const expectSectionVisible = (section: string) => {
			const isSettings = section === "Settings";
			expect(button("Settings").getAttribute("aria-checked")).toBe(
				String(isSettings),
			);
			expect(button("Runs").getAttribute("aria-checked")).toBe(
				String(!isSettings),
			);
			expect(
				container.querySelector<HTMLElement>("#schedule-settings")?.hidden,
			).toBe(!isSettings);
			expect(
				container.querySelector<HTMLElement>("#schedule-runs")?.hidden,
			).toBe(isSettings);
		};
		expectSectionVisible(initialSection);
		const chosenSection = initialSection === "Runs" ? "Settings" : "Runs";
		await act(async () => button(chosenSection).click());
		await act(async () => vi.advanceTimersByTimeAsync(15_000));
		expectSectionVisible(chosenSection);
		await act(async () => button("Back to Schedule").click());
		await act(async () => button("Open Daily PR summary").click());
		expectSectionVisible(initialSection);
	});

	it("opens a dedicated new schedule page and restores list focus and scroll on Back", async () => {
		await mount();
		const trigger = button("New schedule");
		const viewport = container.querySelector<HTMLElement>(
			"[data-radix-scroll-area-viewport]",
		);
		if (!viewport) throw new Error("Schedule list viewport is missing");
		viewport.scrollTop = 360;
		trigger.focus();
		await act(async () => trigger.click());

		expect(
			container.querySelector('form[aria-label="New schedule"]'),
		).not.toBeNull();
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		expect(field("schedule-workspace").value).toBe("/workspace/project");
		// A new schedule starts on its name, which also reveals the description.
		expect(document.activeElement).toBe(field("schedule-name"));
		expect(field("schedule-name").getAttribute("placeholder")).toBe(
			"Schedule name",
		);
		expect(container.querySelector("#schedule-description")).not.toBeNull();
		expect(trigger.closest("[hidden]")).not.toBeNull();
		viewport.scrollTop = 0;
		await act(async () => button("Back to Schedule").click());

		expect(container.querySelector("form")).toBeNull();
		expect(trigger.closest("[hidden]")).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(viewport.scrollTop).toBe(360);
		expect(button("Open Daily PR summary")).toBeDefined();
	});

	it("shows an empty description only while editing the schedule header", async () => {
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		expect(container.querySelector("#schedule-description")).toBeNull();

		await act(async () => field("schedule-name").focus());
		expect(descriptionField().placeholder).toBe("Description");
		// The header actions occur between the name and description in tab order.
		await act(async () => button("Save").focus());
		expect(descriptionField().value).toBe("");
		await act(async () => descriptionField().focus());
		expect(document.activeElement).toBe(descriptionField());

		await changeDescription("Keep this summary visible");
		await act(async () => field("schedule-prompt").focus());
		expect(descriptionField().value).toBe("Keep this summary visible");

		await act(async () => descriptionField().focus());
		await changeField("schedule-description", "   ");
		expect(document.activeElement).toBe(descriptionField());
		await act(async () => field("schedule-prompt").focus());
		expect(container.querySelector("#schedule-description")).toBeNull();

		await act(async () => field("schedule-name").focus());
		expect(descriptionField().value).toBe("   ");
		await act(async () => field("schedule-name").blur());
		expect(container.querySelector("#schedule-description")).toBeNull();
	});

	it("prefills an editable suggestion without sections or runs before it is saved", async () => {
		await mount();
		const template = SCHEDULE_TEMPLATES.find(
			(item) => item.id === "security-scan",
		);
		if (!template) throw new Error("Security scan suggestion is missing");
		await act(async () => button(template.title).click());
		expect(field("schedule-name").value).toBe(template.name);
		expect(descriptionField().value).toBe(template.description);
		expect(field("schedule-prompt").value).toBe(template.prompt);
		expect(field("schedule-time").value).toBe("08:00");
		expect(
			container.querySelector('[aria-label="Schedule sections"]'),
		).toBeNull();
		expect(container.querySelector("#schedule-runs")).toBeNull();
		expect(
			Array.from(container.querySelectorAll("button")).filter(
				(element) =>
					element.textContent === "Settings" || element.textContent === "Runs",
			),
		).toHaveLength(0);
		expect(field("schedule-prompt").closest("[hidden]")).toBeNull();
		await changeField("schedule-name", "My security review");
		await changeDescription(
			"Review authentication changes and summarize risks.",
		);
		await changeField("schedule-prompt", "Review only authentication changes.");
		await changeField("schedule-workspace", "/workspace/another-project");
		expect(field("schedule-name").value).toBe("My security review");
		expect(descriptionField().value).toBe(
			"Review authentication changes and summarize risks.",
		);
		expect(field("schedule-prompt").value).toBe(
			"Review only authentication changes.",
		);
		expect(field("schedule-workspace").value).toBe(
			"/workspace/another-project",
		);
		expect(field("schedule-time").value).toBe("08:00");
		expect(
			invoke.mock.calls.some(
				([command]) => command === "create_routine_schedule",
			),
		).toBe(false);
	});

	it("reopens a saved description and can edit and clear it", async () => {
		let storedDescription = "Existing description";
		invoke.mockImplementation(
			async (command: string, args?: { description?: string }) => {
				if (command === "update_routine_schedule") {
					storedDescription = args?.description ?? storedDescription;
					return;
				}
				if (command === "list_routine_schedules")
					return {
						...overview(),
						schedules: [
							{
								...schedule,
								metadata: storedDescription
									? { description: storedDescription }
									: {},
							},
						],
					};
				return defaultInvoke(command);
			},
		);
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		expect(descriptionField().value).toBe("Existing description");
		await changeDescription("  Updated description\nWith more context  ");
		await act(async () => button("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				description: "Updated description\nWith more context",
			}),
		);
		await act(async () => button("Back to Schedule").click());
		await act(async () => button("Open Daily PR summary").click());
		expect(descriptionField().value).toBe(
			"Updated description\nWith more context",
		);
		await changeDescription("   ");
		await act(async () => button("Save").click());
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({ description: "" }),
		);
		await act(async () => button("Back to Schedule").click());
		await act(async () => button("Open Daily PR summary").click());
		expect(container.querySelector("#schedule-description")).toBeNull();
		await act(async () => field("schedule-name").focus());
		expect(descriptionField().value).toBe("");
		expect(descriptionField().disabled).toBe(false);
	});

	it("keeps the detail page after retry and restores the list only when going back", async () => {
		let saveAttempts = 0;
		let saved = false;
		invoke.mockImplementation(async (command: string) => {
			if (command === "update_routine_schedule") {
				saveAttempts += 1;
				if (saveAttempts === 1) throw new Error("Schedule service unavailable");
				saved = true;
				return;
			}
			if (command === "list_routine_schedules")
				return {
					...overview(),
					schedules: [
						{
							...schedule,
							prompt: saved ? "Updated review instructions" : schedule.prompt,
						},
					],
				};
			return defaultInvoke(command);
		});
		await mount();
		const trigger = button("Open Daily PR summary");
		const viewport = container.querySelector<HTMLElement>(
			"[data-radix-scroll-area-viewport]",
		);
		if (!viewport) throw new Error("Schedule list viewport is missing");
		viewport.scrollTop = 280;
		await act(async () => trigger.click());
		await act(async () => button("Settings").click());
		await changeField("schedule-prompt", "Updated review instructions");
		expect(container.querySelector("#schedule-description")).toBeNull();
		await changeDescription("Updated summary of this schedule");
		await act(async () => button("Runs").click());
		expect(container.querySelector<HTMLElement>("#schedule-runs")?.hidden).toBe(
			false,
		);
		expect(field("schedule-prompt").closest("[hidden]")).not.toBeNull();
		expect(descriptionField().value).toBe("Updated summary of this schedule");
		await act(async () => button("Settings").click());
		expect(field("schedule-prompt").value).toBe("Updated review instructions");
		expect(field("schedule-prompt").closest("[hidden]")).toBeNull();
		await act(async () => button("Save").click());

		const form = container.querySelector('form[aria-label="Edit schedule"]');
		expect(form).not.toBeNull();
		expect(form?.textContent).toContain("Schedule service unavailable");
		expect(descriptionField().value).toBe("Updated summary of this schedule");
		expect(field("schedule-prompt").value).toBe("Updated review instructions");
		expect(trigger.isConnected).toBe(true);
		expect(trigger.closest("[hidden]")).not.toBeNull();
		expect(button("Save").disabled).toBe(false);

		await act(async () => button("Save").click());
		expect(saveAttempts).toBe(2);
		expect(invoke).toHaveBeenCalledWith(
			"update_routine_schedule",
			expect.objectContaining({
				schedule_id: schedule.scheduleId,
				prompt: "Updated review instructions",
				description: "Updated summary of this schedule",
				cron_pattern: schedule.cronPattern,
				workspace_root: schedule.workspaceRoot,
			}),
		);
		expect(container.querySelector("form")).toBe(form);
		expect(button("Saved").disabled).toBe(false);
		expect(trigger.closest("[hidden]")).not.toBeNull();
		expect(container.textContent).toContain("Updated review instructions");
		expect(container.textContent).not.toContain("Schedule service unavailable");
		await act(async () => button("Back to Schedule").click());
		expect(container.querySelector("form")).toBeNull();
		expect(trigger.closest("[hidden]")).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(viewport.scrollTop).toBe(280);
	});
});

describe("schedule editor safeguards", () => {
	async function openNewSchedule() {
		await mount();
		await act(async () => button("New schedule").click());
		await act(async () => vi.advanceTimersByTimeAsync(0));
	}

	function calls(command: string) {
		return invoke.mock.calls.filter(([name]) => name === command);
	}

	it("keeps a typed date and time as entered instead of snapping to the minimum", async () => {
		await openNewSchedule();
		// Typing a year or an hour passes through values before the minimum.
		await changeField("schedule-date", "2020-01-05");
		expect(field("schedule-date").value).toBe("2020-01-05");
		await changeField("schedule-time", "00:07");
		expect(field("schedule-time").value).toBe("00:07");
		expect(field("schedule-date").getAttribute("min")).not.toBeNull();
	});

	it("flags and focuses the field a validation message is about, until it is edited", async () => {
		await openNewSchedule();
		await act(async () => button("Save").click());
		expect(container.querySelector("form")?.textContent).toContain(
			"Schedule name is required.",
		);
		expect(field("schedule-name").getAttribute("aria-invalid")).toBe("true");
		expect(document.activeElement).toBe(field("schedule-name"));

		await changeField("schedule-name", "Past run");
		expect(field("schedule-name").getAttribute("aria-invalid")).toBeNull();
		expect(container.querySelector("form")?.textContent).not.toContain(
			"Schedule name is required.",
		);
		await changeField("schedule-date", "2020-01-05");
		await act(async () => button("Save").click());
		expect(container.querySelector("form")?.textContent).toContain(
			"Choose a one-time date and time in the future.",
		);
		for (const id of ["schedule-date", "schedule-time"])
			expect(field(id).getAttribute("aria-invalid")).toBe("true");
		expect(document.activeElement).toBe(field("schedule-date"));
		expect(calls("create_routine_schedule")).toHaveLength(0);
	});

	it("reports an invalid timeout instead of dropping it, opening Advanced to show the field", async () => {
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		const advanced = container.querySelector<HTMLElement>(
			"#schedule-advanced-options",
		);
		expect(advanced?.hidden).toBe(true);
		await changeField("schedule-timeout", "ten minutes");
		await act(async () => button("Save").click());
		expect(container.querySelector("form")?.textContent).toContain(
			"Enter the timeout as a whole number of seconds, or leave it blank.",
		);
		expect(advanced?.hidden).toBe(false);
		expect(field("schedule-timeout").getAttribute("aria-invalid")).toBe("true");
		expect(document.activeElement).toBe(field("schedule-timeout"));
		expect(calls("update_routine_schedule")).toHaveLength(0);

		await changeField("schedule-timeout", "600");
		await act(async () => button("Save").click());
		expect(calls("update_routine_schedule")[0]?.[1]).toEqual(
			expect.objectContaining({ timeout_seconds: 600 }),
		);
	});

	it("returns from Runs to Settings when the message is about a field there", async () => {
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await changeField("schedule-name", "");
		await act(async () => button("Runs").click());
		await act(async () => button("Save").click());
		expect(
			container.querySelector<HTMLElement>("#schedule-settings")?.hidden,
		).toBe(false);
		expect(document.activeElement).toBe(field("schedule-name"));
	});

	it("asks before Back discards unsaved changes", async () => {
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await changeField("schedule-name", "Renamed");
		await act(async () => button("Back to Schedule").click());
		expect(
			document.querySelector('[role="alertdialog"]')?.textContent,
		).toContain("Discard unsaved changes?");
		expect(container.querySelector("form")).not.toBeNull();

		await act(async () => confirmationButton("Keep editing").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(field("schedule-name").value).toBe("Renamed");

		await act(async () => button("Back to Schedule").click());
		await act(async () => confirmationButton("Discard").click());
		expect(container.querySelector("form")).toBeNull();
		await act(async () => button("Open Daily PR summary").click());
		expect(field("schedule-name").value).toBe("Daily PR summary");
	});

	it("asks before opening a run session discards unsaved instructions", async () => {
		const onOpenSession = vi.fn();
		const triggeredAt = Date.now();
		invoke.mockResolvedValue({
			...overview("success"),
			lastExecutions: [
				{
					...overview("success").lastExecutions[0],
					triggeredAt,
					sessionId: "completed-session",
				},
			],
		});
		await mount(onOpenSession);
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		await changeField("schedule-prompt", "Keep these unsaved instructions");
		await act(async () => button("Runs").click());
		const openRun = button(
			`Open session triggered ${new Date(triggeredAt).toLocaleString()}`,
		);
		await act(async () => openRun.click());
		expect(onOpenSession).not.toHaveBeenCalled();
		await act(async () => confirmationButton("Keep editing").click());
		expect(onOpenSession).not.toHaveBeenCalled();
		expect(field("schedule-prompt").value).toBe(
			"Keep these unsaved instructions",
		);

		await act(async () => openRun.click());
		await act(async () => confirmationButton("Discard").click());
		expect(onOpenSession).toHaveBeenCalledExactlyOnceWith("completed-session");
		expect(calls("update_routine_schedule")).toHaveLength(0);
	});

	it("goes back without asking when nothing was changed, including defaults that load late", async () => {
		const context = Promise.withResolvers<unknown>();
		invoke.mockImplementation((command: string) =>
			command === "get_process_context"
				? context.promise
				: defaultInvoke(command),
		);
		await mount();
		await act(async () => button("New schedule").click());
		await act(async () =>
			context.resolve({ workspaceRoot: "/workspace/late", cwd: "/tmp" }),
		);
		expect(field("schedule-workspace").value).toBe("/workspace/late");
		await act(async () => button("Back to Schedule").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(container.querySelector("form")).toBeNull();
	});

	it("keeps a background refresh failure out of the editor and away from focus", async () => {
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		await act(async () => field("schedule-prompt").focus());
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_routine_schedules")
				throw new Error("Hub unreachable");
			return defaultInvoke(command);
		});
		await act(async () => vi.advanceTimersByTimeAsync(15_000));
		expect(container.textContent).toContain("Hub unreachable");
		expect(container.querySelector("form")?.textContent).not.toContain(
			"Hub unreachable",
		);
		expect(document.activeElement).toBe(field("schedule-prompt"));
		await act(async () => vi.advanceTimersByTimeAsync(15_000));
		expect(document.activeElement).toBe(field("schedule-prompt"));
	});

	it("keeps reporting an unreachable hub while the next poll is in flight", async () => {
		invoke.mockResolvedValueOnce({ ...overview(), schedules: [] });
		await mount();
		expect(container.textContent).toContain("No schedules yet");
		invoke.mockRejectedValueOnce(new Error("Hub unreachable"));
		await act(async () => vi.advanceTimersByTimeAsync(15_000));
		expect(container.textContent).toContain("Schedules unavailable");
		const slow = Promise.withResolvers<ReturnType<typeof overview>>();
		invoke.mockReturnValueOnce(slow.promise);
		await act(async () => vi.advanceTimersByTimeAsync(15_000));
		expect(container.textContent).toContain("Schedules unavailable");
		expect(container.textContent).toContain("Hub unreachable");
		expect(container.textContent).not.toContain("No schedules yet");
		await act(async () => slow.resolve(overview()));
		expect(container.textContent).not.toContain("Hub unreachable");
		expect(button("Open Daily PR summary")).toBeDefined();
	});

	it("says when Run will save first and frees the editor once the run is queued", async () => {
		const onOpenSession = vi.fn();
		invoke.mockImplementation(async (command: string) =>
			command === "trigger_routine_schedule"
				? { execution: { executionId: "queued-run" } }
				: defaultInvoke(command),
		);
		await mount(onOpenSession);
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		expect(runButton().textContent).toBe("Run now");
		expect(runButton().getAttribute("aria-label")).toBeNull();
		await changeField("schedule-prompt", "New instructions");
		expect(runButton().textContent).toBe("Save and run");

		await act(async () => runButton().click());
		expect(calls("update_routine_schedule")).toHaveLength(1);
		expect(calls("trigger_routine_schedule")).toHaveLength(1);
		// Runs opens as soon as the run is queued, before its session appears.
		expect(button("Runs").getAttribute("aria-checked")).toBe("true");
		expect(runButton().textContent).toBe("Run now");
		for (const control of [
			runButton(),
			button("Saved"),
			button("Back to Schedule"),
			field("schedule-name"),
		])
			expect(control.disabled).toBe(false);
		expect(onOpenSession).not.toHaveBeenCalled();
	});
});

describe("schedule list details", () => {
	function row(name: string) {
		return button(`Open ${name}`).closest('[data-slot="detail-list-item"]');
	}

	function column(name: string, key: string) {
		return row(name)?.querySelector(
			`[data-column="${key}"] .cline-ui-detail-list-item__value-content`,
		)?.textContent;
	}

	it("shows when each schedule runs and prefers its description over the prompt", async () => {
		invoke.mockResolvedValue({
			...overview(),
			schedules: [
				{
					...schedule,
					nextRunAt: Date.now() + 60_000,
					metadata: { description: "Morning digest of open PRs" },
				},
				{
					...schedule,
					scheduleId: "schedule-2",
					name: "Weekly cleanup",
					cronPattern: "30 14 * * MON,THU",
					enabled: false,
					nextRunAt: Date.now() + 60_000,
				},
			],
		});
		await mount();
		expect(column("Daily PR summary", "frequency")).toBe("Daily");
		expect(column("Daily PR summary", "nextRun")).toMatch(
			/^(Today|Tomorrow), \d{1,2}:\d{2}/,
		);
		expect(row("Daily PR summary")?.textContent).toContain(
			"Morning digest of open PRs",
		);
		expect(row("Daily PR summary")?.textContent).not.toContain(schedule.prompt);
		expect(column("Weekly cleanup", "frequency")).toBe("Weekly");
		expect(column("Weekly cleanup", "nextRun")).toBe("—");
		expect(row("Weekly cleanup")?.textContent).toContain(schedule.prompt);
	});

	it("shows the saved next run in the editor until the timing is edited", async () => {
		invoke.mockResolvedValue({
			...overview(),
			schedules: [{ ...schedule, nextRunAt: Date.now() + 60_000 }],
		});
		await mount();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Settings").click());
		const form = () => container.querySelector("form")?.textContent ?? "";
		expect(form()).toMatch(/Next run: (Today|Tomorrow), /);
		await changeField("schedule-prompt", "Edits elsewhere keep the time");
		expect(form()).toContain("Next run: ");
		await changeField("schedule-time", "17:45");
		expect(form()).not.toContain("Next run: ");
	});
});

describe("schedule editor in app history", () => {
	const history = { back: () => {}, forward: () => {} };

	/** The app shell's wiring: details live in its Back/Forward history. */
	function HostedSchedulePage() {
		const [state, dispatch] = useReducer(
			desktopAppReducer<"General">,
			undefined,
			() => {
				const initial = createDesktopAppState("draft", "General", "local");
				return desktopAppReducer(initial, {
					type: "navigate",
					destination: { ...initial.navigation.current, view: "schedules" },
				});
			},
		);
		const { registry, confirmLeave } = useUnsavedChangesRegistry();
		const current = state.navigation.current;
		const host = useMemo<DetailNavigationHost>(
			() => ({
				detail: current.detail,
				open: (detail) =>
					confirmLeave(() =>
						dispatch({
							type: "navigate",
							destination: { ...current, detail },
						}),
					),
				replace: (detail, replacement) =>
					dispatch({ type: "replace-detail", detail, replacement }),
				close: (detail, options) =>
					confirmLeave(() =>
						dispatch({ type: "close-detail", detail, forget: options?.forget }),
					),
			}),
			[current, confirmLeave],
		);
		history.back = () => confirmLeave(() => dispatch({ type: "back" }));
		history.forward = () => confirmLeave(() => dispatch({ type: "forward" }));
		return (
			<UnsavedChangesProvider registry={registry}>
				<DetailNavigationProvider value={host}>
					<SchedulePage />
				</DetailNavigationProvider>
			</UnsavedChangesProvider>
		);
	}

	async function mountHosted() {
		await act(async () => root.render(<HostedSchedulePage />));
		await act(async () => vi.advanceTimersByTimeAsync(0));
	}

	const editorForm = () => container.querySelector("form");

	it("steps out of and back into the editor with Back and Forward", async () => {
		await mountHosted();
		const trigger = button("Open Daily PR summary");
		const viewport = trigger.closest<HTMLElement>(
			"[data-radix-scroll-area-viewport]",
		);
		if (!viewport) throw new Error("Schedule list viewport is missing");
		viewport.scrollTop = 360;
		await act(async () => trigger.click());
		expect(field("schedule-name").value).toBe("Daily PR summary");

		await act(async () => history.back());
		expect(editorForm()).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(viewport.scrollTop).toBe(360);

		await act(async () => history.forward());
		expect(field("schedule-name").value).toBe("Daily PR summary");

		// The page's own Back is the same step in history.
		viewport.scrollTop = 0;
		await act(async () => button("Back to Schedule").click());
		expect(editorForm()).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(viewport.scrollTop).toBe(360);
		await act(async () => history.forward());
		expect(editorForm()).not.toBeNull();
	});

	it("asks before app navigation discards unsaved changes", async () => {
		await mountHosted();
		await act(async () => button("Open Daily PR summary").click());
		await changeField("schedule-name", "Renamed");

		await act(async () => history.back());
		expect(
			document.querySelector('[role="alertdialog"]')?.textContent,
		).toContain("Discard unsaved changes?");
		expect(field("schedule-name").value).toBe("Renamed");
		await act(async () => confirmationButton("Keep editing").click());
		expect(editorForm()).not.toBeNull();

		await act(async () => history.back());
		await act(async () => confirmationButton("Discard").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(editorForm()).toBeNull();
		await act(async () => history.forward());
		expect(field("schedule-name").value).toBe("Daily PR summary");
	});

	it("returns to a newly saved schedule, not a blank draft, when stepping forward", async () => {
		let schedules = [schedule];
		invoke.mockImplementation(async (command: string, args?: unknown) => {
			if (command === "list_routine_schedules")
				return { ...overview(), schedules };
			if (command === "create_routine_schedule") {
				const created = {
					...schedule,
					scheduleId: "schedule-new",
					name: String((args as { name: string }).name),
				};
				schedules = [schedule, created];
				return { schedule: created };
			}
			return defaultInvoke(command);
		});
		await mountHosted();
		await act(async () => button("New schedule").click());
		await act(async () => vi.advanceTimersByTimeAsync(0));
		await changeField("schedule-name", "Nightly check");
		await changeField("schedule-date", "2999-01-01");
		await act(async () => button("Save").click());
		expect(
			container.querySelector('form[aria-label="Edit schedule"]'),
		).not.toBeNull();

		await act(async () => history.back());
		expect(editorForm()).toBeNull();
		await act(async () => history.forward());
		expect(
			container.querySelector('form[aria-label="Edit schedule"]'),
		).not.toBeNull();
		expect(field("schedule-name").value).toBe("Nightly check");
	});

	it("drops a deleted schedule from history instead of reopening it", async () => {
		let schedules = [schedule];
		invoke.mockImplementation(async (command: string) => {
			if (command === "list_routine_schedules")
				return { ...overview(), schedules };
			if (command === "delete_routine_schedule") {
				schedules = [];
				return undefined;
			}
			return defaultInvoke(command);
		});
		await mountHosted();
		await act(async () => button("Open Daily PR summary").click());
		await act(async () => button("Delete Daily PR summary").click());
		await act(async () => confirmationButton("Delete").click());
		expect(editorForm()).toBeNull();
		await act(async () => history.forward());
		expect(editorForm()).toBeNull();
	});
});
