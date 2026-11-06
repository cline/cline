// @vitest-environment jsdom
import { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailList } from "../components/detail-list.js";
import { DetailListItem } from "../components/detail-list-item.js";

const columns = [
	{ key: "frequency", label: "Frequency", width: "8rem" },
	{ key: "runs", label: "Runs" },
	{ key: "lastRun", label: "Last run" },
] as const;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

function primary() {
	const button = container.querySelector<HTMLButtonElement>(
		"[data-slot='detail-list-item-primary']",
	);
	if (!button) throw new Error("Missing primary action");
	return button;
}

describe("DetailList columns", () => {
	it("preserves the native list and row refs while adding a visual header", async () => {
		const listRef = createRef<HTMLDListElement>();
		const itemRef = createRef<HTMLDivElement>();
		await render(
			<DetailList
				ref={listRef}
				id="schedule-list"
				aria-label="Schedules"
				className="custom-list"
				style={{ maxWidth: 840 }}
				columns={columns}
				titleLabel={<span>Schedule</span>}
			>
				<DetailListItem
					ref={itemRef}
					id="daily"
					hidden
					title="Daily review"
					values={{ frequency: "Daily", runs: 3, lastRun: "Yesterday" }}
				/>
			</DetailList>,
		);

		const list = container.querySelector("dl");
		expect(listRef.current).toBe(list);
		expect(list?.id).toBe("schedule-list");
		expect(list?.getAttribute("aria-label")).toBe("Schedules");
		expect(list?.classList.contains("custom-list")).toBe(true);
		expect(list?.style.maxWidth).toBe("840px");
		expect(itemRef.current).toBe(container.querySelector("#daily"));
		expect(itemRef.current?.parentElement).toBe(list);
		expect(itemRef.current?.hidden).toBe(true);

		const header = list?.querySelector("[data-slot='detail-list-header']");
		expect(header?.getAttribute("aria-hidden")).toBe("true");
		expect(header?.querySelector("dt")?.textContent).toBe("Schedule");
		expect(
			Array.from(header?.querySelectorAll("dd") ?? [])
				.slice(0, 3)
				.map((cell) => cell.textContent),
		).toEqual(["Frequency", "Runs", "Last run"]);
	});

	it("keeps labeled values in order alongside descriptions and trailing content", async () => {
		await render(
			<DetailList columns={columns}>
				<DetailListItem
					title="Daily review"
					description="Review recent changes."
					trailingText={<a href="/settings">Configure timezone</a>}
					values={{ runs: 0, frequency: "Daily", unknown: "Do not render" }}
				/>
			</DetailList>,
		);

		const cells = Array.from(
			container.querySelectorAll("[data-slot='detail-list-item-value']"),
		);
		for (const cell of cells) {
			expect(cell.parentElement?.tagName).toBe("DL");
		}
		expect(cells.map((cell) => cell.querySelector("dt")?.textContent)).toEqual([
			"Frequency",
			"Runs",
			"Last run",
		]);
		expect(cells.map((cell) => cell.querySelector("dd")?.textContent)).toEqual([
			"Daily",
			"0",
			"—",
		]);
		expect(container.textContent).not.toContain("Do not render");
		const trailing = container.querySelector(
			"[data-slot='detail-list-item-trailing-text']",
		);
		expect(trailing?.tagName).toBe("DD");
		expect(trailing?.querySelector("a")?.getAttribute("href")).toBe(
			"/settings",
		);
		expect(container.textContent).toContain("Review recent changes.");
	});

	it("keeps empty-column lists in the existing detail-list mode", async () => {
		await render(
			<DetailList columns={[]}>
				<DetailListItem title="Status" trailingText="Connected" />
			</DetailList>,
		);
		expect(
			container.querySelector("[data-slot='detail-list-header']"),
		).toBeNull();
		expect(container.querySelector("dt")?.textContent).toBe("Status");
		expect(
			container.querySelector(".cline-ui-detail-list-item__trailing-text")
				?.textContent,
		).toBe("Connected");
		expect(
			container.querySelector("[data-slot='detail-list-item-value']"),
		).toBeNull();
	});

	it("does not leak column definitions into a nested ordinary list", async () => {
		await render(
			<DetailList columns={columns}>
				<DetailListItem
					title="Daily review"
					values={{ frequency: "Daily" }}
					description={
						<DetailList aria-label="Connection details">
							<DetailListItem title="Status" trailingText="Connected" />
						</DetailList>
					}
				/>
			</DetailList>,
		);
		const nested = container.querySelector(
			'dl[aria-label="Connection details"]',
		);
		expect(nested?.querySelector("dt")?.textContent).toBe("Status");
		expect(
			nested?.querySelector("[data-slot='detail-list-header']"),
		).toBeNull();
		expect(
			nested?.querySelector("[data-slot='detail-list-item-value']"),
		).toBeNull();
		expect(nested?.textContent).toContain("Connected");
	});
});

describe("DetailListItem primary action", () => {
	it("uses a native named button inside the term without creating a hover preview", async () => {
		const onClick = vi.fn();
		await render(
			<DetailList>
				<DetailListItem
					title={<span>Daily review</span>}
					description="A long prompt stays in the row, not a native hover tooltip."
					primaryAction={{ onClick }}
				/>
			</DetailList>,
		);
		const button = primary();
		expect(button.tagName).toBe("BUTTON");
		expect(button.type).toBe("button");
		expect(button.closest("dt")).not.toBeNull();
		expect(button.textContent).toBe("Daily review");
		expect(container.querySelector("[title]")).toBeNull();
		await act(async () => button.click());
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("keeps controls independent and honors an explicit action name", async () => {
		const onOpen = vi.fn();
		const onToggle = vi.fn();
		const onEdit = vi.fn();
		await render(
			<DetailList columns={columns}>
				<DetailListItem
					title="Daily review"
					primaryAction={{ label: "View review history", onClick: onOpen }}
					values={{ frequency: "Daily" }}
					actions={
						<>
							<input
								type="checkbox"
								aria-label="Enable review"
								onChange={onToggle}
							/>
							<button type="button" onClick={onEdit}>
								Edit
							</button>
						</>
					}
				/>
			</DetailList>,
		);
		expect(primary().getAttribute("aria-label")).toBe("View review history");
		expect(primary().querySelector("button, input, a")).toBeNull();
		await act(async () => {
			container.querySelector<HTMLInputElement>("input")?.click();
			Array.from(container.querySelectorAll("button"))
				.find((button) => button.textContent === "Edit")
				?.click();
		});
		expect(onToggle).toHaveBeenCalledOnce();
		expect(onEdit).toHaveBeenCalledOnce();
		expect(onOpen).not.toHaveBeenCalled();
		await act(async () => primary().click());
		expect(onOpen).toHaveBeenCalledOnce();
	});

	it("disables only the primary action when requested", async () => {
		const onOpen = vi.fn();
		const onEdit = vi.fn();
		await render(
			<DetailList>
				<DetailListItem
					title="Daily review"
					primaryAction={{ onClick: onOpen, disabled: true }}
					actions={
						<button type="button" onClick={onEdit}>
							Edit
						</button>
					}
				/>
			</DetailList>,
		);
		expect(primary().disabled).toBe(true);
		const edit = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Edit",
		);
		expect(edit?.disabled).toBe(false);
		await act(async () => {
			primary().click();
			edit?.click();
		});
		expect(onOpen).not.toHaveBeenCalled();
		expect(onEdit).toHaveBeenCalledOnce();
	});
});
