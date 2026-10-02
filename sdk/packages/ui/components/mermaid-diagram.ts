import type { MermaidConfig } from "mermaid";

/**
 * Pure (DOM-free) logic behind the owned Mermaid diagram block: fence/diagram
 * naming, CSS color parsing, theme-variable construction, zoom math, PNG export
 * sizing and the serialized (queued) lazy renderer. Everything here runs in Node so it
 * can be unit-tested without a DOM; the browser glue lives in `mermaid-dom.ts`
 * and the React block in `mermaid-block.tsx`.
 */

// ---------------------------------------------------------------------------
// Lazy Mermaid module
// ---------------------------------------------------------------------------

export interface LazyMermaidInstance {
	initialize: (config: MermaidConfig) => void;
	render: (id: string, source: string) => Promise<{ svg: string }>;
}

export type MermaidModule = {
	default: LazyMermaidInstance;
};

export type MermaidModuleLoader = () => Promise<MermaidModule>;

/** Dynamic import so Mermaid only loads when a diagram first appears. */
export const defaultMermaidLoader: MermaidModuleLoader = () =>
	import("mermaid");

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

export const DEFAULT_DIAGRAM_NAME = "diagram";
export const MAX_DIAGRAM_SLUG_LENGTH = 64;
const MAX_DERIVED_SLUG_LENGTH = 48;

/** Lowercase, alphanumerics and single hyphens, trimmed, length-capped. */
export function slugifyDiagramName(
	value: string,
	maxLength: number = MAX_DIAGRAM_SLUG_LENGTH,
): string {
	const slug = value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (slug.length <= maxLength) return slug;
	return slug.slice(0, maxLength).replace(/-+$/g, "");
}

const QUOTED_TITLE =
	/(?:^|[\s{,])title\s*[=:]\s*(?:"([^"]*)"|'([^']*)'|\u201c([^\u201d]*)\u201d)/i;
