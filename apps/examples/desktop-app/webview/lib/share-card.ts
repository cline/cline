import {
	type FillRole,
	fitText,
	type GlyphMetrics,
	type InkRole,
	type MeasureText,
	planShareCard,
	type RhythmLevel,
	SHARE_CARD_HEIGHT,
	SHARE_CARD_WIDTH,
	type ShareCardOp,
	shareCardFont,
} from "./share-card-layout";
import {
	USAGE_SOURCE_LABELS,
	type UsagePatternsReport,
	type UsageSourceId,
} from "./usage-types";

/**
 * Privacy contract for the share card.
 *
 * `shareCardInputFromReport` is the only code that reads a report, and it
 * copies numbers into `ShareCardInput` — never a string from the report.
 * Everything after it (model, layout, pixels) works from that input alone, so
 * project names, paths, session ids and store notes cannot reach the image.
 * The weekly rhythm leaves this module as four levels, never as counts: exact
 * per-hour counts would be recoverable from the pixels otherwise.
 */

export const SHARE_CARD_TITLE = "Usage profile";
export const SHARE_CARD_ATTRIBUTION =
	"Made with Cline Desktop · aggregated on this device";
export const SHARE_CARD_DISCLOSURE =
	"No prompts, project names, paths or session IDs";

/**
 * Below two weeks each weekday x hour cell maps onto a handful of real hours,
 * close to an activity log, so the rhythm starts switched off.
 */
const RHYTHM_DEFAULT_MIN_DAYS = 14;
/** Night share is only worth a mention once it is a real habit. */
const NIGHT_SHARE_MENTION = 0.1;

export interface ShareCardInput {
	rangeDays: number;
	/** Root sessions started in the window, every source combined. */
	startedSessions: number;
	subagentRuns: number;
	/** Union of active days across sources. */
	activeDays: number;
	longestStreakDays: number;
	/** From the combined root-session hour histogram. */
	peakHour: number | null;
	/** Weighted over every source's root sessions. */
	nightShare: number;
	/** Root sessions per weekday x hour; quantized before it reaches the model. */
	rhythmCounts: number[][];
	agents: Array<{
		id: UsageSourceId;
		startedSessions: number;
		subagentRuns: number;
	}>;
}

function isKnownSource(value: unknown): value is UsageSourceId {
	return typeof value === "string" && Object.hasOwn(USAGE_SOURCE_LABELS, value);
}

