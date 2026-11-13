import { FACTORY_STATIONS, type FactoryStation } from "@/lib/factory-attention";
import { FACTORY_BOARD, FACTORY_LINE } from "@/lib/factory-copy";
import type { FactoryTone } from "./factory-ui";

/** Where the home lists a card (its status group); each card has one. */
export type FactoryBoardStatus =
	| "waiting"
	| "working"
	| "needsYou"
	| "delivered";

/** What a column can match on, for one card. */
export type FactoryBoardRow = {
	id: string;
	status: FactoryBoardStatus;
	/** The card's current stage; `waiting` before Scope. */
	stage: FactoryStation;
	/** The repository's folder name. */
	project: string;
};

/**
 * A board column is plain data: an id, a title, an optional tone, and a
 * predicate from a closed set of kinds. The built-in groupings below produce
 * it; the saved view keeps only each column's id and the person's flags.
 */
export type FactoryBoardColumn = {
	id: string;
	title: string;
	tone?: FactoryTone;
	match: FactoryBoardMatch;
	/**
	 * Parts of the column below its main cards, each under a quiet divider:
	 * the cards the section matches, after the rest. Working's queue is one.
	 */
	sections?: { id: string; title: string; match: FactoryBoardMatch }[];
};

export type FactoryBoardMatch = {
	kind: "status" | "stage" | "project";
	values: string[];
};

/**
 * A column as the saved view keeps it: its id and the person's flags. A
 * user-defined column later is one more entry here, with its own fields.
 */
export type FactoryBoardViewColumn = {
	id: string;
	hidden?: boolean;
	/** The person's collapse (true) or expand (false) of this column. */
	collapsed?: boolean;
};

export type FactoryBoardGrouping = "status" | "stage" | "project";

/**
 * The saved board view (localStorage, `FACTORY_BOARD_VIEW_KEY`): the grouping
 * and its columns in the person's order with their flags. `collapsedTier` is
 * the width tier the collapse flags were set at; they lapse when the width
 * changes tier. Versioned and validated on read; older saved columns that
 * also carried a title, tone and predicate still load (those are ignored).
 */
export type FactoryBoardView = {
	version: 1;
	grouping: FactoryBoardGrouping;
	columns: FactoryBoardViewColumn[];
	collapsedTier?: FactoryBoardTier;
	/**
	 * Status grouping: the queue as its own Waiting column (four columns)
	 * instead of the lower part of Working (three, the default).
	 */
	queueColumn?: boolean;
};

/**
 * The order the status columns read in, left to right, with the queue as its
 * own column; by default Waiting is the lower part of Working instead.
 */
export const FACTORY_BOARD_STATUSES: readonly FactoryBoardStatus[] = [
	"waiting",
	"working",
	"needsYou",
	"delivered",
];

/** Working's lower part by default: the cards waiting to start. */
export const FACTORY_BOARD_QUEUE_ID = "queue";

/** Inside a stage or project column: what needs you first, then the rest. */
const STATUS_PRIORITY: Record<FactoryBoardStatus, number> = {
	needsYou: 0,
	working: 1,
	waiting: 2,
	delivered: 3,
};

const STATUS_TONE: Record<FactoryBoardStatus, FactoryTone> = {
	waiting: "neutral",
	working: "working",
	needsYou: "attention",
	delivered: "success",
};

/**
 * The built-in groupings: each turns the cards into its default columns.
 * Another grouping (a pipeline's custom stages, say) is one more entry.
 */
export const FACTORY_BOARD_GROUPINGS: Record<
	FactoryBoardGrouping,
	{
		label: string;
		columns: (
			rows: readonly FactoryBoardRow[],
			view: Pick<FactoryBoardView, "queueColumn">,
		) => FactoryBoardColumn[];
		/** Keeps the order rows come in instead of needs-you first. */
		keepOrder?: boolean;
	}
