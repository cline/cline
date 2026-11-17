// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	recordScheduleRunNotification,
	resetScheduleRunNotificationsForTesting,
} from "@/hooks/use-schedule-run-notifications";
import { ScheduleList, ScheduleListItem } from "./schedule-list";
import type { Schedule } from "./schedule-types";

const schedule: Schedule = {
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	resetScheduleRunNotificationsForTesting();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

function control(label: string) {
	const element = container.querySelector<HTMLButtonElement | HTMLInputElement>(
		`[aria-label="${label}"]`,
	);
	if (!element) throw new Error(`Missing control: ${label}`);
	return element;
}

function callbacks() {
	return {
		onOpen: vi.fn(),
		onEnabledChange: vi.fn(),
	};
}

describe("ScheduleListItem", () => {
	it.each([
		true,
		false,
	])("keeps schedule actions independent of the native schedule button (enabled: %s)", async (enabled) => {
		const handlers = callbacks();
		const currentSchedule = { ...schedule, enabled };
		await act(async () =>
			root.render(
				<ScheduleListItem
					schedule={currentSchedule}
					isBusy={false}
					executions={[]}
					{...handlers}
				/>,
			),
		);

		await act(async () => control("Enable Daily PR summary").click());

		expect(handlers.onOpen).not.toHaveBeenCalled();
		expect(handlers.onEnabledChange).toHaveBeenCalledExactlyOnceWith(
			currentSchedule,
			!enabled,
		);

		const primary = control("Open Daily PR summary");
		expect(primary.tagName).toBe("BUTTON");
		expect(primary.getAttribute("type")).toBe("button");
		expect(primary.querySelector("button, input")).toBeNull();
		await act(async () => primary.click());
		expect(handlers.onOpen).toHaveBeenCalledExactlyOnceWith(
			currentSchedule,
			primary,
		);
	});

	it("blocks mutations while busy and keeps schedule details accessible", async () => {
		const handlers = callbacks();
		await act(async () =>
			root.render(
				<ScheduleListItem
					schedule={schedule}
					executions={[]}
					isBusy
					{...handlers}
				/>,
			),
		);
		expect(control("Enable Daily PR summary").disabled).toBe(true);
		await act(async () => control("Enable Daily PR summary").click());
		expect(handlers.onEnabledChange).not.toHaveBeenCalled();
		await act(async () => control("Open Daily PR summary").click());
		expect(handlers.onOpen).toHaveBeenCalledExactlyOnceWith(
			schedule,
			control("Open Daily PR summary"),
		);
	});

	it("shows an unread dot before the title and reserves matching header space", async () => {
		recordScheduleRunNotification({
			executionId: "execution-1",
			scheduleId: schedule.scheduleId,
		});
		await act(async () =>
			root.render(
				<ScheduleList
					schedules={[schedule]}
					executions={[]}
					busyScheduleIds={new Set()}
					{...callbacks()}
				/>,
			),
		);

		const row = control("Open Daily PR summary");
		const rowSlot = row.querySelector("[data-schedule-run-indicator-slot]");
		const headerSlot = container.querySelector(
			'[data-slot="detail-list-header"] [data-schedule-run-indicator-slot]',
		);
		expect(rowSlot).not.toBeNull();
		expect(headerSlot).not.toBeNull();
		expect(rowSlot?.getAttribute("data-schedule-run-status")).toBe("unread");
		expect(headerSlot?.getAttribute("data-schedule-run-status")).toBeNull();
	});
});