const UNQUOTED_TITLE = /(?:^|[\s{,])title\s*[=:]\s*([^\s"'\u201c{},]+)/i;
// While a fence header is still arriving the closing quote may be missing.
const UNTERMINATED_TITLE =
	/(?:^|[\s{,])title\s*[=:]\s*["'\u201c]([^"'\u201d]*)$/i;

/**
 * Reads `title="..."` from a code-fence metastring. Tolerates single quotes,
 * curly quotes, an unquoted value, `title:` instead of `title=`, and a missing
 * closing quote. `meta` is often undefined or empty (including while
 * streaming), which yields `undefined`.
 */
export function parseFenceTitle(
	meta: string | null | undefined,
): string | undefined {
	if (!meta) return undefined;
	const quoted = QUOTED_TITLE.exec(meta);
	const value = quoted
		? (quoted[1] ?? quoted[2] ?? quoted[3])
		: (UNQUOTED_TITLE.exec(meta)?.[1] ?? UNTERMINATED_TITLE.exec(meta)?.[1]);
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

const FRONTMATTER =
	/^\uFEFF?\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits a leading `---` YAML frontmatter block off a diagram source. */
export function splitFrontmatter(source: string): {
	body: string;
	frontmatter: string | undefined;
} {
	const match = FRONTMATTER.exec(source);
	if (!match) return { body: source, frontmatter: undefined };
	return { body: source.slice(match[0].length), frontmatter: match[1] };
}

function unquote(value: string): string {
	const trimmed = value.trim();
	const quote = trimmed[0];
	if (
		trimmed.length >= 2 &&
		(quote === '"' || quote === "'") &&
		trimmed.endsWith(quote)
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

/** `title:` from the diagram's own frontmatter (top-level key only). */
export function parseFrontmatterTitle(source: string): string | undefined {
	const { frontmatter } = splitFrontmatter(source);
	if (!frontmatter) return undefined;
	const match = /^title[ \t]*:[ \t]*(.+?)[ \t]*$/m.exec(frontmatter);
	const title = match ? unquote(match[1] ?? "") : "";
	return title || undefined;
}

const DIAGRAM_TYPE_NAMES: Record<string, string> = {
	"architecture-beta": "architecture",
	"block-beta": "block",
	c4component: "c4",
	c4container: "c4",
	c4context: "c4",
	c4deployment: "c4",
	c4dynamic: "c4",
	classdiagram: "class",
	"classdiagram-v2": "class",
	erdiagram: "er",
	flowchart: "flowchart",
	"flowchart-elk": "flowchart",
	gantt: "gantt",
	gitgraph: "git",
	graph: "flowchart",
	journey: "journey",
	kanban: "kanban",
	mindmap: "mindmap",
	"packet-beta": "packet",
	pie: "pie",
	quadrantchart: "quadrant",
	requirementdiagram: "requirement",
	sankey: "sankey",
	"sankey-beta": "sankey",
	sequencediagram: "sequence",
	statediagram: "state",
	"statediagram-v2": "state",
	timeline: "timeline",
	"xychart-beta": "xychart",
	xychart: "xychart",
};

const NODE_LABEL =
	/\b[A-Za-z_]\w*\s*(?:\(\(|\[\[|\[\(|\(\[|\{\{|\[|\(|\{)\s*"?([^"\])}\n]+?)"?\s*(?:\)\)|\]\]|\)\]|\]\)|\}\}|\]|\)|\})/g;
const FLOWCHART_SKIP_LINE =
	/^\s*(?:subgraph|end|classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/;

function stripMarkup(value: string): string {
	return value
		.replace(/<[^>]*>/g, " ")
		.replace(/[*_`]+/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function pushUnique(labels: string[], label: string | undefined): void {
	if (!label) return;
	const clean = stripMarkup(label);
	if (!clean) return;
	const slug = slugifyDiagramName(clean);
	if (
		!slug ||
		labels.some((existing) => slugifyDiagramName(existing) === slug)
	) {
		return;
	}
	labels.push(clean);
}

function stripDirectivesAndComments(body: string): string {
	return body
		.replace(/%%\{[\s\S]*?\}%%/g, "")
		.split(/\r?\n/)
		.filter((line) => !/^\s*%%/.test(line))
		.join("\n");
}

function subgraphLabel(rest: string): string | undefined {
	const trimmed = rest.trim();
	const bracketed = /^[\w-]+\s*\[\s*"?([^\]"]+)"?\s*\]/.exec(trimmed);
	if (bracketed) return bracketed[1];
	return unquote(trimmed) || undefined;
}

function flowchartLabels(body: string): string[] {
	const labels: string[] = [];
	const subgraph = /^\s*subgraph\s+(.+)$/m.exec(body);
	pushUnique(labels, subgraph ? subgraphLabel(subgraph[1] ?? "") : undefined);
	for (const line of body.split("\n").slice(1)) {
		if (FLOWCHART_SKIP_LINE.test(line)) continue;
		for (const match of line.matchAll(NODE_LABEL)) {
			pushUnique(labels, match[1]);
		}
		if (labels.length >= 2) break;
	}
	return labels;
}

function genericLabels(body: string): string[] {
	const labels: string[] = [];
	const title = /^\s*(?:\w+\s+)?title[ \t]+(.+)$/m.exec(body);
	pushUnique(labels, title?.[1]);
	if (labels.length === 0) {
		const rest = body.split("\n").slice(1).join("\n");
		for (const match of rest.matchAll(NODE_LABEL)) pushUnique(labels, match[1]);
	}
	return labels;
}

/**
 * Best-effort diagram type + first labels for naming, e.g. `flowchart` +
 * `["VPC", "API Gateway"]`. Never throws on malformed input.
 */
export function deriveDiagramLabels(source: string): {
	labels: string[];
	type: string;
} {
	const body = stripDirectivesAndComments(splitFrontmatter(source).body).trim();
	const firstLine = body.split("\n", 1)[0] ?? "";
	const keyword = /^[A-Za-z0-9-]+/.exec(firstLine.trim())?.[0] ?? "";
	const type =
		DIAGRAM_TYPE_NAMES[keyword.toLowerCase()] ?? slugifyDiagramName(keyword);

	let labels: string[] = [];
	if (type === "flowchart") {
		labels = flowchartLabels(body);
	} else if (type === "sequence") {
		for (const match of body.matchAll(
			/^\s*(?:participant|actor)\s+([\w.-]+)(?:\s+as\s+(.+))?$/gm,
		)) {
			pushUnique(labels, match[2] ?? match[1]);
		}
	} else if (type === "class") {
		for (const match of body.matchAll(/^\s*class\s+([\w.-]+)/gm)) {
			pushUnique(labels, match[1]);
		}
	} else if (type === "er") {
		const relation =
			/^\s*([A-Za-z_][\w-]*)\s+[|}][|o](?:--|\.\.)[o|][|{]\s+([A-Za-z_][\w-]*)/m.exec(
				body,
			);
		pushUnique(labels, relation?.[1]);
		pushUnique(labels, relation?.[2]);
	} else if (type) {
		labels = genericLabels(body);
	}
	return { labels: labels.slice(0, 2), type };
}

export interface ResolveDiagramSlugInput {
	/** Raw fence metastring (`title="..."`), possibly undefined/empty. */
	meta?: string | null;
	/** Diagram source (may include frontmatter). */
	source: string;
}

/**
 * Filename stem for a diagram. Order: fence `title="..."`, diagram frontmatter
 * `title:`, diagram type + first subgraph/node labels, then `diagram`.
 */
export function resolveDiagramSlug({
	meta,
	source,
}: ResolveDiagramSlugInput): string {
	const fromMeta = slugifyDiagramName(parseFenceTitle(meta) ?? "");
	if (fromMeta) return fromMeta;

	const fromFrontmatter = slugifyDiagramName(
		parseFrontmatterTitle(source) ?? "",
	);
	if (fromFrontmatter) return fromFrontmatter;

	const { labels, type } = deriveDiagramLabels(source);
	const derived = slugifyDiagramName(
		[type, ...labels].filter(Boolean).join(" "),
		MAX_DERIVED_SLUG_LENGTH,
	);
	return derived || DEFAULT_DIAGRAM_NAME;
}

export interface MermaidDiagramName {
	/** Filename stem: lowercase, `[a-z0-9-]`, never empty, safe for any OS. */
	slug: string;
	/** Human-readable name the slug was derived from. */
	title: string;
}

/**
 * Name for a diagram, as a display `title` plus a filename-safe `slug`. Order:
 * fence `title="..."`, diagram frontmatter `title:`, diagram type + first
 * subgraph/node labels, then `diagram`. Accepts partial (still streaming)
 * source and an undefined `meta`; never throws.
 */
export function deriveMermaidDiagramName({
	code,
	meta,
}: {
	code: string;
	meta?: string | null;
}): MermaidDiagramName {
	const slug = resolveDiagramSlug({ meta, source: code });
	const explicit = [parseFenceTitle(meta), parseFrontmatterTitle(code)].find(
		(candidate) => candidate && slugifyDiagramName(candidate) === slug,
	);
	if (explicit) return { slug, title: explicit };
	return { slug, title: slug.replace(/-/g, " ") };
}

export type DiagramFileExtension = "mmd" | "png";

export function diagramFileName(
	slug: string,
	extension: DiagramFileExtension,
): string {
	return `${slug || DEFAULT_DIAGRAM_NAME}.${extension}`;
}

/** Source text as copied / saved to `.mmd`: trailing whitespace collapsed to one newline. */
export function normalizeDiagramSource(source: string): string {
	return `${source.replace(/\s+$/, "")}\n`;
}

// ---------------------------------------------------------------------------
// Color parsing / conversion
// ---------------------------------------------------------------------------

/** sRGB channels in 0-255 (may be fractional) plus alpha in 0-1. */
export interface RgbaColor {
	a: number;
	b: number;
	g: number;
	r: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function parseAlpha(token: string | undefined): number {
	const trimmed = token?.trim();
	if (!trimmed || trimmed === "none") return 1;
	const value = trimmed.endsWith("%")
		? Number.parseFloat(trimmed) / 100
		: Number.parseFloat(trimmed);
	return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}

function parseChannel(token: string, percentScale: number): number | null {
	if (token === "none") return 0;
	const value = Number.parseFloat(token);
	if (!Number.isFinite(value)) return null;
	return token.endsWith("%") ? (value / 100) * percentScale : value;
}

function parseHue(token: string): number | null {
	if (token === "none") return 0;
	const value = Number.parseFloat(token);
	if (!Number.isFinite(value)) return null;
	if (token.endsWith("turn")) return value * 360;
	if (token.endsWith("grad")) return value * 0.9;
	if (token.endsWith("rad")) return (value * 180) / Math.PI;
	return value;
}

function encodeSrgb(linear: number): number {
	const value = clamp(linear, 0, 1);
	const encoded =
		value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
	return clamp(encoded, 0, 1) * 255;
}

function oklabToRgb(
	lightness: number,
	a: number,
	b: number,
): [number, number, number] {
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		encodeSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		encodeSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		encodeSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
	];
}

function parseHex(value: string): RgbaColor | null {
	const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
	if (!match) return null;
	let hex = match[1] ?? "";
	if (hex.length <= 4) hex = [...hex].map((char) => char + char).join("");
	const channel = (offset: number) =>
		Number.parseInt(hex.slice(offset, offset + 2), 16);
	return {
		a: hex.length === 8 ? channel(6) / 255 : 1,
		b: channel(4),
		g: channel(2),
		r: channel(0),
	};
}

function splitFunctionArgs(inner: string): {
	alpha: string | undefined;
	tokens: string[];
} {
	const [main = "", alpha] = inner.replace(/,/g, " ").split("/");
	return { alpha, tokens: main.trim().split(/\s+/).filter(Boolean) };
}

function parseRgbFunction(tokens: string[], a: number): RgbaColor | null {
	if (tokens.length < 3) return null;
	const channels = tokens.slice(0, 3).map((token) => parseChannel(token, 255));
	const [r, g, b] = channels;
	if (r === null || g === null || b === null) return null;
	if (r === undefined || g === undefined || b === undefined) return null;
	return {
		a,
		b: clamp(b, 0, 255),
		g: clamp(g, 0, 255),
		r: clamp(r, 0, 255),
	};
}

function parseOklabFamily(
	name: "oklab" | "oklch",
	tokens: string[],
	a: number,
): RgbaColor | null {
	if (tokens.length < 3) return null;
	const lightness = parseChannel(tokens[0] ?? "", 1);
	if (lightness === null) return null;
	let opponentA: number | null;
	let opponentB: number | null;
	if (name === "oklch") {
		const chroma = parseChannel(tokens[1] ?? "", 0.4);
		const hue = parseHue(tokens[2] ?? "");
		if (chroma === null || hue === null) return null;
		const radians = (hue * Math.PI) / 180;
		opponentA = chroma * Math.cos(radians);
		opponentB = chroma * Math.sin(radians);
	} else {
		opponentA = parseChannel(tokens[1] ?? "", 0.4);
		opponentB = parseChannel(tokens[2] ?? "", 0.4);
	}
	if (opponentA === null || opponentB === null) return null;
	const [r, g, b] = oklabToRgb(clamp(lightness, 0, 1), opponentA, opponentB);
	return { a, b, g, r };
}

function parseColorSrgb(tokens: string[], a: number): RgbaColor | null {
	if ((tokens[0] ?? "").toLowerCase() !== "srgb") return null;
	const channels = tokens.slice(1, 4).map((token) => parseChannel(token, 1));
	const [r, g, b] = channels;
	if (r == null || g == null || b == null) return null;
	return {
		a,
		b: clamp(b, 0, 1) * 255,
		g: clamp(g, 0, 1) * 255,
		r: clamp(r, 0, 1) * 255,
	};
}

/**
 * Parses the color syntaxes `getComputedStyle` and our tokens produce:
 * `#rgb[a]`/`#rrggbb[aa]`, `rgb()/rgba()`, `oklch()`, `oklab()` and
 * `color(srgb ...)`. Returns `null` for anything else so callers can fall back
 * to a canvas-based conversion or a palette default.
 */
export function parseCssColor(input: string): RgbaColor | null {
	const value = input.trim();
	if (!value) return null;
	const hex = parseHex(value);
	if (hex) return hex;

	const fn = /^([a-z-]+)\(\s*([^)]*)\)$/i.exec(value);
	if (!fn) return null;
	const name = (fn[1] ?? "").toLowerCase();
	const { alpha, tokens } = splitFunctionArgs(fn[2] ?? "");
	const a = parseAlpha(alpha);

	if (name === "rgb" || name === "rgba") {
		// Legacy comma syntax carries alpha as a 4th positional argument.
		const legacyAlpha = alpha === undefined ? tokens[3] : undefined;
		return parseRgbFunction(tokens, legacyAlpha ? parseAlpha(legacyAlpha) : a);
	}
	if (name === "oklch" || name === "oklab") {
		return parseOklabFamily(name, tokens, a);
	}
	if (name === "color") return parseColorSrgb(tokens, a);
	return null;
}

function toChannelHex(value: number): string {
	return Math.round(clamp(value, 0, 255))
		.toString(16)
		.padStart(2, "0");
}

export function rgbToHex(color: Pick<RgbaColor, "b" | "g" | "r">): string {
	return `#${toChannelHex(color.r)}${toChannelHex(color.g)}${toChannelHex(color.b)}`;
}

/** Any supported CSS color to `#rrggbb`, or `null` when unparseable. */
export function cssColorToHex(input: string): string | null {
	const parsed = parseCssColor(input);
	return parsed ? rgbToHex(parsed) : null;
}

/**
 * Mixes `top` over `base` by `amount` (0 = base, 1 = top) in sRGB. Falls back
 * to `base` when either color is unparseable.
 */
export function mixColors(base: string, top: string, amount: number): string {
	const a = parseCssColor(base);
	const b = parseCssColor(top);
	if (!a) return base;
	if (!b) return rgbToHex(a);
	const t = clamp(amount, 0, 1);
	return rgbToHex({
		b: a.b + (b.b - a.b) * t,
		g: a.g + (b.g - a.g) * t,
		r: a.r + (b.r - a.r) * t,
	});
}

// ---------------------------------------------------------------------------
// Mermaid theme
// ---------------------------------------------------------------------------

export type MermaidColorMode = "dark" | "light";

/** Resolved Cline design tokens the diagram theme is derived from. */
export interface MermaidThemeTokens {
	/** Diagram surface (`--card`); also the PNG background fill. */
	background: string;
	border: string;
	/** Destructive/error role color (`--destructive`). */
	error: string;
	foreground: string;
	muted: string;
	mutedForeground: string;
	/** Accent (`--primary`); follows the user's accent palette. */
	primary: string;
}

/** Palette values from `theme/palette.css`, used when tokens can't be read. */
export const FALLBACK_MERMAID_TOKENS: Record<
	MermaidColorMode,
	MermaidThemeTokens
> = {
	dark: {
		background: "#18191b",
		border: "#2f2f37",
		error: "#e54666",
		foreground: "#fcfcfd",
		muted: "#212225",
		mutedForeground: "#b0b4ba",
		primary: "#6e56cf",
	},
	light: {
		background: "#f9f9fb",
		border: "#e8e8ec",
		error: "#e54666",
		foreground: "#1c2024",
		muted: "#f0f0f3",
		mutedForeground: "#60646c",
		primary: "#6e56cf",
	},
};

/** Inter-first, matching `--font-sans`; never monospace. */
export const MERMAID_FONT_FAMILY =
	"'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const MERMAID_FONT_SIZE = "14px";

/**
 * Font stack for a raw `--font-sans` value (`"Inter Variable", sans-serif`).
 * Double quotes become single quotes so the stack survives Mermaid's inline
 * `style="..."` attributes, and the Inter-first system stack is appended so
 * text still measures sensibly before the web font loads. An empty or
 * monospace value falls back to `MERMAID_FONT_FAMILY`.
 */
export function resolveMermaidFontFamily(
	cssFontValue: string | null | undefined,
): string {
	const value = cssFontValue?.trim().replace(/"/g, "'") ?? "";
	if (!value || /\bmonospace\b/i.test(value)) return MERMAID_FONT_FAMILY;
	return `${value}, ${MERMAID_FONT_FAMILY}`;
}

export type MermaidThemeVariables = Record<string, string | boolean>;

/**
 * Resolves a CSS color (`oklch(...)`, `var(--x)`, named, ...) to `#rrggbb`, or
 * returns null when it can't. Hosts with a DOM can pass a canvas/computed-style
 * backed resolver; tests can pass a stub. Consulted before the built-in parser.
 */
export type MermaidColorResolver = (cssValue: string) => string | null;

export interface MermaidThemeOptions {
	/** Overrides the UI font stack; defaults to `MERMAID_FONT_FAMILY`. */
	fontFamily?: string;
	/** Optional host resolver for colors the pure parser can't read. */
	resolveColor?: MermaidColorResolver;
}

function hexOr(
	value: string,
	fallback: string,
	resolveColor: MermaidColorResolver | undefined,
): string {
	const resolved = resolveColor?.(value);
	const hex = resolved ? cssColorToHex(resolved) : null;
	return hex ?? cssColorToHex(value) ?? fallback;
}

/** Normalizes every token to `#rrggbb`, substituting palette fallbacks. */
export function normalizeMermaidTokens(
	tokens: MermaidThemeTokens,
	mode: MermaidColorMode,
	resolveColor?: MermaidColorResolver,
): MermaidThemeTokens {
	const fallback = FALLBACK_MERMAID_TOKENS[mode];
	return {
		background: hexOr(tokens.background, fallback.background, resolveColor),
		border: hexOr(tokens.border, fallback.border, resolveColor),
		error: hexOr(tokens.error, fallback.error, resolveColor),
		foreground: hexOr(tokens.foreground, fallback.foreground, resolveColor),
		muted: hexOr(tokens.muted, fallback.muted, resolveColor),
		mutedForeground: hexOr(
			tokens.mutedForeground,
			fallback.mutedForeground,
			resolveColor,
		),
		primary: hexOr(tokens.primary, fallback.primary, resolveColor),
	};
}

/**
 * Mermaid `base`-theme variables from concrete sRGB colors. Mermaid derives the
 * rest (git/pie/state colors, ...) from these. Concrete hex is required:
 * Mermaid tints colors with khroma, and the exported SVG is rasterized in an
 * `<img>` that can't resolve `var(--x)`.
 */
export function buildMermaidThemeVariables(
	tokens: MermaidThemeTokens,
	mode: MermaidColorMode,
	{ fontFamily = MERMAID_FONT_FAMILY, resolveColor }: MermaidThemeOptions = {},
): MermaidThemeVariables {
	const t = normalizeMermaidTokens(tokens, mode, resolveColor);
	const dark = mode === "dark";
	const nodeFill = mixColors(t.background, t.primary, dark ? 0.18 : 0.1);
	const nodeBorder = mixColors(t.background, t.primary, dark ? 0.6 : 0.5);
	const neutralFill = mixColors(t.background, t.foreground, dark ? 0.08 : 0.05);
	const clusterFill = mixColors(t.background, t.foreground, dark ? 0.05 : 0.03);
	const tertiaryFill = mixColors(t.background, t.primary, dark ? 0.07 : 0.04);
	const errorFill = mixColors(t.background, t.error, dark ? 0.2 : 0.12);

	return {
		activationBkgColor: neutralFill,
		activationBorderColor: t.border,
		actorBkg: nodeFill,
		actorBorder: nodeBorder,
		actorLineColor: t.mutedForeground,
		actorTextColor: t.foreground,
		background: t.background,
		clusterBkg: clusterFill,
		clusterBorder: t.border,
		darkMode: dark,
		edgeLabelBackground: t.background,
		errorBkgColor: errorFill,
		errorTextColor: t.error,
		fontFamily,
		fontSize: MERMAID_FONT_SIZE,
		labelBoxBkgColor: neutralFill,
		labelBoxBorderColor: t.border,
		labelTextColor: t.foreground,
		lineColor: t.mutedForeground,
		loopTextColor: t.foreground,
		mainBkg: nodeFill,
		nodeBorder,
		noteBkgColor: t.muted,
		noteBorderColor: t.border,
		noteTextColor: t.foreground,
		primaryBorderColor: nodeBorder,
		primaryColor: nodeFill,
		primaryTextColor: t.foreground,
		secondaryBorderColor: t.border,
		secondaryColor: neutralFill,
		secondaryTextColor: t.foreground,
		sequenceNumberColor: t.background,
		signalColor: t.mutedForeground,
		signalTextColor: t.foreground,
		tertiaryBorderColor: t.border,
		tertiaryColor: tertiaryFill,
		tertiaryTextColor: t.foreground,
		textColor: t.foreground,
		titleColor: t.foreground,
	};
}

/**
 * Site-level Mermaid config for the Cline theme. User `%%{init}%%`, frontmatter
 * `config:`, `classDef` and `style` layer on top of this inside Mermaid, so
 * nothing here is forced per node. `htmlLabels: false` keeps labels as SVG
 * `<text>` instead of `<foreignObject>`, which taints canvases in WebKit and
 * would make PNG export fail in the Tauri webview.
 */
export function buildMermaidConfig(
	tokens: MermaidThemeTokens,
	mode: MermaidColorMode,
	options: MermaidThemeOptions = {},
): MermaidConfig {
	return {
		fontFamily: options.fontFamily ?? MERMAID_FONT_FAMILY,
		htmlLabels: false,
		securityLevel: "strict",
		startOnLoad: false,
		suppressErrorRendering: true,
		theme: "base",
		themeVariables: buildMermaidThemeVariables(tokens, mode, options),
	};
}

/** Base-theme defaults from the palette, for hosts with no DOM to sample. */
export function createDefaultMermaidConfig(
	mode: MermaidColorMode = "light",
): MermaidConfig {
	return buildMermaidConfig(FALLBACK_MERMAID_TOKENS[mode], mode);
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

export const MIN_DIAGRAM_ZOOM = 0.25;
export const MAX_DIAGRAM_ZOOM = 4;
export const DIAGRAM_ZOOM_STEP = 1.25;

export function clampDiagramZoom(scale: number): number {
	if (!Number.isFinite(scale)) return 1;
	return clamp(scale, MIN_DIAGRAM_ZOOM, MAX_DIAGRAM_ZOOM);
}

export function stepDiagramZoom(
	scale: number,
	direction: "in" | "out",
): number {
	const next =
		direction === "in" ? scale * DIAGRAM_ZOOM_STEP : scale / DIAGRAM_ZOOM_STEP;
	// Round so repeated in/out returns to 1 instead of drifting.
	return clampDiagramZoom(Math.round(next * 1000) / 1000);
}

export interface DiagramView {
	scale: number;
	x: number;
	y: number;
}

export const INITIAL_DIAGRAM_VIEW: DiagramView = { scale: 1, x: 0, y: 0 };

/**
 * Zooms to `nextScale` keeping the content under `point` (viewport-relative)
 * fixed, for a `translate(x, y) scale(s)` transform with a top-left origin.
 */
export function zoomViewAtPoint(
	view: DiagramView,
	nextScale: number,
	point: { x: number; y: number },
): DiagramView {
	const scale = clampDiagramZoom(nextScale);
	const ratio = scale / view.scale;
	return {
		scale,
		x: point.x - (point.x - view.x) * ratio,
		y: point.y - (point.y - view.y) * ratio,
	};
}

/** Exponential wheel zoom; `deltaY` is clamped so a notched wheel isn't jumpy. */
export function wheelZoomScale(scale: number, deltaY: number): number {
	return scale * Math.exp(-clamp(deltaY, -100, 100) * 0.0025);
}

// ---------------------------------------------------------------------------
// PNG export
// ---------------------------------------------------------------------------

/** Longest allowed PNG edge; keeps encoded output well under ~5 MiB. */
export const PNG_MAX_EDGE = 4096;
/** Crisp-but-modest baseline; Streamdown's fixed 5x is needlessly large. */
export const PNG_BASE_SCALE = 2;
export const PNG_MAX_DESIRED_SCALE = 3;

/**
 * Preferred export scale for a display: at least `PNG_BASE_SCALE`, following
 * the device pixel ratio up to `PNG_MAX_DESIRED_SCALE`. Non-finite or missing
 * ratios (SSR, odd embeds) yield the base scale.
 */
export function resolvePngDesiredScale(
	devicePixelRatio?: number | null,
): number {
	const ratio =
		typeof devicePixelRatio === "number" && Number.isFinite(devicePixelRatio)
			? Math.ceil(devicePixelRatio)
			: PNG_BASE_SCALE;
	return clamp(ratio, PNG_BASE_SCALE, PNG_MAX_DESIRED_SCALE);
}
/**
 * Attached images are validated on their base64 length, capped at 5 MiB
 * (`DEFAULT_MAX_IMAGE_ENCODED_BYTES` in `@cline/shared`'s `llms/media.ts`).
 */
export const PNG_MAX_ENCODED_BYTES = 5 * 1024 * 1024;
/** Each retry re-encodes at this fraction of the previous scale. */
export const PNG_RETRY_SCALE_FACTOR = 0.7;
export const PNG_MAX_ATTEMPTS = 4;
const FALLBACK_SVG_SIZE = { height: 600, width: 800 };

/** Whether a PNG of `byteLength` bytes stays attachable once base64-encoded. */
export function pngFitsAttachmentLimit(byteLength: number): boolean {
	return 4 * Math.ceil(byteLength / 3) <= PNG_MAX_ENCODED_BYTES;
}

export interface PngExportSize {
	height: number;
	scale: number;
	width: number;
}

/**
 * `scale = min(desiredScale, maxEdge / longestEdge)`. Small diagrams get the
 * desired (crisp) scale; larger ones are scaled down so the longest edge never
 * exceeds `maxEdge`, which is what keeps the encoded PNG attachable. A diagram
 * whose natural size already passes the cap is therefore shrunk (scale < 1)
 * rather than exported oversize. Non-finite or non-positive dimensions are
 * treated as 1px so the result is always a finite, positive number.
 */
export function computeExportScale(
	size: { height: number; width: number },
	desiredScale: number = PNG_BASE_SCALE,
	maxEdge: number = PNG_MAX_EDGE,
): number {
	const width = Number.isFinite(size.width) && size.width > 0 ? size.width : 1;
	const height =
		Number.isFinite(size.height) && size.height > 0 ? size.height : 1;
	return Math.min(desiredScale, maxEdge / Math.max(width, height));
}

/** Canvas dimensions for `computeExportScale`, rounded to whole pixels. */
export function computePngExportSize(
	size: { height: number; width: number },
	desiredScale: number = PNG_BASE_SCALE,
	maxEdge: number = PNG_MAX_EDGE,
): PngExportSize {
	const width = Number.isFinite(size.width) && size.width > 0 ? size.width : 1;
	const height =
		Number.isFinite(size.height) && size.height > 0 ? size.height : 1;
	const scale = computeExportScale(size, desiredScale, maxEdge);
	return {
		height: Math.max(1, Math.round(height * scale)),
		scale,
		width: Math.max(1, Math.round(width * scale)),
	};
}

/**
 * Encodes at the desired scale and, while the result is too large to attach
 * (see `pngFitsAttachmentLimit`), retries at `PNG_RETRY_SCALE_FACTOR` of the
 * previous scale. Retries stop at scale 1 (or earlier if the edge cap already
 * forced a smaller scale), after `PNG_MAX_ATTEMPTS`, or when a retry would not
 * shrink the image. The smallest attempt is returned even if it is still
 * oversize: it is still a valid PNG for a plain file download.
 */
export async function encodePngWithinLimit<T extends { size: number }>(
	natural: { height: number; width: number },
	encode: (size: PngExportSize) => Promise<T>,
	initialScale: number = PNG_BASE_SCALE,
): Promise<T> {
	let desired = initialScale;
	let previousScale = Number.POSITIVE_INFINITY;
	let result: T | undefined;
	for (let attempt = 0; attempt < PNG_MAX_ATTEMPTS; attempt += 1) {
		const size = computePngExportSize(natural, desired);
		if (result && size.scale >= previousScale) break;
		result = await encode(size);
		if (pngFitsAttachmentLimit(result.size)) return result;
		previousScale = size.scale;
		// The last attempt always drops to the 1x floor, so a geometric decay that
		// never quite reaches it can't leave a smaller export untried.
		desired =
			attempt + 2 >= PNG_MAX_ATTEMPTS
				? 1
				: Math.max(1, size.scale * PNG_RETRY_SCALE_FACTOR);
	}
	if (!result) throw new Error("Failed to encode PNG");
	return result;
}

export interface PreparedSvg {
	height: number;
	svg: string;
	width: number;
}

function readAttribute(tag: string, name: string): string | undefined {
	return new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1];
}

function setAttribute(tag: string, name: string, value: string): string {
	const pattern = new RegExp(`(\\s${name}\\s*=\\s*)"[^"]*"`, "i");
	if (pattern.test(tag)) return tag.replace(pattern, `$1"${value}"`);
	return tag.replace(/^<svg/i, `<svg ${name}="${value}"`);
}

function parseLength(value: string | undefined): number | undefined {
	if (!value || value.includes("%")) return undefined;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function viewBoxSize(
	tag: string,
): { height: number; width: number } | undefined {
	const parts = readAttribute(tag, "viewBox")
		?.trim()
		.split(/[\s,]+/)
		.map(Number.parseFloat);
	const width = parts?.[2];
	const height = parts?.[3];
	if (width && height && width > 0 && height > 0) return { height, width };
	return undefined;
}

/**
 * Makes Mermaid's SVG safe to load as a standalone image. Mermaid emits
 * `width="100%"` (no intrinsic size for `<img>`/canvas), so the root gets the
 * viewBox size; HTML-only entities/void tags are made XML-valid.
 */
export function prepareSvgForRaster(svg: string): PreparedSvg {
	const tagMatch = /<svg\b[^>]*>/i.exec(svg);
	if (!tagMatch) return { ...FALLBACK_SVG_SIZE, svg };
	let tag = tagMatch[0];
	const box = viewBoxSize(tag);
	const width =
		box?.width ??
		parseLength(readAttribute(tag, "width")) ??
		FALLBACK_SVG_SIZE.width;
	const height =
		box?.height ??
		parseLength(readAttribute(tag, "height")) ??
		FALLBACK_SVG_SIZE.height;

	tag = setAttribute(tag, "width", String(width));
	tag = setAttribute(tag, "height", String(height));
	tag = tag.replace(/\sstyle\s*=\s*"[^"]*max-width[^"]*"/i, "");
	if (!/\sxmlns\s*=/i.test(tag)) {
		tag = tag.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
	}
	if (/xlink:/i.test(svg) && !/\sxmlns:xlink\s*=/i.test(tag)) {
		tag = tag.replace(
			/^<svg/i,
			'<svg xmlns:xlink="http://www.w3.org/1999/xlink"',
		);
	}

	const sanitized = svg
		.replace(tagMatch[0], tag)
		.replace(/&nbsp;/g, "&#160;")
		.replace(/<(br|hr)\s*>/gi, "<$1/>");
	return { height, svg: sanitized, width };
}

// ---------------------------------------------------------------------------
// Diagram links
// ---------------------------------------------------------------------------

/**
 * Carries a diagram link's original destination once the navigable href has
 * been removed, so hosts can offer their own vetted way to open it.
 */
export const DIAGRAM_LINK_HREF_ATTRIBUTE = "data-cline-diagram-href";

/** Attributes that would let an anchor navigate on its own. */
const NAVIGABLE_LINK_ATTRIBUTES = ["href", "xlink:href"] as const;

function openableHref(value: string): string | null {
	try {
		const parsed = new URL(value.trim());
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.href
			: null;
	} catch {
		return null;
	}
}

function neutralizeWithDom(svg: string): string | null {
	if (
		typeof DOMParser === "undefined" ||
		typeof XMLSerializer === "undefined"
	) {
		return null;
	}
	try {
		const document = new DOMParser().parseFromString(svg, "image/svg+xml");
		if (document.getElementsByTagName("parsererror").length > 0) return null;

		for (const anchor of Array.from(document.getElementsByTagName("a"))) {
			const destination = NAVIGABLE_LINK_ATTRIBUTES.map((attribute) =>
				anchor.getAttribute(attribute),
			).find((value): value is string => Boolean(value));

			for (const attribute of NAVIGABLE_LINK_ATTRIBUTES) {
				anchor.removeAttribute(attribute);
			}
			// `target` alone cannot navigate, but leaving it invites a future
			// re-add of href to open in a new context without host review.
			anchor.removeAttribute("target");

			const openable = destination ? openableHref(destination) : null;
			if (openable) anchor.setAttribute(DIAGRAM_LINK_HREF_ATTRIBUTE, openable);
		}

		return new XMLSerializer().serializeToString(document.documentElement);
	} catch {
		return null;
	}
}

const ANCHOR_OPEN_TAG_PATTERN = /<a\b[^>]*>/gi;
const LINK_ATTRIBUTE_PATTERN =
	/\s(?:xlink:href|href|target)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function neutralizeWithPatterns(svg: string): string {
	return svg.replace(ANCHOR_OPEN_TAG_PATTERN, (openTag) => {
		let destination: string | null = null;
		const stripped = openTag.replace(
			LINK_ATTRIBUTE_PATTERN,
			(match, doubleQuoted?: string, singleQuoted?: string) => {
				if (!/\starget\s*=/i.test(match)) {
					destination ??= doubleQuoted ?? singleQuoted ?? null;
				}
				return "";
			},
		);
		const openable = destination ? openableHref(destination) : null;
		if (!openable) return stripped;
		return stripped.replace(
			/\s*\/?>$/,
			(tail) =>
				` ${DIAGRAM_LINK_HREF_ATTRIBUTE}="${openable.replace(/"/g, "&quot;")}"${tail}`,
		);
	});
}

/**
 * Mermaid's `securityLevel: "strict"` blocks script execution and dangerous URL
 * schemes, but still renders `click <node> "https://…"` directives as live
 * `<a xlink:href>` anchors inside the SVG. Streamdown injects that SVG with
 * `dangerouslySetInnerHTML`, so those anchors never pass through a product's
 * React link component — bypassing whatever link policy the host applies to
 * ordinary Markdown links (confirmation prompts, external-open routing), and in
 * a desktop webview letting a click navigate the app away from itself.
 *
 * A diagram label is authored independently of its destination, so these links
 * are deceptive by construction. Strip the navigable attributes so a diagram
 * link cannot navigate on its own, and preserve an http(s) destination in
 * `DIAGRAM_LINK_HREF_ATTRIBUTE` so hosts can opt into opening it deliberately.
 */
export function neutralizeDiagramLinks(svg: string): string {
	if (!svg.includes("<a")) return svg;
	return neutralizeWithDom(svg) ?? neutralizeWithPatterns(svg);
}

// ---------------------------------------------------------------------------
// Render service
// ---------------------------------------------------------------------------

export interface MermaidService {
	/**
	 * Renders `source` with `config`. The Mermaid module is imported on first
	 * use (and re-attempted after a failed chunk load); `initialize` only runs
	 * when the config object changes.
	 */
	render: (
		id: string,
		source: string,
		config: MermaidConfig,
	) => Promise<{ svg: string }>;
}

/**
 * Mermaid is a process-wide singleton whose `render` is not safe to run
 * concurrently (it mutates shared config and a temporary DOM container), and a
 * render must see the config it was requested with. `initialize` + `render`
 * therefore run as one queued unit, shared by every service so blocks from
 * different renderers never interleave. A failed render never blocks the queue.
 */
let renderQueue: Promise<unknown> = Promise.resolve();

function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
	const run = renderQueue.then(task, task);
	renderQueue = run.catch(() => undefined);
	return run;
}

// The config each Mermaid instance was last initialized with, tracked per
// instance so services sharing one singleton don't skip a needed re-init.
const appliedConfigs = new WeakMap<LazyMermaidInstance, MermaidConfig>();

export function createMermaidService(
	loader: MermaidModuleLoader = defaultMermaidLoader,
): MermaidService {
	let modulePromise: Promise<MermaidModule> | undefined;
	const getModule = () => {
		modulePromise ??= loader().catch((error: unknown) => {
			modulePromise = undefined;
			throw error;
		});
		return modulePromise;
	};

	return {
		async render(id, source, config) {
			const mermaid = (await getModule()).default;
			return enqueueRender(async () => {
				if (appliedConfigs.get(mermaid) !== config) {
					mermaid.initialize(config);
					appliedConfigs.set(mermaid, config);
				}
				const result = await mermaid.render(id, source);
				return { ...result, svg: neutralizeDiagramLinks(result.svg) };
			});
		},
	};
}

export function describeMermaidError(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return "Failed to render diagram";
}
