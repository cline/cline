import type { ShareCardModel, ShareCardVariant } from "./share-card";

/**
 * Share-card layout, kept pure so every placement is assertable without a
 * canvas. Three rules keep the card from overlapping or overflowing whatever
 * it holds:
 *
 *  1. A region's position never depends on another region's content. The
 *     toggles select one of four fixed templates; each is a vertical stack
 *     whose flexible region absorbs the spare height, with anything left over
 *     spread across the gaps, so there is neither overflow nor a dead band.
 *  2. Text only adapts inside its own slot. `fitText` measures real glyph
 *     bounds, shrinks the font down to a floor, then ellipsizes.
 *  3. There are at most three agents, so the agent row divides its width
 *     instead of dropping anyone.
 */

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 675;
export const SHARE_CARD_FONT_FAMILY =
	'system-ui, -apple-system, "Segoe UI", sans-serif';

const CONTENT = { x: 64, y: 44, width: 1072, height: 595 } as const;
const CONTENT_RIGHT = CONTENT.x + CONTENT.width;

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type InkRole = "primary" | "secondary" | "muted" | "hairline" | "accent";
export type RhythmLevel = 0 | 1 | 2 | 3 | 4;
export type FillRole = InkRole | `level${RhythmLevel}`;

export interface TextOp {
	kind: "text";
	id: string;
	text: string;
	slot: Box;
	weight: number;
	maxSize: number;
	minSize: number;
	color: InkRole;
	align: "left" | "right";
}

export interface RectOp {
	kind: "rect";
	id: string;
	/** Rects in one group may overlap on purpose (a bar's fill over its track). */
	group: string;
	box: Box;
	fill: FillRole;
	radius: number;
}

export interface LogoOp {
	kind: "logo";
	id: string;
	box: Box;
	fill: InkRole;
}

export type ShareCardOp = TextOp | RectOp | LogoOp;

export interface ShareCardPlan {
	variant: ShareCardVariant;
	regions: Record<string, { y: number; height: number }>;
	ops: ShareCardOp[];
}

export function shareCardFont(weight: number, size: number): string {
	return `${weight} ${size}px ${SHARE_CARD_FONT_FAMILY}`;
}

// ── Regions ────────────────────────────────────────────────────────────────

type StackItem =
	| { id: string; height: number }
	| { id: string; min: number; max: number }
	| { gap: number };

const TEMPLATES: Record<ShareCardVariant, StackItem[]> = {
	"rhythm+agents": [
		{ id: "header", height: 36 },
		{ gap: 22 },
		{ id: "hero", height: 108 },
		{ gap: 26 },
		{ id: "rhythm", min: 232, max: 300 },
		{ gap: 24 },
		{ id: "agents", height: 52 },
		{ gap: 22 },
		{ id: "footer", height: 34 },
	],
	rhythm: [
		{ id: "header", height: 36 },
		{ gap: 22 },
		{ id: "hero", height: 108 },
		{ gap: 28 },
		{ id: "rhythm", min: 232, max: 340 },
		{ gap: 26 },
		{ id: "footer", height: 34 },
	],
	agents: [
		{ id: "header", height: 36 },
		{ gap: 22 },
		{ id: "hero", height: 108 },
		{ gap: 40 },
		{ id: "agentsLarge", min: 176, max: 260 },
		{ gap: 40 },
		{ id: "footer", height: 34 },
	],
	minimal: [
		{ id: "header", height: 36 },
		{ gap: 22 },
		{ id: "heroLarge", min: 200, max: 470 },
		{ gap: 22 },
		{ id: "footer", height: 34 },
	],
};

