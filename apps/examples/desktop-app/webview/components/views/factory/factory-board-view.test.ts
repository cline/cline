import { describe, expect, it } from "vitest";
import {
	collapseFactoryBoardColumn,
	DEFAULT_FACTORY_BOARD_VIEW,
	type FactoryBoardRow,
	type FactoryBoardView,
	factoryBoardCollapsed,
	factoryBoardTier,
	moveFactoryBoardColumn,
	parseFactoryBoardView,
	resolveFactoryBoard,
	toggleFactoryBoardColumn,
} from "./factory-board-view";

const rows: FactoryBoardRow[] = [
	{ id: "a", status: "waiting", stage: "waiting", project: "app" },
	{ id: "b", status: "working", stage: "build", project: "app" },
	{ id: "c", status: "needsYou", stage: "build", project: "api" },
	{ id: "d", status: "delivered", stage: "delivered", project: "api" },
];
const placed = (view: FactoryBoardView) =>
	Object.fromEntries(
		resolveFactoryBoard(view, rows).map((column) => [
			column.id,
			column.rows.map((row) => row.id),
		]),
	);

describe("resolveFactoryBoard", () => {
	it("puts each card in exactly one column for every built-in grouping", () => {
		for (const grouping of ["status", "stage", "project"] as const) {
			const columns = resolveFactoryBoard(
				{ ...DEFAULT_FACTORY_BOARD_VIEW, grouping },
				rows,
			);
			expect(
				columns.flatMap((column) => column.rows.map((row) => row.id)).sort(),
			).toEqual(["a", "b", "c", "d"]);
			expect(columns.some((column) => column.id === "other")).toBe(false);
		}
		expect(
			placed({ ...DEFAULT_FACTORY_BOARD_VIEW, grouping: "stage" }),
		).toMatchObject({
			waiting: ["a"],
			// Needs you first inside a stage.
			build: ["c", "b"],
			delivered: ["d"],
		});
	});

	it("gives an overlapping card to the first column and the unmatched to Other", () => {
		// Saved columns of the grouping's shape: a later custom column is one
		// more entry like these.
		const view: FactoryBoardView = {
			version: 1,
			grouping: "status",
			columns: [
				{
					id: "needsYou",
					title: "Needs you",
					match: { kind: "status", values: ["needsYou"] },
				},
				{
					id: "working",
					title: "Working",
					match: { kind: "status", values: ["working"] },
				},
			],
		};
		const columns = resolveFactoryBoard(view, [
			...rows,
			// A status no column matches.
			{
				id: "x",
				status: "limbo" as FactoryBoardRow["status"],
				stage: "build",
				project: "app",
			},
		]);
		expect(columns.map((column) => column.id)).toEqual([
			"needsYou",
			"working",
			"waiting",
			"delivered",
			"other",
		]);
		expect(columns.at(-1)?.rows.map((row) => row.id)).toEqual(["x"]);
	});

	it("hides, reorders and keeps Needs you showing", () => {
		const view = { ...DEFAULT_FACTORY_BOARD_VIEW };
		const hidden = toggleFactoryBoardColumn(
			view,
			resolveFactoryBoard(view, rows),
			"waiting",
		);
		expect(
			resolveFactoryBoard(hidden, rows)
				.filter((column) => !column.hidden)
				.map((column) => column.id),
		).toEqual(["working", "needsYou", "delivered"]);
		expect(
			toggleFactoryBoardColumn(
				view,
				resolveFactoryBoard(view, rows),
				"needsYou",
			),
		).toBe(view);
		const moved = moveFactoryBoardColumn(
			hidden,
			resolveFactoryBoard(hidden, rows),
			"delivered",
			-1,
		);
		expect(resolveFactoryBoard(moved, rows).map((column) => column.id)).toEqual(
			["waiting", "working", "delivered", "needsYou"],
		);
	});

	it("lets a person's collapse win until the width changes tier", () => {
		const view = { ...DEFAULT_FACTORY_BOARD_VIEW };
		const narrow = factoryBoardTier(700);
		expect(factoryBoardTier(0)).toBe("wide");
		expect(factoryBoardTier(840)).toBe("medium");
		expect(factoryBoardTier(500)).toBe("tight");
		const columns = resolveFactoryBoard(view, rows);
		const waiting = (next: FactoryBoardView, tier: typeof narrow) =>
			factoryBoardCollapsed(
				next,
				resolveFactoryBoard(next, rows).find(
					(column) => column.id === "waiting",
				) ?? {
					id: "waiting",
				},
				tier,
			);
		expect(waiting(view, narrow)).toBe(true);
		const expanded = collapseFactoryBoardColumn(
			view,
			columns,
			narrow,
			"waiting",
			false,
		);
		expect(waiting(expanded, narrow)).toBe(false);
		expect(waiting(expanded, "medium")).toBe(true);
		expect(waiting(expanded, "wide")).toBe(false);
	});
});

describe("parseFactoryBoardView", () => {
	it("reads a valid view and falls back to the default otherwise", () => {
		const view: FactoryBoardView = {
			version: 1,
			grouping: "project",
			columns: [
				{
					id: "project:app",
					title: "app",
					match: { kind: "project", values: ["app"] },
					hidden: true,
				},
			],
			collapsedTier: "medium",
		};
		expect(parseFactoryBoardView(JSON.stringify(view))).toEqual(view);
		for (const text of [
			null,
			"",
			"[]",
			"{",
			JSON.stringify({ ...view, version: 2 }),
			JSON.stringify({ ...view, collapsedTier: "huge" }),
			JSON.stringify({ ...view, columns: [{ id: 1 }] }),
		])
			expect(parseFactoryBoardView(text)).toBe(DEFAULT_FACTORY_BOARD_VIEW);
	});
});