function finite(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function shareCardInputFromReport(
	report: UsagePatternsReport,
): ShareCardInput {
	const { combined } = report;
	return {
		rangeDays: finite(report.rangeDays),
		startedSessions: finite(combined.workflow.rootSessions),
		subagentRuns: finite(combined.workflow.subagentSessions),
		activeDays: finite(combined.rhythm.activeDays),
		longestStreakDays: finite(combined.rhythm.longestStreakDays),
		peakHour:
			combined.rhythm.peakHour == null
				? null
				: finite(combined.rhythm.peakHour),
		nightShare: finite(combined.rhythm.nightShare),
		rhythmCounts: combined.rhythm.weekdayHourMatrix.map((row) =>
			row.map(finite),
		),
		agents: report.sources.flatMap((source) =>
			source.availability.installed && isKnownSource(source.availability.source)
				? [
						{
							id: source.availability.source,
							startedSessions: finite(source.workflow.rootSessions),
							subagentRuns: finite(source.workflow.subagentSessions),
						},
					]
				: [],
		),
	};
}

/**
 * Four GitHub-style levels over the non-empty cells' quartiles. A single hot
 * hour no longer flattens every other cell to near-black, and only the
 * relative level of a cell survives into the image.
 */
export function quantizeRhythm(counts: number[][]): RhythmLevel[][] {
	const nonzero = counts
		.flat()
		.filter((count) => count > 0)
		.sort((a, b) => a - b);
	const quartile = (fraction: number) =>
		nonzero[
			Math.min(nonzero.length - 1, Math.floor(nonzero.length * fraction))
		] ?? 0;
	const [q1, q2, q3] = [quartile(0.25), quartile(0.5), quartile(0.75)];
	const uniform =
		nonzero.length > 0 && nonzero[0] === nonzero[nonzero.length - 1];
	return counts.map((row) =>
		row.map((count): RhythmLevel => {
			if (count <= 0) return 0;
			if (uniform) return 3;
			if (count <= q1) return 1;
			if (count <= q2) return 2;
			if (count <= q3) return 3;
			return 4;
		}),
	);
}

export interface ShareCardToggles {
	includeRhythm: boolean;
	includeAgents: boolean;
	includeStreaks: boolean;
}

export function defaultShareCardToggles(rangeDays: number): ShareCardToggles {
	return {
		includeRhythm: rangeDays >= RHYTHM_DEFAULT_MIN_DAYS,
		includeAgents: true,
		includeStreaks: true,
	};
}

export type ShareCardVariant =
	| "rhythm+agents"
	| "rhythm"
	| "agents"
	| "minimal";

export interface ShareCardModel {
	variant: ShareCardVariant;
	brand: string;
	title: string;
	rangeLabel: string;
	hero: { value: string; label: string; facts: string };
	stats: Array<{ value: string; label: string }>;
	rhythm: RhythmLevel[][] | null;
	agents: Array<{
		name: string;
		started: string;
		detail: string;
		/** Share of all started sessions, 0-1. */
		share: number;
	}>;
	footer: { attribution: string; disclosure: string };
}

export function formatCount(value: number): string {
	if (value < 10_000) return Math.round(value).toLocaleString("en-US");
	return new Intl.NumberFormat("en-US", {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

function percent(fraction: number): string {
	return `${Math.round(fraction * 100)}%`;
}

export function buildShareCardModel(
	input: ShareCardInput,
	toggles: ShareCardToggles,
): ShareCardModel {
	const allSessions = input.startedSessions + input.subagentRuns;
	const facts: string[] = [];
	if (allSessions === 0) facts.push("No sessions in this window yet");
	if (input.subagentRuns > 0) {
		facts.push(`+${formatCount(input.subagentRuns)} subagent runs`);
	}
	if (input.peakHour != null && input.startedSessions > 0) {
		facts.push(`peak ${String(input.peakHour).padStart(2, "0")}:00`);
	}
	if (input.nightShare >= NIGHT_SHARE_MENTION) {
		facts.push(`${percent(input.nightShare)} after midnight`);
	}

	const stats = [
		{ value: formatCount(input.activeDays), label: "active days" },
	];
	if (toggles.includeStreaks) {
		stats.push({
			value: `${input.longestStreakDays}d`,
			label: "longest streak",
		});
	}
	stats.push({
		value: percent(allSessions === 0 ? 0 : input.subagentRuns / allSessions),
		label: "orchestrated",
	});

	const agents = input.agents
		.filter((agent) => agent.startedSessions + agent.subagentRuns > 0)
		.sort((a, b) => b.startedSessions - a.startedSessions)
		.map((agent) => ({
			name: USAGE_SOURCE_LABELS[agent.id],
			started: formatCount(agent.startedSessions),
			detail: `${percent(agent.subagentRuns / (agent.startedSessions + agent.subagentRuns))} orchestrated`,
			share:
				input.startedSessions === 0
					? 0
					: agent.startedSessions / input.startedSessions,
		}));

	const variant: ShareCardVariant = toggles.includeRhythm
		? toggles.includeAgents
			? "rhythm+agents"
			: "rhythm"
		: toggles.includeAgents
			? "agents"
			: "minimal";

	return {
		variant,
		brand: "Cline",
		title: SHARE_CARD_TITLE,
		rangeLabel: `Last ${input.rangeDays} days`,
		hero: {
			value: formatCount(input.startedSessions),
			label:
				input.startedSessions === 1
					? "agent session started"
					: "agent sessions started",
			facts: facts.join(" · "),
		},
		stats,
		rhythm: toggles.includeRhythm ? quantizeRhythm(input.rhythmCounts) : null,
		agents: toggles.includeAgents ? agents : [],
		footer: {
			attribution: SHARE_CARD_ATTRIBUTION,
			disclosure: SHARE_CARD_DISCLOSURE,
		},
	};
}

export function shareCardFileName(rangeDays: number, nowMs: number): string {
	const date = new Date(nowMs);
	const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
		date.getDate(),
	).padStart(2, "0")}`;
	return `cline-usage-${rangeDays}d-${stamp}.png`;
}

// ── Rendering ──────────────────────────────────────────────────────────────

/** Dark chart surface and ink. Text contrast on it: 17.4, 9.7 and 4.9 to 1. */
const INK: Record<InkRole, string> = {
	primary: "#ffffff",
	secondary: "#c3c2b7",
	muted: "#898781",
	hairline: "#2c2c2a",
	accent: "#3987e5",
};
const SURFACE = { top: "#1d1d1c", bottom: "#161615" };
/**
 * Level 0 is the empty cell; 1-4 are a single-hue ordinal ramp validated
 * against the surface (monotone lightness, visible steps, 2.15:1 light end).
 */
const LEVEL_FILLS: Record<RhythmLevel, string> = {
	0: "#2c2c2a",
	1: "#184f95",
	2: "#2a78d6",
	3: "#5598e7",
	4: "#9ec5f4",
};

/**
 * The Cline mark (webview/public/icon.svg) as paths, drawn in the card's own
 * ink rather than loaded: the outline, then the two eyes, whose rounded
 * rects are written as pill paths.
 */
const LOGO_PATHS = [
	"M56.4998 8.99805L56.4999 5.29805H56.4998V8.99805ZM68.4998 20.708L72.1998 20.7081V20.708H68.4998ZM67.9929 25L64.3662 24.2671L63.4704 28.7H67.9929V25ZM84.4998 25L84.4998 21.3H84.4998V25ZM95.7 49.7998H92V51.2066L92.9346 52.258L95.7 49.7998ZM108.027 63.667L110.793 61.2088L110.792 61.2088L108.027 63.667ZM108.027 64.7305L110.792 67.1887L110.793 67.1883L108.027 64.7305ZM95.7 78.5977L92.9346 76.1394L92 77.1909V78.5977H95.7ZM95.7 92.2002L99.3999 92.2002V92.2002H95.7ZM84.4998 103.4V107.1H84.4998L84.4998 103.4ZM17.2996 92.2002H13.5996V92.2002L17.2996 92.2002ZM17.2996 78.5986H20.9996V77.1918L20.0649 76.1404L17.2996 78.5986ZM4.97144 64.7305L2.20602 67.1886L2.20611 67.1887L4.97144 64.7305ZM4.97144 63.667L7.73685 66.1251L7.73685 66.1251L4.97144 63.667ZM17.2996 49.7979L20.065 52.256L20.9996 51.2046V49.7979H17.2996ZM45.0066 25V28.7H49.5292L48.6333 24.267L45.0066 25ZM44.4998 20.708H40.7998V20.7081L44.4998 20.708ZM56.4998 8.99805L56.4996 12.698C61.1812 12.6982 64.7998 16.3247 64.7998 20.708H68.4998H72.1998C72.1998 12.0452 65.0728 5.29829 56.4999 5.29805L56.4998 8.99805ZM68.4998 20.708L64.7998 20.7079C64.7997 21.6154 64.6614 22.8066 64.3662 24.2671L67.9929 25L71.6196 25.7329C71.969 24.004 72.1997 22.2864 72.1998 20.7081L68.4998 20.708ZM67.9929 25V28.7H84.4998V25V21.3H67.9929V25ZM84.4998 25L84.4997 28.7C88.6419 28.7001 92 32.0582 92 36.2002H95.7H99.3999C99.3999 27.9712 92.7287 21.3001 84.4998 21.3L84.4998 25ZM95.7 36.2002H92V49.7998H95.7H99.3999V36.2002H95.7ZM95.7 49.7998L92.9346 52.258L105.262 66.1252L108.027 63.667L110.792 61.2088L98.4653 47.3416L95.7 49.7998ZM108.027 63.667L105.262 66.1251C104.285 65.026 104.285 63.371 105.261 62.2727L108.027 64.7305L110.793 67.1883C112.308 65.4837 112.308 62.9141 110.793 61.2088L108.027 63.667ZM108.027 64.7305L105.262 62.2722L92.9346 76.1394L95.7 78.5977L98.4653 81.0559L110.792 67.1887L108.027 64.7305ZM95.7 78.5977H92V92.2002H95.7H99.3999V78.5977H95.7ZM95.7 92.2002L92 92.2002C91.9999 96.3422 88.6418 99.7003 84.4997 99.7004L84.4998 103.4L84.4998 107.1C92.7287 107.1 99.3999 100.429 99.3999 92.2002L95.7 92.2002ZM84.4998 103.4V99.7004H28.4998V103.4V107.1H84.4998V103.4ZM28.4998 103.4V99.7004C24.3577 99.7004 20.9996 96.3423 20.9996 92.2002L17.2996 92.2002L13.5996 92.2002C13.5996 100.429 20.2707 107.1 28.4998 107.1V103.4ZM17.2996 92.2002H20.9996V78.5986H17.2996H13.5996V92.2002H17.2996ZM17.2996 78.5986L20.0649 76.1404L7.73676 62.2722L4.97144 64.7305L2.20611 67.1887L14.5342 81.0569L17.2996 78.5986ZM4.97144 64.7305L7.73685 62.2723C8.71353 63.3711 8.71353 65.0264 7.73685 66.1251L4.97144 63.667L2.20602 61.2088C0.690476 62.9138 0.690476 65.4836 2.20602 67.1886L4.97144 64.7305ZM4.97144 63.667L7.73685 66.1251L20.065 52.256L17.2996 49.7979L14.5341 47.3397L2.20602 61.2088L4.97144 63.667ZM17.2996 49.7979H20.9996V36.2002H17.2996H13.5996V49.7979H17.2996ZM17.2996 36.2002H20.9996C20.9996 32.0581 24.3576 28.7 28.4998 28.7V25V21.3C20.2707 21.3 13.5996 27.9712 13.5996 36.2002H17.2996ZM28.4998 25V28.7H45.0066V25V21.3H28.4998V25ZM45.0066 25L48.6333 24.267C48.3381 22.8066 48.1998 21.6154 48.1998 20.7079L44.4998 20.708L40.7998 20.7081C40.7998 22.2864 41.0305 24.0039 41.3799 25.733L45.0066 25ZM44.4998 20.708H48.1998C48.1998 16.3244 51.8182 12.698 56.4998 12.698V8.99805V5.29805C47.9264 5.29805 40.7998 12.0451 40.7998 20.708H44.4998Z",
	"M66.1001 54.6008A4.8 4.8 0 0 1 75.7001 54.6008V73.8008A4.8 4.8 0 0 1 66.1001 73.8008Z",
	"M37.3 54.6008A4.8 4.8 0 0 1 46.9 54.6008V73.8008A4.8 4.8 0 0 1 37.3 73.8008Z",
];
const LOGO_VIEWBOX = 113;

function fillColor(role: FillRole): string {
	switch (role) {
		case "level0":
			return LEVEL_FILLS[0];
		case "level1":
			return LEVEL_FILLS[1];
		case "level2":
			return LEVEL_FILLS[2];
		case "level3":
			return LEVEL_FILLS[3];
		case "level4":
			return LEVEL_FILLS[4];
		default:
			return INK[role];
	}
}

/** Glyph metrics from a canvas; the context must use textAlign "left". */
export function measureWithCanvas(ctx: CanvasRenderingContext2D): MeasureText {
	return (text, weight, size): GlyphMetrics => {
		ctx.font = shareCardFont(weight, size);
		const metrics = ctx.measureText(text);
		return {
			left: metrics.actualBoundingBoxLeft,
			right: metrics.actualBoundingBoxRight,
			ascent: metrics.actualBoundingBoxAscent,
			descent: metrics.actualBoundingBoxDescent,
			emAscent: metrics.emHeightAscent || size * 0.8,
			emDescent: metrics.emHeightDescent || size * 0.2,
		};
	};
}

function drawOp(
	ctx: CanvasRenderingContext2D,
	op: ShareCardOp,
	measure: MeasureText,
): void {
	if (op.kind === "text") {
		const fitted = fitText(op, measure);
		ctx.font = shareCardFont(op.weight, fitted.size);
		ctx.fillStyle = INK[op.color];
		ctx.fillText(fitted.text, fitted.x, fitted.baseline);
		return;
	}
	if (op.kind === "rect") {
		const { x, y, width, height } = op.box;
		ctx.fillStyle = fillColor(op.fill);
		ctx.beginPath();
		if (op.radius > 0 && typeof ctx.roundRect === "function") {
			ctx.roundRect(x, y, width, height, op.radius);
		} else {
			ctx.rect(x, y, width, height);
		}
		ctx.fill();
		return;
	}
	const scale = Math.min(op.box.width, op.box.height) / LOGO_VIEWBOX;
	ctx.save();
	ctx.translate(op.box.x, op.box.y);
	ctx.scale(scale, scale);
	ctx.fillStyle = INK[op.fill];
	for (const path of LOGO_PATHS) ctx.fill(new Path2D(path));
	ctx.restore();
}

/**
 * Draws the card from `planShareCard`. Every position comes from the plan and
 * every string is fitted to its slot, so this function only paints.
 */
export function renderShareCard(
	model: ShareCardModel,
	pixelRatio = 2,
): HTMLCanvasElement | null {
	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	let ctx: CanvasRenderingContext2D | null = null;
	try {
		ctx = canvas.getContext("2d");
	} catch {
		return null;
	}
	if (!ctx) return null;
	canvas.width = SHARE_CARD_WIDTH * pixelRatio;
	canvas.height = SHARE_CARD_HEIGHT * pixelRatio;
	ctx.scale(pixelRatio, pixelRatio);
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";

	const background = ctx.createLinearGradient(0, 0, 0, SHARE_CARD_HEIGHT);
	background.addColorStop(0, SURFACE.top);
	background.addColorStop(1, SURFACE.bottom);
	ctx.fillStyle = background;
	ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

	const measure = measureWithCanvas(ctx);
	for (const op of planShareCard(model).ops) drawOp(ctx, op, measure);
	return canvas;
}
