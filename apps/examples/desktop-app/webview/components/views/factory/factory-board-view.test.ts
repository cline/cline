import { describe, expect, it } from "vitest";
import {
	collapseFactoryBoardColumn,
	DEFAULT_FACTORY_BOARD_VIEW,
	FACTORY_BOARD_QUEUE_ID,
	type FactoryBoardRow,
	type FactoryBoardTier,
	type FactoryBoardView,
	factoryBoardAutoCollapsed,
	factoryBoardCollapsed,
	factoryBoardTier,
	moveFactoryBoardColumn,
	parseFactoryBoardView,
	resolveFactoryBoard,
	setFactoryBoardQueueColumn,
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

const queue: FactoryBoardView = {
	...DEFAULT_FACTORY_BOARD_VIEW,
	queueColumn: true,
};

describe("resolveFactoryBoard", () => {
	it("puts each card in exactly one column for every built-in grouping", () => {
		for (const view of [
			DEFAULT_FACTORY_BOARD_VIEW,
			queue,
			{ ...DEFAULT_FACTORY_BOARD_VIEW, grouping: "stage" as const },
			{ ...DEFAULT_FACTORY_BOARD_VIEW, grouping: "project" as const },
		]) {
			const columns = resolveFactoryBoard(view, rows);
			expect(
				columns.flatMap((column) => column.rows.map((row) => row.id)).sort(),
			).toEqual(["a", "b", "c", "d"]);
			expect(columns.some((column) => column.id === "other")).toBe(false);
		}
		expect(
			placed({ ...DEFAULT_FACTORY_BOARD_VIEW, grouping: "stage" }),
		).toMatchObject({
			// Queued cards stay in Waiting when grouped by stage.
			waiting: ["a"],
			// Needs you first inside a stage.
			build: ["c", "b"],
			delivered: ["d"],
		});
	});

	it("shows three columns by default, the queue below Working's running cards", () => {
		const queued = { ...rows[0], id: "q" } as FactoryBoardRow;
		const columns = resolveFactoryBoard(DEFAULT_FACTORY_BOARD_VIEW, [
			rows[0] as FactoryBoardRow,
			rows[1] as FactoryBoardRow,
			queued,
			...rows.slice(2),
		]);
		expect(columns.map((column) => column.id)).toEqual([
			"working",
			"needsYou",
			"delivered",
		]);
		const working = columns[0];
		// Running first, then the queue in queue order.
		expect(working?.rows.map((row) => row.id)).toEqual(["b", "a", "q"]);
		expect(working?.sections).toMatchObject([
			{ id: FACTORY_BOARD_QUEUE_ID, title: "Queue" },
		]);
		expect(working?.sections[0]?.rows.map((row) => row.id)).toEqual(["a", "q"]);
		// With the queue as its own column: four, as before.
		expect(placed(queue)).toEqual({
			waiting: ["a"],
			working: ["b"],
			needsYou: ["c"],
			delivered: ["d"],
		});
	});

	it("loads saved four-column views as the three-column default", () => {
		const saved = parseFactoryBoardView(
			JSON.stringify({
				version: 1,
				grouping: "status",
				columns: ["waiting", "working", "needsYou", "delivered"].map((id) => ({
					id,
					title: id,
					match: { kind: "status", values: [id] },
					...(id === "delivered" ? { hidden: true } : {}),
				})),
			}),
		);
		const columns = resolveFactoryBoard(saved, rows);
		expect(columns.map((column) => column.id)).toEqual([
			"working",
			"needsYou",
			"delivered",
		]);
		// The saved flags survive; Working takes the queue.
		expect(columns.find((column) => column.id === "delivered")?.hidden).toBe(
			true,
		);
		expect(placed(saved).working).toEqual(["b", "a"]);
		// Turning the queue column on brings Waiting back first.
		const four = setFactoryBoardQueueColumn(saved, true);
		expect(resolveFactoryBoard(four, rows).map((column) => column.id)).toEqual([
			"waiting",
			"working",
			"needsYou",
			"delivered",
		]);
		expect(parseFactoryBoardView(JSON.stringify(four))).toEqual(four);
		expect(
			setFactoryBoardQueueColumn(four, false).columns.map(
				(column) => column.id,
			),
		).toEqual(["working", "needsYou", "delivered"]);
	});

	it("gives an overlapping card to the first column and the unmatched to Other", () => {
		const view: FactoryBoardView = {
			version: 1,
			grouping: "status",
			queueColumn: true,
			columns: [{ id: "needsYou" }, { id: "working" }],
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
			"delivered",
		);
		expect(
			resolveFactoryBoard(hidden, rows)
				.filter((column) => !column.hidden)
				.map((column) => column.id),
		).toEqual(["working", "needsYou"]);
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
			["working", "delivered", "needsYou"],
		);
	});

	it("collapses Delivered first, never Working or Needs you, by width", () => {
		expect(factoryBoardTier(0)).toBe("wide");
		expect(factoryBoardTier(920)).toBe("wide");
		expect(factoryBoardTier(700)).toBe("medium");
		expect(factoryBoardTier(699)).toBe("narrow");
		expect(factoryBoardTier(500)).toBe("tight");
		const auto = (view: FactoryBoardView, tier: FactoryBoardTier) => [
			...factoryBoardAutoCollapsed(view, tier),
		];
		expect(auto(DEFAULT_FACTORY_BOARD_VIEW, "medium")).toEqual([]);
		expect(auto(DEFAULT_FACTORY_BOARD_VIEW, "narrow")).toEqual(["delivered"]);
		expect(auto(DEFAULT_FACTORY_BOARD_VIEW, "tight")).toEqual(["delivered"]);
		expect(auto(queue, "medium")).toEqual(["waiting"]);
		expect(auto(queue, "narrow")).toEqual(["waiting", "delivered"]);
	});

	it("lets a person's collapse win until the width changes tier", () => {
		const view = { ...DEFAULT_FACTORY_BOARD_VIEW };
		const columns = resolveFactoryBoard(view, rows);
		const delivered = (next: FactoryBoardView, tier: FactoryBoardTier) =>
			factoryBoardCollapsed(
				next,
				resolveFactoryBoard(next, rows).find(
					(column) => column.id === "delivered",
				) ?? { id: "delivered" },
				tier,
			);
		expect(delivered(view, "narrow")).toBe(true);
		const expanded = collapseFactoryBoardColumn(
			view,
			columns,
			"narrow",
			"delivered",
			false,
		);
		expect(delivered(expanded, "narrow")).toBe(false);
		expect(delivered(expanded, "tight")).toBe(true);
		expect(delivered(expanded, "wide")).toBe(false);
	});
});

describe("parseFactoryBoardView", () => {
	it("reads a valid view and falls back to the default otherwise", () => {
		const view: FactoryBoardView = {
			version: 1,
			grouping: "project",
			columns: [{ id: "project:app", hidden: true }],
			collapsedTier: "medium",
		};
		expect(parseFactoryBoardView(JSON.stringify(view))).toEqual(view);
		// Saved columns used to carry a title, tone and predicate too.
		expect(
			parseFactoryBoardView(
				JSON.stringify({
					...view,
					columns: [
						{
							id: "project:app",
							title: "app",
							match: { kind: "project", values: ["app"] },
							hidden: true,
						},
					],
				}),
			),
		).toEqual(view);
		for (const text of [
			null,
			"",
			"[]",
			"{",
			JSON.stringify({ ...view, version: 2 }),
			JSON.stringify({ ...view, collapsedTier: "huge" }),
			JSON.stringify({ ...view, queueColumn: "yes" }),
			JSON.stringify({ ...view, columns: [{ id: 1 }] }),
		])
			expect(parseFactoryBoardView(text)).toBe(DEFAULT_FACTORY_BOARD_VIEW);
	});
});