export function planRegions(
	variant: ShareCardVariant,
): Record<string, { y: number; height: number }> {
	const items = TEMPLATES[variant];
	const base = items.reduce(
		(sum, item) =>
			sum +
			("gap" in item ? item.gap : "height" in item ? item.height : item.min),
		0,
	);
	let spare = CONTENT.height - base;
	if (spare < 0) {
		throw new Error(
			`share card template "${variant}" overflows by ${-spare}px`,
		);
	}
	const flex = items.find(
		(item): item is { id: string; min: number; max: number } => "min" in item,
	);
	const flexExtra = flex ? Math.min(spare, flex.max - flex.min) : 0;
	spare -= flexExtra;
	const gaps = items.filter((item) => "gap" in item).length;
	const gapExtra = gaps === 0 ? 0 : spare / gaps;

	const regions: Record<string, { y: number; height: number }> = {};
	let cursor: number = CONTENT.y;
	for (const item of items) {
		if ("gap" in item) {
			cursor += item.gap + gapExtra;
			continue;
		}
		const height = "height" in item ? item.height : item.min + flexExtra;
		regions[item.id] = { y: Math.round(cursor), height };
		cursor += height;
	}
	return regions;
}

// ── Text fitting ───────────────────────────────────────────────────────────

/** Glyph metrics for one string at one font size; see CanvasRenderingContext2D.measureText. */
export interface GlyphMetrics {
	/** Ink left of the drawing point (measured with textAlign "left"). */
	left: number;
	/** Ink right of the drawing point. */
	right: number;
	/** Ink above the alphabetic baseline. */
	ascent: number;
	/** Ink below the alphabetic baseline. */
	descent: number;
	/** Em box above and below the baseline, used to centre a line in its slot. */
	emAscent: number;
	emDescent: number;
}

export type MeasureText = (
	text: string,
	weight: number,
	size: number,
) => GlyphMetrics;

export interface FittedText {
	text: string;
	size: number;
	/** Drawing point for textAlign "left" and textBaseline "alphabetic". */
	x: number;
	baseline: number;
	/** Where the ink actually lands. */
	bounds: Box;
	truncated: boolean;
}

const FIT_TOLERANCE = 0.5;

function contains(slot: Box, bounds: Box): boolean {
	return (
		bounds.x >= slot.x - FIT_TOLERANCE &&
		bounds.y >= slot.y - FIT_TOLERANCE &&
		bounds.x + bounds.width <= slot.x + slot.width + FIT_TOLERANCE &&
		bounds.y + bounds.height <= slot.y + slot.height + FIT_TOLERANCE
	);
}

export function fitText(op: TextOp, measure: MeasureText): FittedText {
	const place = (text: string, size: number) => {
		const metrics = measure(text, op.weight, size);
		const x =
			op.align === "left"
				? op.slot.x + Math.max(0, metrics.left)
				: op.slot.x + op.slot.width - metrics.right;
		const baseline =
			op.slot.y +
			(op.slot.height - (metrics.emAscent + metrics.emDescent)) / 2 +
			metrics.emAscent;
		const bounds = {
			x: x - metrics.left,
			y: baseline - metrics.ascent,
			width: metrics.left + metrics.right,
			height: metrics.ascent + metrics.descent,
		};
		return { text, size, x, baseline, bounds };
	};

	for (let size = op.maxSize; size >= op.minSize; size -= 1) {
		const placed = place(op.text, size);
		if (contains(op.slot, placed.bounds))
			return { ...placed, truncated: false };
	}
	// Still too wide at the floor size: keep the size and drop characters.
	let text = op.text;
	while (text.length > 1) {
		text = text.slice(0, -1).trimEnd();
		const placed = place(`${text}…`, op.minSize);
		if (contains(op.slot, placed.bounds)) return { ...placed, truncated: true };
	}
	return { ...place("…", op.minSize), truncated: true };
}

// ── Plan ───────────────────────────────────────────────────────────────────

function text(
	id: string,
	value: string,
	slot: Box,
	style: Omit<TextOp, "kind" | "id" | "text" | "slot" | "align"> & {
		align?: "left" | "right";
	},
): TextOp {
	return {
		kind: "text",
		id,
		text: value,
		slot,
		align: style.align ?? "left",
		weight: style.weight,
		maxSize: style.maxSize,
		minSize: style.minSize,
		color: style.color,
	};
}