> = {
	status: {
		label: FACTORY_BOARD.groupings.status,
		keepOrder: true,
		columns: (_rows, { queueColumn }) =>
			FACTORY_BOARD_STATUSES.flatMap((status): FactoryBoardColumn[] => {
				const column: FactoryBoardColumn = {
					id: status,
					title: FACTORY_LINE.groups[status],
					tone: STATUS_TONE[status],
					match: { kind: "status", values: [status] },
				};
				if (queueColumn) return [column];
				if (status === "waiting") return [];
				// Running cards on top, the queue below them.
				return status === "working"
					? [
							{
								...column,
								match: { kind: "status", values: ["working", "waiting"] },
								sections: [
									{
										id: FACTORY_BOARD_QUEUE_ID,
										title: FACTORY_BOARD.queue,
										match: { kind: "status", values: ["waiting"] },
									},
								],
							},
						]
					: [column];
			}),
	},
	stage: {
		label: FACTORY_BOARD.groupings.stage,
		columns: () =>
			FACTORY_STATIONS.map((stage) => ({
				id: stage,
				title: FACTORY_LINE.stations[stage],
				tone:
					stage === "waiting"
						? "neutral"
						: stage === "delivered"
							? "success"
							: "working",
				match: { kind: "stage", values: [stage] },
			})),
	},
	project: {
		label: FACTORY_BOARD.groupings.project,
		columns: (rows) =>
			[...new Set(rows.map((row) => row.project))]
				.sort((a, b) => a.localeCompare(b))
				.map((project) => ({
					id: `project:${project}`,
					title: project || FACTORY_BOARD.noProject,
					match: { kind: "project", values: [project] },
				})),
	},
};

/** The trailing column for cards no column matched; shown only when used. */
export const FACTORY_BOARD_OTHER_ID = "other";

export function factoryBoardMatches(
	column: Pick<FactoryBoardColumn, "match">,
	row: FactoryBoardRow,
): boolean {
	const { kind, values } = column.match;
	return values.includes(row[kind]);
}

export type FactoryBoardResolvedColumn = Omit<
	FactoryBoardColumn,
	"match" | "sections"
> &
	FactoryBoardViewColumn & {
		/** Every card of the column: its main cards, then each section's. */
		rows: FactoryBoardRow[];
		sections: {
			id: string;
			title: string;
			match: FactoryBoardMatch;
			rows: FactoryBoardRow[];
		}[];
	};

/**
 * Resolves a saved view into the board's columns, in order, each card in
 * exactly one: the first column (hidden ones included) whose predicate
 * matches wins; cards no column matches go to a trailing Other column that
 * appears only when it has cards. Saved columns keep their order and flags;
 * the grouping's columns the view does not name yet (a new project) follow.
 * Rows keep their order, or (stage and project) needs-you first.
 */
export function resolveFactoryBoard(
	view: FactoryBoardView,
	rows: readonly FactoryBoardRow[],
): FactoryBoardResolvedColumn[] {
	const grouping = FACTORY_BOARD_GROUPINGS[view.grouping];
	const defaults = grouping.columns(rows, view);
	const byId = new Map(defaults.map((column) => [column.id, column]));
	const saved = view.columns.flatMap((column) => {
		const current = byId.get(column.id);
		// A built-in column whose cards are gone (a project with no cards)
		// leaves the board; its saved flags are kept for when it returns.
		return current
			? [{ ...current, hidden: column.hidden, collapsed: column.collapsed }]
			: [];
	});
	const named = new Set(saved.map((column) => column.id));
	const listed: (FactoryBoardColumn & FactoryBoardViewColumn)[] = [
		...saved,
		...defaults.filter((column) => !named.has(column.id)),
	];
	const columns: FactoryBoardResolvedColumn[] = listed.map((column) => ({
		...column,
		hidden: factoryBoardPinned(view.grouping, column.id)
			? false
			: column.hidden,
		rows: [],
		sections: (column.sections ?? []).map((section) => ({
			...section,
			rows: [],
		})),
	}));
	const other: FactoryBoardResolvedColumn = {
		id: FACTORY_BOARD_OTHER_ID,
		title: FACTORY_BOARD.other,
		rows: [],
		sections: [],
	};
	const ordered = grouping.keepOrder
		? rows
		: [...rows].sort(
				(a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status],
			);
	for (const row of ordered) {
		const column =
			columns.find((item) => factoryBoardMatches(item, row)) ?? other;
		(
			column.sections.find((section) => factoryBoardMatches(section, row)) ??
			column
		).rows.push(row);
	}
	// Main cards first, then each section's, so every card is in `rows` once.
	for (const column of columns)
		column.rows.push(...column.sections.flatMap((section) => section.rows));
	return other.rows.length ? [...columns, other] : columns;
}

