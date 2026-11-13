// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FACTORY_MANAGER } from "@/lib/factory-copy";
import {
	FactoryManagerNotice,
	factoryManagerExampleCardId,
} from "./factory-manager-notice";

const mocks = vi.hoisted(() => ({
	listAgendaTasks: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		listAgendaTasks: mocks.listAgendaTasks,
		subscribe: vi.fn(() => () => undefined),
		subscribeTransportState: vi.fn(() => () => undefined),
	},
}));

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	mocks.listAgendaTasks.mockReset();
	mocks.listAgendaTasks.mockResolvedValue([]);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const card = (
	factoryNumber: number | undefined,
	status: string,
	updatedAt: string,
	archivedAt?: string,
) => ({ factoryNumber, status, updatedAt, archivedAt });

describe("factoryManagerExampleCardId", () => {
	it("names the most recently updated open card", () => {
		expect(
			factoryManagerExampleCardId([
				card(3, "in_progress", "2026-11-10T00:00:00Z"),
				card(7, "approved", "2026-11-11T00:00:00Z"),
				card(9, "completed", "2026-11-12T00:00:00Z"),
				card(undefined, "in_progress", "2026-11-13T00:00:00Z"),
			]),
		).toBe("F7");
	});

	it("falls back to the newest card, and to nothing without numbered cards", () => {
		expect(
			factoryManagerExampleCardId([
				card(2, "completed", "2026-11-10T00:00:00Z"),
				card(4, "in_progress", "2026-11-12T00:00:00Z", "2026-11-12T00:00:00Z"),
			]),
		).toBe("F4");
		expect(
			factoryManagerExampleCardId([
				card(undefined, "in_progress", "2026-11-10T00:00:00Z"),
			]),
		).toBeUndefined();
		expect(factoryManagerExampleCardId([])).toBeUndefined();
	});
});

describe("FactoryManagerNotice", () => {
	const chips = () =>
		[...container.querySelectorAll("button")].map((chip) => chip.textContent);

	it("explains Ask Factory and leaves out the card example with no cards", async () => {
		const onPickExample = vi.fn();
		await act(async () =>
			root.render(<FactoryManagerNotice onPickExample={onPickExample} />),
		);

		expect(container.textContent).toContain("Ask Factory");
		expect(container.textContent).toContain(
			"Give Factory work, ask how it is going, hold or retry a card, or tell Factory how its agents should work.",
		);
		expect(chips()).toEqual([
			"What needs me right now?",
			"What stopped today, and why?",
		]);
		expect(container.textContent).not.toContain("F12");
		act(() => container.querySelector("button")?.click());
		expect(onPickExample).toHaveBeenCalledWith("What needs me right now?");
	});

	it("names a real card in the card example", async () => {
		mocks.listAgendaTasks.mockResolvedValue([
			{
				taskId: "t-1",
				factoryNumber: 26,
				status: "in_progress",
				updatedAt: "2026-11-11T00:00:00Z",
			},
		]);
		const onPickExample = vi.fn();
		await act(async () =>
			root.render(<FactoryManagerNotice onPickExample={onPickExample} />),
		);
		expect(chips()).toEqual([
			"What needs me right now?",
			"How is F26 going?",
			"What stopped today, and why?",
		]);
		act(() =>
			[...container.querySelectorAll("button")]
				.find((chip) => chip.textContent === "How is F26 going?")
				?.click(),
		);
		expect(onPickExample).toHaveBeenCalledWith("How is F26 going?");
	});

	it("offers only questions, never an instruction that spends or changes work", () => {
		for (const example of FACTORY_MANAGER.examples("F1"))
			expect(example).toMatch(/\?$/);
	});

	it("shows no chips and loads no cards when nothing can receive them", async () => {
		await act(async () => root.render(<FactoryManagerNotice />));
		expect(container.querySelector("button")).toBeNull();
		expect(mocks.listAgendaTasks).not.toHaveBeenCalled();
	});

	it("shows the mascot in its hard hat, without a second title, when docked", async () => {
		await act(async () => root.render(<FactoryManagerNotice docked />));
		expect(container.querySelector("[data-factory-mascot]")).not.toBeNull();
		expect(container.querySelector("[data-factory-hard-hat]")).not.toBeNull();
		expect(container.textContent).not.toContain("Ask FactoryGive");
	});
});