function planHeader(model: ShareCardModel, y: number): ShareCardOp[] {
	return [
		{
			kind: "logo",
			id: "logo",
			box: { x: CONTENT.x, y: y + 2, width: 32, height: 32 },
			fill: "primary",
		},
		text(
			"brand",
			model.brand,
			{ x: CONTENT.x + 44, y, width: 84, height: 36 },
			{ weight: 700, maxSize: 26, minSize: 18, color: "primary" },
		),
		text(
			"title",
			model.title,
			{ x: CONTENT.x + 136, y, width: 240, height: 36 },
			{ weight: 400, maxSize: 20, minSize: 13, color: "secondary" },
		),
		text(
			"range",
			model.rangeLabel,
			{ x: CONTENT_RIGHT - 320, y, width: 320, height: 36 },
			{
				weight: 500,
				maxSize: 18,
				minSize: 12,
				color: "secondary",
				align: "right",
			},
		),
	];
}

function planHero(
	model: ShareCardModel,
	y: number,
	height: number,
	scale: number,
): ShareCardOp[] {
	const s = (value: number) => Math.round(value * scale);
	const top = y + Math.round((height - s(108)) / 2);
	const tileWidth = Math.round(168 * (scale > 1 ? 1.15 : 1));
	const tileGap = 20;
	const count = model.stats.length;
	const tilesX = CONTENT_RIGHT - (count * tileWidth + (count - 1) * tileGap);
	// The headline number yields to the stat tiles, never the other way round.
	const leftWidth = tilesX - CONTENT.x - 48;

	const ops: ShareCardOp[] = [
		text(
			"hero.value",
			model.hero.value,
			{ x: CONTENT.x, y: top, width: leftWidth, height: s(64) },
			{ weight: 700, maxSize: s(64), minSize: 36, color: "primary" },
		),
		text(
			"hero.label",
			model.hero.label,
			{ x: CONTENT.x, y: top + s(64), width: leftWidth, height: s(22) },
			{ weight: 500, maxSize: s(18), minSize: 13, color: "secondary" },
		),
		text(
			"hero.facts",
			model.hero.facts,
			{ x: CONTENT.x, y: top + s(88), width: leftWidth, height: s(20) },
			{ weight: 400, maxSize: s(16), minSize: 12, color: "muted" },
		),
	];
	model.stats.forEach((stat, index) => {
		const x = tilesX + index * (tileWidth + tileGap);
		ops.push(
			{
				kind: "rect",
				id: `stat${index}.rule`,
				group: `stat${index}.rule`,
				box: { x, y: top + s(10), width: 2, height: s(80) },
				fill: "hairline",
				radius: 0,
			},
			text(
				`stat${index}.value`,
				stat.value,
				{ x: x + 16, y: top + s(12), width: tileWidth - 16, height: s(50) },
				{ weight: 650, maxSize: s(40), minSize: 22, color: "primary" },
			),
			text(
				`stat${index}.label`,
				stat.label,
				{ x: x + 16, y: top + s(64), width: tileWidth - 16, height: s(20) },
				{ weight: 400, maxSize: s(15), minSize: 11, color: "secondary" },
			),
		);
	});
	return ops;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_TICKS = [0, 6, 12, 18];

function planRhythm(
	levels: RhythmLevel[][],
	y: number,
	height: number,
): ShareCardOp[] {
	const labelWidth = 40;
	const gap = 5;
	const gridX = CONTENT.x + labelWidth;
	const cellWidth = Math.floor((CONTENT.width - labelWidth - 23 * gap) / 24);
	const gridTop = y + 32;
	const axisHeight = 16;
	const available = height - 32 - 10 - axisHeight;
	const cellHeight = Math.max(
		12,
		Math.min(34, Math.floor((available - 6 * gap) / 7)),
	);
	const gridHeight = 7 * cellHeight + 6 * gap;
	const radius = Math.min(4, Math.floor(cellHeight / 4));

	const ops: ShareCardOp[] = [
		text(
			"rhythm.title",
			"Weekly rhythm",
			{ x: CONTENT.x, y, width: 400, height: 20 },
			{ weight: 600, maxSize: 15, minSize: 12, color: "secondary" },
		),
		text(
			"rhythm.caption",
			"sessions started, by weekday and hour · local time",
			{ x: CONTENT_RIGHT - 520, y, width: 520, height: 20 },
			{ weight: 400, maxSize: 13, minSize: 10, color: "muted", align: "right" },
		),
	];
	WEEKDAYS.forEach((weekday, row) => {
		const rowY = gridTop + row * (cellHeight + gap);
		ops.push(
			text(
				`rhythm.day${row}`,
				weekday,
				{ x: CONTENT.x, y: rowY, width: labelWidth - 8, height: cellHeight },
				{
					weight: 400,
					maxSize: 13,
					minSize: 9,
					color: "muted",
					align: "right",
				},
			),
		);
		for (let hour = 0; hour < 24; hour += 1) {
			const level = levels[row]?.[hour] ?? 0;
			ops.push({
				kind: "rect",
				id: `rhythm.cell${row}.${hour}`,
				group: "rhythm.grid",
				box: {
					x: gridX + hour * (cellWidth + gap),
					y: rowY,
					width: cellWidth,
					height: cellHeight,
				},
				fill: `level${level}`,
				radius,
			});
		}
	});

	const axisY = gridTop + gridHeight + 10;
	for (const hour of HOUR_TICKS) {
		ops.push(
			text(
				`rhythm.hour${hour}`,
				`${String(hour).padStart(2, "0")}:00`,
				{
					x: gridX + hour * (cellWidth + gap),
					y: axisY,
					width: cellWidth + gap + 20,
					height: axisHeight,
				},
				{ weight: 400, maxSize: 12, minSize: 9, color: "muted" },
			),
		);
	}
	const swatch = 12;
	const legendWidth = 36 + 6 + (5 * swatch + 4 * 4) + 6 + 38;
	const legendX = CONTENT_RIGHT - legendWidth;
	ops.push(
		text(
			"legend.less",
			"Less",
			{ x: legendX, y: axisY, width: 36, height: axisHeight },
			{ weight: 400, maxSize: 12, minSize: 9, color: "muted", align: "right" },
		),
	);
	for (let level = 0; level <= 4; level += 1) {
		ops.push({
			kind: "rect",
			id: `legend.level${level}`,
			group: "legend",
			box: {
				x: legendX + 42 + level * (swatch + 4),
				y: axisY + 2,
				width: swatch,
				height: swatch,
			},
			fill: `level${level as RhythmLevel}`,
			radius: 3,
		});
	}
	ops.push(
		text(
			"legend.more",
			"More",
			{
				x: legendX + 42 + 5 * swatch + 16 + 6,
				y: axisY,
				width: 38,
				height: axisHeight,
			},
			{ weight: 400, maxSize: 12, minSize: 9, color: "muted" },
		),
	);
	return ops;
}

function barOps(id: string, box: Box, share: number): ShareCardOp[] {
	const fillWidth =
		share > 0
			? Math.min(box.width, Math.max(box.height, box.width * share))
			: 0;
	const ops: ShareCardOp[] = [
		{
			kind: "rect",
			id: `${id}.track`,
			group: id,
			box,
			fill: "hairline",
			radius: box.height / 2,
		},
	];
	if (fillWidth > 0) {
		ops.push({
			kind: "rect",
			id: `${id}.fill`,
			group: id,
			box: { ...box, width: fillWidth },
			fill: "accent",
			radius: box.height / 2,
		});
	}
	return ops;
}

function agentColumns(count: number, gap: number): Box[] {
	const width = (CONTENT.width - (count - 1) * gap) / count;
	return Array.from({ length: count }, (_, index) => ({
		x: CONTENT.x + index * (width + gap),
		y: 0,
		width,
		height: 0,
	}));
}

function planAgentsRow(model: ShareCardModel, y: number): ShareCardOp[] {
	if (model.agents.length === 0) {
		return [
			text(
				"agents.empty",
				"No agent sessions in this window",
				{ x: CONTENT.x, y, width: CONTENT.width, height: 24 },
				{ weight: 400, maxSize: 15, minSize: 11, color: "muted" },
			),
		];
	}
	const ops: ShareCardOp[] = [];
	agentColumns(model.agents.length, 40).forEach((column, index) => {
		const agent = model.agents[index];
		if (!agent) return;
		const nameWidth = Math.round(column.width * 0.4);
		ops.push(
			text(
				`agent${index}.name`,
				agent.name,
				{ x: column.x, y, width: nameWidth, height: 24 },
				{ weight: 600, maxSize: 18, minSize: 12, color: "primary" },
			),
			text(
				`agent${index}.value`,
				`${agent.started} started · ${agent.detail}`,
				{
					x: column.x + nameWidth + 8,
					y,
					width: column.width - nameWidth - 8,
					height: 24,
				},
				{
					weight: 400,
					maxSize: 15,
					minSize: 10,
					color: "secondary",
					align: "right",
				},
			),
			...barOps(
				`agent${index}.bar`,
				{ x: column.x, y: y + 36, width: column.width, height: 8 },
				agent.share,
			),
		);
	});
	return ops;
}

function planAgentsLarge(
	model: ShareCardModel,
	y: number,
	height: number,
): ShareCardOp[] {
	const top = y + Math.round((height - 176) / 2);
	if (model.agents.length === 0) {
		return [
			text(
				"agents.empty",
				"No agent sessions in this window",
				{ x: CONTENT.x, y: top, width: CONTENT.width, height: 28 },
				{ weight: 400, maxSize: 18, minSize: 12, color: "muted" },
			),
		];
	}
	const ops: ShareCardOp[] = [];
	agentColumns(model.agents.length, 48).forEach((column, index) => {
		const agent = model.agents[index];
		if (!agent) return;
		const slot = (offset: number, slotHeight: number): Box => ({
			x: column.x,
			y: top + offset,
			width: column.width,
			height: slotHeight,
		});
		ops.push(
			text(`agent${index}.name`, agent.name, slot(0, 28), {
				weight: 600,
				maxSize: 22,
				minSize: 14,
				color: "secondary",
			}),
			text(`agent${index}.started`, agent.started, slot(34, 64), {
				weight: 700,
				maxSize: 56,
				minSize: 28,
				color: "primary",
			}),
			text(`agent${index}.label`, "sessions started", slot(100, 20), {
				weight: 400,
				maxSize: 15,
				minSize: 11,
				color: "muted",
			}),
			...barOps(`agent${index}.bar`, slot(132, 10), agent.share),
			text(`agent${index}.detail`, agent.detail, slot(152, 22), {
				weight: 400,
				maxSize: 15,
				minSize: 11,
				color: "secondary",
			}),
		);
	});
	return ops;
}

function planFooter(model: ShareCardModel, y: number): ShareCardOp[] {
	const attributionWidth = 640;
	return [
		{
			kind: "rect",
			id: "footer.rule",
			group: "footer.rule",
			box: { x: CONTENT.x, y, width: CONTENT.width, height: 1 },
			fill: "hairline",
			radius: 0,
		},
		text(
			"footer.attribution",
			model.footer.attribution,
			{ x: CONTENT.x, y: y + 12, width: attributionWidth, height: 22 },
			{ weight: 500, maxSize: 15, minSize: 11, color: "secondary" },
		),
		text(
			"footer.disclosure",
			model.footer.disclosure,
			{
				x: CONTENT.x + attributionWidth + 24,
				y: y + 12,
				width: CONTENT.width - attributionWidth - 24,
				height: 22,
			},
			{ weight: 400, maxSize: 15, minSize: 11, color: "muted", align: "right" },
		),
	];
}

export function planShareCard(model: ShareCardModel): ShareCardPlan {
	const regions = planRegions(model.variant);
	const region = (id: string) => {
		const found = regions[id];
		if (!found) throw new Error(`share card template has no "${id}" region`);
		return found;
	};

	const ops: ShareCardOp[] = [...planHeader(model, region("header").y)];
	if (model.variant === "minimal") {
		const hero = region("heroLarge");
		ops.push(...planHero(model, hero.y, hero.height, 1.45));
	} else {
		const hero = region("hero");
		ops.push(...planHero(model, hero.y, hero.height, 1));
	}
	if (model.variant === "rhythm+agents" || model.variant === "rhythm") {
		const rhythm = region("rhythm");
		ops.push(...planRhythm(model.rhythm ?? [], rhythm.y, rhythm.height));
	}
	if (model.variant === "rhythm+agents") {
		ops.push(...planAgentsRow(model, region("agents").y));
	}
	if (model.variant === "agents") {
		const agents = region("agentsLarge");
		ops.push(...planAgentsLarge(model, agents.y, agents.height));
	}
	ops.push(...planFooter(model, region("footer").y));
	return { variant: model.variant, regions, ops };
}