/** Width tiers of the board. */
export type FactoryBoardTier = "wide" | "medium" | "narrow" | "tight";

/**
 * A width of 0 is not measured yet (or jsdom): treated as wide. Three
 * 220px columns with their gaps fit from 700px; four from 920px.
 */
export function factoryBoardTier(width: number): FactoryBoardTier {
	if (width <= 0 || width >= 920) return "wide";
	if (width >= 700) return "medium";
	if (width >= 552) return "narrow";
	return "tight";
}

/**
 * Columns the width collapses to strips, only in the Status grouping:
 * Delivered first, then (with the queue as its own column) Waiting. Needs
 * you and Working never collapse on their own.
 */
export function factoryBoardAutoCollapsed(
	view: Pick<FactoryBoardView, "grouping" | "queueColumn">,
	tier: FactoryBoardTier,
): ReadonlySet<string> {
	if (view.grouping !== "status" || tier === "wide") return new Set();
	if (!view.queueColumn) return new Set(tier === "medium" ? [] : ["delivered"]);
	return new Set(tier === "medium" ? ["waiting"] : ["waiting", "delivered"]);
}

/** Columns a person cannot hide or collapse: Needs you, by status. */
export function factoryBoardPinned(
	grouping: FactoryBoardGrouping,
	id: string,
): boolean {
	return grouping === "status" && id === "needsYou";
}

export const FACTORY_BOARD_VIEW_KEY = "cline.code.factory-board-view.v1";

export const DEFAULT_FACTORY_BOARD_VIEW: FactoryBoardView = {
	version: 1,
	grouping: "status",
	columns: [],
};

const GROUPINGS = new Set<unknown>(["status", "stage", "project"]);
const TIERS = new Set<unknown>(["wide", "medium", "narrow", "tight"]);
function parseColumn(value: unknown): FactoryBoardViewColumn | undefined {
	if (!value || typeof value !== "object") return undefined;
	const column = value as Record<string, unknown>;
	if (
		typeof column.id !== "string" ||
		(column.hidden !== undefined && typeof column.hidden !== "boolean") ||
		(column.collapsed !== undefined && typeof column.collapsed !== "boolean")
	)
		return undefined;
	return {
		id: column.id,
		...(column.hidden === undefined ? {} : { hidden: column.hidden }),
		...(column.collapsed === undefined ? {} : { collapsed: column.collapsed }),
	};
}

/** Reads a saved view; anything that does not fit the schema gives the default. */
export function parseFactoryBoardView(text: string | null): FactoryBoardView {
	if (!text) return DEFAULT_FACTORY_BOARD_VIEW;
	try {
		const value = JSON.parse(text) as Record<string, unknown> | null;
		if (
			!value ||
			typeof value !== "object" ||
			value.version !== 1 ||
			!GROUPINGS.has(value.grouping) ||
			!Array.isArray(value.columns) ||
			(value.collapsedTier !== undefined && !TIERS.has(value.collapsedTier)) ||
			(value.queueColumn !== undefined &&
				typeof value.queueColumn !== "boolean")
		)
			return DEFAULT_FACTORY_BOARD_VIEW;
		const columns = value.columns.map(parseColumn);
		if (columns.some((column) => column === undefined))
			return DEFAULT_FACTORY_BOARD_VIEW;
		return {
			version: 1,
			grouping: value.grouping as FactoryBoardGrouping,
			columns: columns as FactoryBoardViewColumn[],
			collapsedTier: value.collapsedTier as FactoryBoardTier | undefined,
			...(value.queueColumn === true ? { queueColumn: true } : {}),
		};
	} catch {
		return DEFAULT_FACTORY_BOARD_VIEW;
	}
}

export function readFactoryBoardView(): FactoryBoardView {
	if (typeof window === "undefined") return DEFAULT_FACTORY_BOARD_VIEW;
	try {
		return parseFactoryBoardView(
			window.localStorage?.getItem(FACTORY_BOARD_VIEW_KEY) ?? null,
		);
	} catch {
		return DEFAULT_FACTORY_BOARD_VIEW;
	}
}

export function saveFactoryBoardView(view: FactoryBoardView) {
	try {
		window.localStorage?.setItem(FACTORY_BOARD_VIEW_KEY, JSON.stringify(view));
	} catch {
		// Best effort: the board still works for this session.
	}
}

/** The saved form of the resolved columns, without cards or Other. */
function saveColumns(
	columns: readonly FactoryBoardResolvedColumn[],
): FactoryBoardViewColumn[] {
	return columns
		.filter((column) => column.id !== FACTORY_BOARD_OTHER_ID)
		.map(({ id, hidden, collapsed }) => ({ id, hidden, collapsed }));
}

/** Switches the grouping; its columns start from the grouping's defaults. */
export function groupFactoryBoard(
	view: FactoryBoardView,
	grouping: FactoryBoardGrouping,
): FactoryBoardView {
	return grouping === view.grouping
		? view
		: {
				version: 1,
				grouping,
				columns: [],
				...(view.queueColumn ? { queueColumn: true } : {}),
			};
}

/**
 * Shows the queue as its own Waiting column, first, or as Working's lower
 * part. The other columns keep their order and flags.
 */
export function setFactoryBoardQueueColumn(
	view: FactoryBoardView,
	queueColumn: boolean,
): FactoryBoardView {
	const { queueColumn: _previous, ...rest } = view;
	const columns = view.columns.filter((column) => column.id !== "waiting");
	if (!queueColumn) return { ...rest, columns };
	return {
		...rest,
		queueColumn: true,
		columns: columns.length ? [{ id: "waiting" }, ...columns] : columns,
	};
}

/** Shows or hides one column. Needs you, by status, always shows. */
export function toggleFactoryBoardColumn(
	view: FactoryBoardView,
	columns: readonly FactoryBoardResolvedColumn[],
	id: string,
): FactoryBoardView {
	if (factoryBoardPinned(view.grouping, id)) return view;
	return {
		...view,
		columns: saveColumns(columns).map((column) =>
			column.id === id ? { ...column, hidden: !column.hidden } : column,
		),
	};
}

/** Moves one column a place left (-1) or right (1). */
export function moveFactoryBoardColumn(
	view: FactoryBoardView,
	columns: readonly FactoryBoardResolvedColumn[],
	id: string,
	by: -1 | 1,
): FactoryBoardView {
	const order = saveColumns(columns);
	const from = order.findIndex((column) => column.id === id);
	const to = from + by;
	if (from === -1 || to < 0 || to >= order.length) return view;
	const [moved] = order.splice(from, 1);
	if (moved) order.splice(to, 0, moved);
	return { ...view, columns: order };
}

/**
 * Collapses or expands one column at the current tier. Collapse flags set
 * at another tier lapse first: the width decides again after it changes.
 */
export function collapseFactoryBoardColumn(
	view: FactoryBoardView,
	columns: readonly FactoryBoardResolvedColumn[],
	tier: FactoryBoardTier,
	id: string,
	collapsed: boolean,
): FactoryBoardView {
	if (factoryBoardPinned(view.grouping, id)) return view;
	const current = view.collapsedTier === tier;
	return {
		...view,
		collapsedTier: tier,
		columns: saveColumns(columns).map((column) => ({
			...column,
			collapsed:
				column.id === id ? collapsed : current ? column.collapsed : undefined,
		})),
	};
}

/** Whether a column shows as a strip: the person's choice at this tier, else the width's. */
export function factoryBoardCollapsed(
	view: FactoryBoardView,
	column: Pick<FactoryBoardViewColumn, "id" | "collapsed">,
	tier: FactoryBoardTier,
): boolean {
	if (factoryBoardPinned(view.grouping, column.id)) return false;
	const chosen = view.collapsedTier === tier ? column.collapsed : undefined;
	return chosen ?? factoryBoardAutoCollapsed(view, tier).has(column.id);
}
